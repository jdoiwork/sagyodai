//! 結果表の列選択・並べ替え・別名指定。表示検索とは別に出力そのものを加工する。
use crate::domain::Table;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Projection {
    pub schema: Vec<String>,
    pub columns: Vec<OutputColumn>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutputColumn {
    pub column: usize,
    pub name: String,
    pub visible: bool,
}
impl Projection {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema.is_empty()
            || self.schema.len() > crate::storage::MAX_COLS
            || self.schema.iter().any(|name| name.len() > 1024)
            || self.columns.len() != self.schema.len()
            || self.columns.iter().any(|c| c.column >= self.schema.len())
            || self
                .columns
                .iter()
                .map(|c| c.column)
                .collect::<HashSet<_>>()
                .len()
                != self.columns.len()
        {
            return Err("入力列の構成が不正です。出力列を設定し直してください。".into());
        }
        if !self.columns.iter().any(|c| c.visible) {
            return Err("出力する列を1つ以上選択してください。".into());
        }
        let mut names = HashSet::new();
        for column in &self.columns {
            if column.name.chars().count() > 240 {
                return Err("出力列名は240文字以内にしてください。".into());
            }
            if column.visible && !names.insert(self.name(column)) {
                return Err("出力列名が重複しています。別の名前を指定してください。".into());
            }
        }
        Ok(())
    }
    fn name(&self, column: &OutputColumn) -> String {
        if column.name.trim().is_empty() {
            self.schema[column.column].clone()
        } else {
            column.name.trim().into()
        }
    }
    pub fn evaluate(&self, source: &Table) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
        self.validate()?;
        if self.schema != source.columns {
            return Err("入力の列構成が変わりました。出力列を設定し直してください。".into());
        }
        let selected: Vec<_> = self.columns.iter().filter(|c| c.visible).collect();
        Ok((
            selected.iter().map(|c| self.name(c)).collect(),
            source
                .rows
                .iter()
                .map(|row| selected.iter().map(|c| row[c.column].clone()).collect())
                .collect(),
        ))
    }
}

// 表のヘッダー位置は出力済みの列位置。非表示列を残したまま可視列のスロットを並べ替える。
pub fn move_columns(
    tables: &mut [Table],
    id: &str,
    indices: &[usize],
    to: usize,
    expected_columns: &[String],
    expected_rows: &[Vec<String>],
) -> Result<(), String> {
    let i = tables
        .iter()
        .position(|t| t.id == id)
        .ok_or("結果表が見つかりません。")?;
    let table = &tables[i];
    if table.stale || table.error.is_some() {
        return Err("結果表を更新してから列を並べ替えてください。".into());
    }
    if table.columns != expected_columns || table.rows != expected_rows {
        return Err(
            "表の内容が変更されています。表示を確認して列を並べ替え直してください。".into(),
        );
    }
    let source = table
        .source
        .as_ref()
        .and_then(|id| tables.iter().find(|t| &t.id == id))
        .ok_or("入力が未接続です。")?;
    let mut config = table.projection.clone().unwrap_or_else(|| Projection {
        schema: source.columns.clone(),
        columns: source
            .columns
            .iter()
            .enumerate()
            .map(|(column, _)| OutputColumn {
                column,
                name: String::new(),
                visible: true,
            })
            .collect(),
    });
    let (columns, rows) = config.evaluate(source)?;
    if columns != table.columns || rows != table.rows {
        return Err("入力が変更されています。結果表を更新してください。".into());
    }
    let visible: Vec<_> = config
        .columns
        .iter()
        .filter(|c| c.visible)
        .cloned()
        .collect();
    let mut selected = indices.to_vec();
    selected.sort_unstable();
    selected.dedup();
    if selected.is_empty()
        || selected.len() != indices.len()
        || selected.iter().any(|n| *n >= visible.len())
        || to > visible.len() - selected.len()
    {
        return Err("移動する列または移動先が不正です。".into());
    }
    let mut order: Vec<_> = (0..visible.len())
        .filter(|n| !selected.contains(n))
        .collect();
    order.splice(to..to, selected);
    let mut next = order.iter();
    for column in &mut config.columns {
        if column.visible
            && let Some(index) = next.next()
        {
            *column = visible[*index].clone();
        }
    }
    config.validate()?;
    let table = &mut tables[i];
    table.projection = Some(config);
    table.view = Default::default();
    // 自動更新なら同じ操作で列幅・フッターの対象も移動する。
    if !table.manual {
        table.column_widths = order
            .iter()
            .map(|i| table.column_widths.get(*i).copied().unwrap_or(160.0))
            .collect();
        if let Some(footer) = &table.footer {
            table.footer = Some(
                order
                    .iter()
                    .map(|i| footer.get(*i).copied().unwrap_or(false))
                    .collect(),
            );
        }
    }
    Ok(())
}

pub fn rename_column(
    tables: &mut [Table],
    id: &str,
    col: usize,
    name: String,
    expected: &[String],
) -> Result<(), String> {
    let i = tables
        .iter()
        .position(|t| t.id == id)
        .ok_or("結果表が見つかりません。")?;
    let table = &tables[i];
    if table.stale || table.error.is_some() {
        return Err("結果表を更新してから列名を変更してください。".into());
    }
    if table.columns != expected || col >= table.columns.len() {
        return Err(
            "列の構成が変更されています。表示を確認して列名の編集をやり直してください。".into(),
        );
    }
    if name.trim().is_empty() {
        return Err("列名を入力してください。".into());
    }
    let source = table
        .source
        .as_ref()
        .and_then(|id| tables.iter().find(|t| &t.id == id))
        .ok_or("入力が未接続です。")?;
    let mut config = table.projection.clone().unwrap_or_else(|| Projection {
        schema: source.columns.clone(),
        columns: source
            .columns
            .iter()
            .enumerate()
            .map(|(column, _)| OutputColumn {
                column,
                name: String::new(),
                visible: true,
            })
            .collect(),
    });
    if config.evaluate(source)?.0 != table.columns {
        return Err("入力の列構成が変わりました。結果表を更新してください。".into());
    }
    let target = config
        .columns
        .iter_mut()
        .filter(|c| c.visible)
        .nth(col)
        .ok_or("対象の列が見つかりません。")?;
    target.name = name;
    config.validate()?;
    tables[i].projection = Some(config);
    tables[i].view = Default::default();
    Ok(())
}

pub fn hide_column(
    tables: &mut [Table],
    id: &str,
    col: usize,
    expected: &[String],
) -> Result<(), String> {
    let i = tables
        .iter()
        .position(|t| t.id == id)
        .ok_or("結果表が見つかりません。")?;
    let table = &tables[i];
    if table.kind != crate::domain::Kind::Display {
        return Err("結果表ではありません。".into());
    }
    if table.stale || table.error.is_some() {
        return Err("結果表を更新してから列を非表示にしてください。".into());
    }
    if table.columns != expected || col >= table.columns.len() {
        return Err("列の構成が変更されています。表示を確認してやり直してください。".into());
    }
    if table.columns.len() <= 1 {
        return Err("出力する列を1つ以上残してください。".into());
    }
    let source = table
        .source
        .as_ref()
        .and_then(|id| tables.iter().find(|t| &t.id == id))
        .ok_or("入力が未接続です。")?;
    let mut config = table.projection.clone().unwrap_or_else(|| Projection {
        schema: source.columns.clone(),
        columns: source
            .columns
            .iter()
            .enumerate()
            .map(|(column, _)| OutputColumn {
                column,
                name: String::new(),
                visible: true,
            })
            .collect(),
    });
    if config.evaluate(source)?.0 != table.columns {
        return Err("入力の列構成が変わりました。結果表を更新してください。".into());
    }
    config
        .columns
        .iter_mut()
        .filter(|c| c.visible)
        .nth(col)
        .ok_or("対象の列が見つかりません。")?
        .visible = false;
    config.validate()?;
    let table = &mut tables[i];
    table.projection = Some(config);
    table.view = Default::default();
    if !table.manual {
        if col < table.column_widths.len() {
            table.column_widths.remove(col);
        }
        if let Some(footer) = &mut table.footer
            && col < footer.len()
        {
            footer.remove(col);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        application::Project,
        domain::{Command, Kind, Request},
        storage,
    };
    fn run(p: &mut Project, command: Command) {
        p.apply(Request {
            expected_revision: p.snapshot().revision,
            command,
        })
        .unwrap();
    }
    fn config(source: &Table) -> Projection {
        Projection {
            schema: source.columns.clone(),
            columns: vec![
                OutputColumn {
                    column: 1,
                    name: "個数".into(),
                    visible: true,
                },
                OutputColumn {
                    column: 0,
                    name: "".into(),
                    visible: true,
                },
                OutputColumn {
                    column: 2,
                    name: "".into(),
                    visible: false,
                },
                OutputColumn {
                    column: 3,
                    name: "".into(),
                    visible: false,
                },
            ],
        }
    }
    #[test]
    fn projection_flows_through_displays_persists_and_supports_manual_undo() {
        let mut p = Project::default();
        for _ in 0..2 {
            run(
                &mut p,
                Command::AddNode {
                    kind: Kind::Display,
                    sheet_id: None,
                    position: None,
                },
            );
        }
        run(
            &mut p,
            Command::Connect {
                id: "table-2".into(),
                source: Some("table-1".into()),
            },
        );
        run(
            &mut p,
            Command::Connect {
                id: "table-3".into(),
                source: Some("table-2".into()),
            },
        );
        let original = p.snapshot().tables[0].clone();
        let cfg = config(&original);
        run(
            &mut p,
            Command::SetProjection {
                id: "table-2".into(),
                config: Some(cfg.clone()),
            },
        );
        let result = p.snapshot();
        assert_eq!(result.tables[1].columns, ["個数", "品名"]);
        assert_eq!(
            result.tables[1].rows[0],
            [original.rows[0][1].clone(), original.rows[0][0].clone()]
        );
        assert_eq!(result.tables[2].rows, result.tables[1].rows);
        assert_eq!(result.tables[0].columns, original.columns);
        let restored =
            storage::decode(serde_json::from_slice(&p.export().unwrap()).unwrap()).unwrap();
        assert_eq!(restored[1].projection, Some(cfg));
        assert_eq!(restored[2].columns, result.tables[1].columns);
        run(&mut p, Command::Undo);
        assert_eq!(p.snapshot().tables[2].columns, original.columns);
        run(&mut p, Command::Redo);
        assert_eq!(p.snapshot().tables[2].columns, ["個数", "品名"]);
        run(
            &mut p,
            Command::Configure {
                id: "table-2".into(),
                filter: None,
                manual: true,
            },
        );
        run(
            &mut p,
            Command::SetProjection {
                id: "table-2".into(),
                config: None,
            },
        );
        assert!(p.snapshot().tables[1].stale);
        assert_eq!(p.snapshot().tables[1].columns, ["個数", "品名"]);
        run(
            &mut p,
            Command::Run {
                id: "table-2".into(),
            },
        );
        assert_eq!(p.snapshot().tables[2].columns, original.columns);
        let mut bad = config(&original);
        bad.schema[0] = "別の列".into();
        run(
            &mut p,
            Command::SetProjection {
                id: "table-2".into(),
                config: Some(bad),
            },
        );
        run(
            &mut p,
            Command::Run {
                id: "table-2".into(),
            },
        );
        assert!(p.snapshot().tables[1].error.is_some());
        assert_eq!(p.snapshot().tables[1].rows, original.rows);
        let before = p.snapshot().revision;
        assert!(
            p.apply(Request {
                expected_revision: before,
                command: Command::Connect {
                    id: "table-2".into(),
                    source: Some("table-3".into())
                }
            })
            .is_err()
        );
        assert_eq!(p.snapshot().revision, before);
    }
    #[test]
    fn header_reordering_preserves_hidden_columns_names_and_downstream_results() {
        let mut p = Project::default();
        for _ in 0..2 {
            run(
                &mut p,
                Command::AddNode {
                    kind: Kind::Display,
                    sheet_id: None,
                    position: None,
                },
            );
        }
        run(
            &mut p,
            Command::Connect {
                id: "table-2".into(),
                source: Some("table-1".into()),
            },
        );
        run(
            &mut p,
            Command::Connect {
                id: "table-3".into(),
                source: Some("table-2".into()),
            },
        );
        let cfg = config(&p.snapshot().tables[0]);
        run(
            &mut p,
            Command::SetProjection {
                id: "table-2".into(),
                config: Some(cfg),
            },
        );
        let before = p.snapshot().tables[1].clone();
        run(
            &mut p,
            Command::MoveColumn {
                id: "table-2".into(),
                from: 0,
                to: 1,
                expected_columns: before.columns.clone(),
                expected_rows: before.rows.clone(),
            },
        );
        let snapshot = p.snapshot();
        assert_eq!(snapshot.tables[1].columns, ["品名", "個数"]);
        assert_eq!(snapshot.tables[2].columns, snapshot.tables[1].columns);
        assert_eq!(
            snapshot.tables[2].rows[0],
            [before.rows[0][1].clone(), before.rows[0][0].clone()]
        );
        let projected = snapshot.tables[1].projection.as_ref().unwrap();
        assert_eq!(
            projected
                .columns
                .iter()
                .map(|c| c.column)
                .collect::<Vec<_>>(),
            [0, 1, 2, 3]
        );
        assert!(!projected.columns[2].visible);
        assert_eq!(projected.columns[1].name, "個数");
        let restored =
            storage::decode(serde_json::from_slice(&p.export().unwrap()).unwrap()).unwrap();
        assert_eq!(restored[1].projection, snapshot.tables[1].projection);
        assert!(
            p.apply(Request {
                expected_revision: snapshot.revision,
                command: Command::MoveColumn {
                    id: "table-2".into(),
                    from: 0,
                    to: 1,
                    expected_columns: before.columns.clone(),
                    expected_rows: before.rows.clone()
                }
            })
            .is_err()
        );
        run(&mut p, Command::Undo);
        assert_eq!(p.snapshot().tables[1].columns, before.columns);
        run(
            &mut p,
            Command::SetProjection {
                id: "table-2".into(),
                config: None,
            },
        );
        let plain = p.snapshot().tables[1].clone();
        run(
            &mut p,
            Command::MoveColumn {
                id: "table-2".into(),
                from: 0,
                to: 3,
                expected_columns: plain.columns.clone(),
                expected_rows: plain.rows.clone(),
            },
        );
        assert_eq!(
            p.snapshot().tables[1].columns,
            ["数量", "分類", "メモ", "品名"]
        );
    }
    #[test]
    fn header_rename_updates_alias_and_downstream_without_touching_source() {
        let mut p = Project::default();
        for _ in 0..2 {
            run(
                &mut p,
                Command::AddNode {
                    kind: Kind::Display,
                    sheet_id: None,
                    position: None,
                },
            );
        }
        run(
            &mut p,
            Command::Connect {
                id: "table-2".into(),
                source: Some("table-1".into()),
            },
        );
        run(
            &mut p,
            Command::Connect {
                id: "table-3".into(),
                source: Some("table-2".into()),
            },
        );
        let original = p.snapshot().tables[0].clone();
        run(
            &mut p,
            Command::RenameColumn {
                id: "table-2".into(),
                col: 1,
                name: "個数".into(),
                expected_columns: original.columns.clone(),
            },
        );
        assert_eq!(p.snapshot().tables[2].columns[1], "個数");
        assert_eq!(p.snapshot().tables[0].columns, original.columns);
        let cfg = config(&original);
        run(
            &mut p,
            Command::SetProjection {
                id: "table-2".into(),
                config: Some(cfg),
            },
        );
        let before = p.snapshot().tables[1].clone();
        run(
            &mut p,
            Command::RenameColumn {
                id: "table-2".into(),
                col: 0,
                name: "数量合計".into(),
                expected_columns: before.columns.clone(),
            },
        );
        let snap = p.snapshot();
        assert_eq!(snap.tables[2].columns, ["数量合計", "品名"]);
        assert_eq!(
            snap.tables[1].projection.as_ref().unwrap().columns[0].column,
            1
        );
        assert_eq!(
            snap.tables[1].projection.as_ref().unwrap().columns[0].name,
            "数量合計"
        );
        let restored =
            storage::decode(serde_json::from_slice(&p.export().unwrap()).unwrap()).unwrap();
        assert_eq!(restored[1].projection, snap.tables[1].projection);
        for name in ["", "品名"] {
            assert!(
                p.apply(Request {
                    expected_revision: p.snapshot().revision,
                    command: Command::RenameColumn {
                        id: "table-2".into(),
                        col: 0,
                        name: name.into(),
                        expected_columns: snap.tables[1].columns.clone()
                    }
                })
                .is_err()
            );
        }
        assert!(
            p.apply(Request {
                expected_revision: p.snapshot().revision,
                command: Command::RenameColumn {
                    id: "table-2".into(),
                    col: 0,
                    name: "別名".into(),
                    expected_columns: before.columns.clone()
                }
            })
            .is_err()
        );
        run(&mut p, Command::Undo);
        assert_eq!(p.snapshot().tables[2].columns, before.columns);
    }
    #[test]
    fn hiding_output_column_keeps_alias_and_can_be_restored() {
        let mut p = Project::default();
        for _ in 0..2 {
            run(
                &mut p,
                Command::AddNode {
                    kind: Kind::Display,
                    sheet_id: None,
                    position: None,
                },
            );
        }
        run(
            &mut p,
            Command::Connect {
                id: "table-2".into(),
                source: Some("table-1".into()),
            },
        );
        run(
            &mut p,
            Command::Connect {
                id: "table-3".into(),
                source: Some("table-2".into()),
            },
        );
        let source = p.snapshot().tables[0].clone();
        run(
            &mut p,
            Command::SetProjection {
                id: "table-2".into(),
                config: Some(config(&source)),
            },
        );
        let before = p.snapshot().tables[1].clone();
        run(
            &mut p,
            Command::HideOutputColumn {
                id: "table-2".into(),
                col: 0,
                expected_columns: before.columns.clone(),
            },
        );
        assert_eq!(p.snapshot().tables[2].columns, ["品名"]);
        assert_eq!(p.snapshot().tables[2].rows[0], [source.rows[0][0].clone()]);
        assert_eq!(p.snapshot().tables[0].columns, source.columns);
        let restored =
            storage::decode(serde_json::from_slice(&p.export().unwrap()).unwrap()).unwrap();
        let mut config = restored[1].projection.clone().unwrap();
        assert!(!config.columns[0].visible);
        assert_eq!(config.columns[0].name, "個数");
        assert!(
            p.apply(Request {
                expected_revision: p.snapshot().revision,
                command: Command::HideOutputColumn {
                    id: "table-2".into(),
                    col: 0,
                    expected_columns: vec!["品名".into()]
                }
            })
            .is_err()
        );
        run(&mut p, Command::Undo);
        assert_eq!(p.snapshot().tables[2].columns, before.columns);
        run(&mut p, Command::Redo);
        config.columns[0].visible = true;
        run(
            &mut p,
            Command::SetProjection {
                id: "table-2".into(),
                config: Some(config),
            },
        );
        assert_eq!(p.snapshot().tables[2].columns, before.columns);
        assert!(
            p.apply(Request {
                expected_revision: p.snapshot().revision,
                command: Command::HideOutputColumn {
                    id: "table-2".into(),
                    col: 0,
                    expected_columns: vec!["古い列".into()]
                }
            })
            .is_err()
        );
    }
    #[test]
    fn rejects_missing_duplicate_and_empty_output_columns() {
        let t = crate::domain::sample_table("test".into(), 0);
        let mut cfg = config(&t);
        cfg.columns[0].name = "品名".into();
        assert!(cfg.validate().is_err());
        cfg.columns[0].name.clear();
        assert!(cfg.validate().is_ok());
        cfg.columns[0].column = 50;
        assert!(cfg.validate().is_err());
        cfg = config(&t);
        for c in &mut cfg.columns {
            c.visible = false;
        }
        assert!(cfg.validate().is_err());
        cfg = config(&t);
        cfg.columns[0].name = "あ".repeat(241);
        assert!(cfg.validate().is_err());
    }
}
