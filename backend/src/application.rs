use crate::domain::{Command, Request, Snapshot, Table, sample_table};

use crate::storage;

mod commands;
mod node_creation;
#[cfg(test)]
mod tests;
const HISTORY_LIMIT: usize = 30;

#[derive(Clone)]
pub struct Project {
    tables: Vec<Table>,
    sheets: Vec<crate::sheets::Sheet>,
    revision: u64,
    next_id: u64,
    undo: Vec<(Vec<Table>, Vec<crate::sheets::Sheet>)>,
    redo: Vec<(Vec<Table>, Vec<crate::sheets::Sheet>)>,
}

impl Default for Project {
    fn default() -> Self {
        Self {
            sheets: crate::sheets::default_sheets(),
            tables: vec![sample_table("table-1".into(), 0)],
            revision: 0,
            next_id: 2,
            undo: vec![],
            redo: vec![],
        }
    }
}

impl Project {
    pub fn restore(document: serde_json::Value, revision: u64) -> Result<Self, String> {
        let mut file = storage::decode_project(document)?;
        let previous = file.tables.clone();
        for table in &mut file.tables {
            crate::note::refresh(table);
        }
        // メモの出力を再構成した場合、自動ノードも更新する。手動ノードは旧結果を保持する。
        if file.tables.iter().zip(&previous).any(|(now, old)| {
            now.note.is_some() && (now.columns != old.columns || now.rows != old.rows)
        }) {
            crate::graph::evaluate(&mut file.tables, &previous, None)?;
        }
        Ok(Self {
            tables: file.tables,
            sheets: file.sheets,
            revision,
            ..Self::default()
        })
    }

    pub fn export(&self) -> Result<Vec<u8>, String> {
        storage::encode_project(&self.tables, &self.sheets)
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            sheets: self.sheets.clone(),
            revision: self.revision,
            tables: self
                .tables
                .iter()
                .cloned()
                .map(|mut table| {
                    table.footer_totals = crate::aggregation::totals(&table);
                    table
                })
                .collect(),
            can_undo: !self.undo.is_empty(),
            can_redo: !self.redo.is_empty(),
        }
    }

    pub fn apply(&mut self, request: Request) -> Result<Snapshot, String> {
        if request.expected_revision != self.revision {
            return Err(
                "状態が更新されています。ページを再読み込みしてからやり直してください。".into(),
            );
        }
        match request.command {
            Command::Undo => {
                if let Some(previous) = self.undo.pop() {
                    self.redo.push((
                        std::mem::replace(&mut self.tables, previous.0),
                        std::mem::replace(&mut self.sheets, previous.1),
                    ));
                }
            }
            Command::Redo => {
                if let Some(next) = self.redo.pop() {
                    self.undo.push((
                        std::mem::replace(&mut self.tables, next.0),
                        std::mem::replace(&mut self.sheets, next.1),
                    ));
                }
            }
            command => {
                // 検証に失敗した場合は一部だけ変更せず、変更前の状態を維持する。
                let mut tables = self.tables.clone();
                let run = if let Command::Run { id } = &command {
                    Some(id.clone())
                } else {
                    None
                };
                let view_only = matches!(
                    &command,
                    Command::SetViewQuery { .. } | Command::SetViewColumns { .. }
                );
                let opening = matches!(command, Command::OpenProject { .. });
                let mut sheets = self.sheets.clone();
                match command {
                    Command::AddSheet => crate::sheets::add(&mut sheets)?,
                    Command::MoveSheet { id, target, after } => {
                        crate::sheets::move_sheet(&mut sheets, &id, &target, after)?
                    }
                    Command::RemoveSheet { id, expected_nodes } => {
                        crate::sheets::remove(&mut sheets, &mut tables, &id, &expected_nodes)?
                    }

                    Command::RenameSheet {
                        id,
                        title,
                        expected_title,
                    } => crate::sheets::rename(&mut sheets, &id, &title, &expected_title)?,
                    Command::OpenProject { document } => {
                        let file = storage::decode_project(document)?;
                        tables = file.tables;
                        sheets = file.sheets;
                    }
                    command => self.edit(&mut tables, command)?,
                }
                crate::sheets::validate(&sheets, &tables)?;
                if !opening && !view_only {
                    crate::graph::evaluate(&mut tables, &self.tables, run.as_deref())?;
                }
                self.undo.push((
                    std::mem::replace(&mut self.tables, tables),
                    std::mem::replace(&mut self.sheets, sheets),
                ));
                if self.undo.len() > HISTORY_LIMIT {
                    self.undo.remove(0);
                }
                self.redo.clear();
            }
        }
        self.revision += 1;
        Ok(self.snapshot())
    }
}
