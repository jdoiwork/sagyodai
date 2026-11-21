use crate::domain::{
    ColorTarget, Command, Filter, Kind, Operator, Request, Snapshot, Table, sample_table,
};

use crate::storage::{self, MAX_CELL_BYTES, MAX_COLS, MAX_ROWS};
const HISTORY_LIMIT: usize = 30;

#[derive(Clone)]
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
    pub fn restore(document: serde_json::Value, revision: u64) -> Result<Self, String> {
        Ok(Self {
            tables: storage::decode(document)?,
            revision,
            ..Self::default()
        })
    }

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
                let run = if let Command::Run { id } = &command {
                    Some(id.clone())
                } else {
                    None
                };
                let opening = matches!(command, Command::OpenProject { .. });
                self.edit(&mut tables, command)?;
                if !opening {
                    crate::graph::evaluate(&mut tables, &self.tables, run.as_deref())?;
                }
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
            Command::Rename {
                id,
                title,
                expected_title,
            } => {
                let t = table_mut(tables, &id)?;
                if t.title != expected_title {
                    return Err(
                        "タイトルが別の操作で変更されました。入力は保持されています。".into(),
                    );
                }
                let title = title.trim();
                if title.is_empty() || title.len() > 1024 {
                    return Err("タイトルは空欄にせず、1024バイト以内で入力してください。".into());
                }
                t.title = title.to_string();
            }
            Command::ConnectFromPort {
                id,
                source,
                from_input,
            } => {
                let color = if from_input {
                    table_mut(tables, &id)?.input_color
                } else {
                    table_mut(tables, &source)?.output_color
                };
                self.edit(
                    tables,
                    Command::Connect {
                        id: id.clone(),
                        source: Some(source),
                    },
                )?;
                table_mut(tables, &id)?.edge_color = color;
            }
            Command::Connect { id, source } => {
                let t = table_mut(tables, &id)?;
                if t.kind == Kind::Input {
                    return Err("手入力の表には接続できません。".into());
                }
                t.source = source;
                crate::graph::order(tables)?;
            }
            Command::Configure { id, filter, manual } => {
                let t = table_mut(tables, &id)?;
                if t.kind == Kind::Input {
                    return Err("手入力の表には加工設定を指定できません。".into());
                }
                t.filter = filter;
                t.manual = manual;
                crate::graph::order(tables)?;
            }
            Command::SetColor { id, target, color } => {
                let table = table_mut(tables, &id)?;
                match target {
                    ColorTarget::Edge if table.source.is_some() => table.edge_color = color,
                    ColorTarget::Input if table.kind != Kind::Input => table.input_color = color,
                    ColorTarget::Output if table.kind != Kind::Display => {
                        table.output_color = color
                    }
                    _ => return Err("色を変更する接続線または端子がありません。".into()),
                }
            }
            Command::SetCompact { id, compact } => {
                let table = tables
                    .iter_mut()
                    .find(|t| t.id == id)
                    .ok_or("ノードが見つかりません。")?;
                if table.kind != Kind::Filter {
                    return Err("コンパクト表示はフィルタで使用できます。".into());
                }
                table.compact = compact;
            }
            Command::Run { id } => {
                table_mut(tables, &id)?;
            }
            Command::RemoveNode { id } => {
                table_mut(tables, &id)?;
                if tables.len() == 1 {
                    return Err("最後のノードは削除できません。".into());
                }
                tables.retain(|t| t.id != id);
                for t in tables {
                    if t.source.as_ref() == Some(&id) {
                        t.source = None;
                    }
                }
            }
            Command::AddTable | Command::AddNode { .. } => {
                let (kind, position) = if let Command::AddNode { kind, position } = command {
                    (kind, position)
                } else {
                    (Kind::Input, None)
                };
                if position
                    .as_ref()
                    .is_some_and(|p| !p.x.is_finite() || !p.y.is_finite())
                {
                    return Err("ノードの位置が不正です。".into());
                }
                if tables.len() >= 20 {
                    return Err("試作では表は20個までです。".into());
                }
                while tables
                    .iter()
                    .any(|table| table.id == format!("table-{}", self.next_id))
                {
                    self.next_id += 1;
                }
                let next_x = tables.iter().map(|t| t.x + t.width).fold(0.0_f64, f64::max) + 120.0;
                tables.push(sample_table(
                    format!("table-{}", self.next_id),
                    tables.len(),
                ));
                if kind != Kind::Input {
                    let t = tables.last_mut().ok_or("ノードを作成できません。")?;
                    t.kind = kind;
                    t.title = format!(
                        "{} {}",
                        if kind == Kind::Filter {
                            "フィルタ"
                        } else {
                            "結果表"
                        },
                        self.next_id
                    );
                    t.columns.clear();
                    t.rows.clear();
                    t.width = if kind == Kind::Filter { 400.0 } else { 760.0 };
                    t.height = if kind == Kind::Filter { 360.0 } else { 390.0 };
                    t.x = next_x;
                    t.y = 100.0;
                    t.stale = true;
                    if kind == Kind::Filter {
                        t.filter = Some(Filter {
                            column: 0,
                            operator: Operator::Equals,
                            value: String::new(),
                        });
                    }
                }
                if let Some(position) = position {
                    let t = tables.last_mut().ok_or("ノードを作成できません。")?;
                    t.x = position.x;
                    t.y = position.y;
                }
                self.next_id += 1;
            }
            Command::Paste {
                id,
                row,
                col,
                values,
                expected_values,
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
                if table.kind != Kind::Input {
                    return Err("加工結果は読み取り専用です。".into());
                }
                if let Some(expected) = expected_values {
                    if expected.len() != values.len()
                        || expected
                            .iter()
                            .zip(&values)
                            .any(|(a, b)| a.len() != b.len())
                    {
                        return Err("比較対象の範囲が不正です。".into());
                    }
                    for (r, cells) in expected.iter().enumerate() {
                        for (c, value) in cells.iter().enumerate() {
                            if table.rows.get(row + r).and_then(|row| row.get(col + c))
                                != value.as_ref()
                            {
                                return Err(
                                    "同じセルが別の操作で変更されました。入力は保持されています。"
                                        .into(),
                                );
                            }
                        }
                    }
                }
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
                if table.kind != Kind::Input {
                    return Err("加工結果は読み取り専用です。".into());
                }
                if count == 0 || count > MAX_ROWS.saturating_sub(table.rows.len()) {
                    return Err("試作の上限は5000行です。".into());
                }
                table
                    .rows
                    .extend(vec![vec![String::new(); table.columns.len()]; count]);
            }
            Command::RemoveRows {
                id,
                indices,
                expected_rows,
            } => {
                crate::table_edit::remove_selection(tables, &id, &indices, None, &expected_rows)?;
            }
            Command::RemoveColumns {
                id,
                indices,
                expected_columns,
                expected_rows,
            } => {
                crate::table_edit::remove_selection(
                    tables,
                    &id,
                    &indices,
                    Some(&expected_columns),
                    &expected_rows,
                )?;
            }
            Command::RemoveRow {
                id,
                row,
                expected_rows,
            } => {
                crate::table_edit::remove_row(tables, &id, row, &expected_rows)?;
            }
            Command::RenameColumn {
                id,
                col,
                name,
                expected_columns,
            } => {
                crate::table_edit::rename_column(tables, &id, col, name, &expected_columns)?;
            }
            Command::RemoveColumn {
                id,
                col,
                expected_columns,
                expected_rows,
            } => {
                crate::table_edit::remove_column(
                    tables,
                    &id,
                    col,
                    &expected_columns,
                    &expected_rows,
                )?;
            }
            Command::InsertRows {
                id,
                at,
                count,
                expected_columns,
                expected_rows,
            } => {
                crate::table_edit::insert(
                    tables,
                    &id,
                    at,
                    count,
                    false,
                    &expected_columns,
                    &expected_rows,
                )?;
            }
            Command::InsertColumns {
                id,
                at,
                count,
                expected_columns,
                expected_rows,
            } => {
                crate::table_edit::insert(
                    tables,
                    &id,
                    at,
                    count,
                    true,
                    &expected_columns,
                    &expected_rows,
                )?;
            }
            Command::MoveRows {
                id,
                indices,
                to,
                expected_columns,
                expected_rows,
            } => {
                crate::table_edit::move_rows(
                    tables,
                    &id,
                    &indices,
                    to,
                    &expected_columns,
                    &expected_rows,
                )?;
            }
            Command::MoveColumns {
                id,
                indices,
                to,
                expected_columns,
                expected_rows,
            } => {
                crate::table_edit::move_columns(
                    tables,
                    &id,
                    &indices,
                    to,
                    &expected_columns,
                    &expected_rows,
                )?;
            }
            Command::MoveColumn {
                id,
                from,
                to,
                expected_columns,
                expected_rows,
            } => {
                crate::table_edit::move_column(
                    tables,
                    &id,
                    from,
                    to,
                    &expected_columns,
                    &expected_rows,
                )?;
            }
            Command::ResizeColumn {
                id,
                col,
                width,
                expected_width,
                expected_columns,
            } => {
                let table = table_mut(tables, &id)?;
                if table.columns != expected_columns
                    || col >= table.columns.len()
                    || table.column_widths.get(col).copied().unwrap_or(160.0) != expected_width
                {
                    return Err("列の構成または幅が変更されています。再度操作してください。".into());
                }
                if !width.is_finite() || !(60.0..=1200.0).contains(&width) {
                    return Err("列幅は60〜1200の範囲で指定してください。".into());
                }
                table.column_widths.resize(table.columns.len(), 160.0);
                table.column_widths[col] = width;
            }
            Command::AddColumn { id } => {
                let table = table_mut(tables, &id)?;
                if table.kind != Kind::Input {
                    return Err("加工結果は読み取り専用です。".into());
                }
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
                expected_values: None,
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
        invalid["formatVersion"] = 99.into();
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
                    expected_values: None,
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

#[cfg(test)]
mod sync_tests {
    use super::*;
    #[test]
    fn guarded_paste_preserves_other_edits_and_rejects_same_cell_conflicts() {
        let mut project = Project::default();
        let edit = |revision, col, value: &str, expected: &str| Request {
            expected_revision: revision,
            command: Command::Paste {
                id: "table-1".into(),
                row: 0,
                col,
                values: vec![vec![value.into()]],
                expected_values: Some(vec![vec![Some(expected.into())]]),
            },
        };
        project.apply(edit(0, 0, "別タブ", "ノート")).unwrap();
        assert!(project.apply(edit(1, 0, "自分の入力", "ノート")).is_err());
        assert_eq!(project.snapshot().revision, 1);
        project.apply(edit(1, 1, "4", "3")).unwrap();
        assert_eq!(project.snapshot().tables[0].rows[0][0], "別タブ");
        project
            .apply(Request {
                expected_revision: 2,
                command: Command::Undo,
            })
            .unwrap();
        assert_eq!(project.snapshot().tables[0].rows[0][1], "3");
        assert_eq!(project.snapshot().tables[0].rows[0][0], "別タブ");
    }
}
