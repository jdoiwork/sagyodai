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
