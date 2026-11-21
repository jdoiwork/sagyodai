use crate::domain::{Command, Request, Snapshot, Table, sample_table};

use crate::storage::{self, MAX_CELL_BYTES, MAX_COLS, MAX_ROWS};
const HISTORY_LIMIT: usize = 30;

pub struct Project {
    tables: Vec<Table>,
    revision: u64,
    next_id: u64,
    undo: Vec<Vec<Table>>,
    redo: Vec<Vec<Table>>,
}

impl Default for Project {
    fn default() -> Self {
        Self {
            tables: vec![sample_table("table-1".into(), 0)],
            revision: 0,
            next_id: 2,
            undo: vec![],
            redo: vec![],
        }
    }
}

impl Project {
    pub fn export(&self) -> Result<Vec<u8>, String> {
        storage::encode(&self.tables)
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            revision: self.revision,
            tables: self.tables.clone(),
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
                    self.redo
                        .push(std::mem::replace(&mut self.tables, previous));
                }
            }
            Command::Redo => {
                if let Some(next) = self.redo.pop() {
                    self.undo.push(std::mem::replace(&mut self.tables, next));
                }
            }
            command => {
                // 検証に失敗した場合は一部だけ変更せず、変更前の状態を維持する。
                let mut tables = self.tables.clone();
                self.edit(&mut tables, command)?;
                self.undo.push(std::mem::replace(&mut self.tables, tables));
                if self.undo.len() > HISTORY_LIMIT {
                    self.undo.remove(0);
                }
                self.redo.clear();
            }
        }
        self.revision += 1;
        Ok(self.snapshot())
    }

    fn edit(&mut self, tables: &mut Vec<Table>, command: Command) -> Result<(), String> {
        match command {
            Command::OpenProject { document } => {
                *tables = storage::decode(document)?;
            }
            Command::AddTable => {
                if tables.len() >= 20 {
                    return Err("試作では表は20個までです。".into());
                }
                while tables
                    .iter()
                    .any(|table| table.id == format!("table-{}", self.next_id))
                {
                    self.next_id += 1;
                }
                tables.push(sample_table(
                    format!("table-{}", self.next_id),
                    tables.len(),
                ));
                self.next_id += 1;
            }
            Command::Paste {
                id,
                row,
                col,
                values,
            } => {
                let width = values.iter().map(Vec::len).max().unwrap_or(0);
                if values.is_empty() || width == 0 {
                    return Err("貼り付けるデータがありません。".into());
                }
                let end_row = row
                    .checked_add(values.len())
                    .ok_or("行数が大きすぎます。")?;
                let end_col = col.checked_add(width).ok_or("列数が大きすぎます。")?;
                if end_row > MAX_ROWS || end_col > MAX_COLS {
                    return Err("試作の上限は5000行・50列です。".into());
                }
                if values.iter().flatten().any(|v| v.len() > MAX_CELL_BYTES) {
                    return Err("セルの内容が長すぎます。".into());
                }
                let table = table_mut(tables, &id)?;
                while table.columns.len() < end_col {
                    table
                        .columns
                        .push(format!("列 {}", table.columns.len() + 1));
                }
                for r in &mut table.rows {
                    r.resize(table.columns.len(), String::new());
                }
                table.rows.resize(
                    end_row.max(table.rows.len()),
                    vec![String::new(); table.columns.len()],
                );
                for (r, cells) in values.into_iter().enumerate() {
                    for (c, value) in cells.into_iter().enumerate() {
                        table.rows[row + r][col + c] = value;
                    }
                }
            }
            Command::AddRows { id, count } => {
                let table = table_mut(tables, &id)?;
                if count == 0 || count > MAX_ROWS.saturating_sub(table.rows.len()) {
                    return Err("試作の上限は5000行です。".into());
                }
                table
                    .rows
                    .extend(vec![vec![String::new(); table.columns.len()]; count]);
            }
            Command::AddColumn { id } => {
                let table = table_mut(tables, &id)?;
                if table.columns.len() >= MAX_COLS {
                    return Err("試作の上限は50列です。".into());
                }
                table
                    .columns
                    .push(format!("列 {}", table.columns.len() + 1));
                for row in &mut table.rows {
                    row.push(String::new());
                }
            }
            Command::Place {
                id,
                x,
                y,
                width,
                height,
            } => {
                if !storage::valid_layout(x, y, width, height) {
                    return Err("表の位置またはサイズが不正です。".into());
                }
                let table = table_mut(tables, &id)?;
                table.x = x;
                table.y = y;
                table.width = width;
                table.height = height;
            }
            Command::Undo | Command::Redo => unreachable!("履歴操作は apply で処理する"),
        }
        Ok(())
    }
}

fn table_mut<'a>(tables: &'a mut [Table], id: &str) -> Result<&'a mut Table, String> {
    tables
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| "対象の表が見つかりません。".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(project: &mut Project, command: Command) -> Result<Snapshot, String> {
        project.apply(Request {
            expected_revision: project.revision,
            command,
        })
    }
    #[test]
    fn paste_expands_table_atomically_and_is_one_undo() {
        let mut p = Project::default();
        let before = p.snapshot().tables[0].rows.clone();
        run(
            &mut p,
            Command::Paste {
                id: "table-1".into(),
                row: 5,
                col: 3,
                values: vec![
                    vec!["日本語".into(), "列追加".into()],
                    vec!["改行\nあり".into(), "".into()],
                ],
            },
        )
        .unwrap();
        assert_eq!(p.tables[0].rows.len(), 7);
        assert_eq!(p.tables[0].columns.len(), 5);
        assert_eq!(p.tables[0].rows[6][3], "改行\nあり");
        run(&mut p, Command::Undo).unwrap();
        assert_eq!(p.tables[0].rows, before);
        run(&mut p, Command::Redo).unwrap();
        assert_eq!(p.tables[0].rows[5][4], "列追加");
    }
    #[test]
    fn opening_file_is_atomic_undoable_and_preserves_unique_ids() {
        let mut p = Project::default();
        let initial = p.export().unwrap();
        let mut tables = vec![
            sample_table("table-1".into(), 0),
            sample_table("table-2".into(), 1),
        ];
        tables[0].rows[0][0] = "復元したデータ".into();
        let document: serde_json::Value =
            serde_json::from_slice(&storage::encode(&tables).unwrap()).unwrap();
        let mut invalid = document.clone();
        invalid["formatVersion"] = 2.into();
        assert!(run(&mut p, Command::OpenProject { document: invalid }).is_err());
        assert_eq!(p.export().unwrap(), initial);
        assert_eq!(p.revision, 0);
        run(&mut p, Command::OpenProject { document }).unwrap();
        assert_eq!(p.tables[0].rows[0][0], "復元したデータ");
        run(&mut p, Command::Undo).unwrap();
        assert_eq!(p.export().unwrap(), initial);
        run(&mut p, Command::Redo).unwrap();
        run(&mut p, Command::AddTable).unwrap();
        assert_eq!(p.tables[2].id, "table-3");
    }
    #[test]
    fn invalid_paste_and_stale_edit_leave_state_untouched() {
        let mut p = Project::default();
        assert!(
            run(
                &mut p,
                Command::Paste {
                    id: "table-1".into(),
                    row: 4999,
                    col: 0,
                    values: vec![vec!["x".into()], vec!["y".into()]]
                }
            )
            .is_err()
        );
        assert_eq!(p.revision, 0);
        assert!(!p.snapshot().can_undo);
        run(
            &mut p,
            Command::AddColumn {
                id: "table-1".into(),
            },
        )
        .unwrap();
        assert!(
            p.apply(Request {
                expected_revision: 0,
                command: Command::AddTable
            })
            .is_err()
        );
        assert_eq!(p.tables.len(), 1);
    }
}
