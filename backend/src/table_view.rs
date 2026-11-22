//! 出力を変更しない、プロジェクトに保存する表の表示設定。
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TableView {
    pub query: String,
    pub columns: ColumnView,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColumnView {
    pub schema: String,
    pub values: BTreeMap<String, Vec<String>>,
    pub sort: Option<DisplaySort>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplaySort {
    pub column: usize,
    pub direction: Direction,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Asc,
    Desc,
}
impl TableView {
    pub fn validate(&self) -> Result<(), String> {
        if self.query.len() > crate::storage::MAX_CELL_BYTES {
            return Err("検索語が長すぎます。".into());
        }
        let columns: Vec<String> = if self.columns.schema.is_empty() {
            vec![]
        } else {
            serde_json::from_str(&self.columns.schema)
                .map_err(|_| "表示設定の列構成が不正です。")?
        };
        if columns.len() > crate::storage::MAX_COLS
            || columns.iter().any(|v| v.len() > 1024)
            || self
                .columns
                .sort
                .as_ref()
                .is_some_and(|s| s.column >= columns.len())
            || self.columns.values.iter().any(|(c, values)| {
                c.parse::<usize>()
                    .ok()
                    .is_none_or(|index| index >= columns.len() || index.to_string() != *c)
                    || values.len() > crate::storage::MAX_ROWS
                    || values
                        .iter()
                        .any(|v| v.len() > crate::storage::MAX_CELL_BYTES)
            })
        {
            return Err("表示設定の列または値の指定が不正です。".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        application::Project,
        autosave::Autosave,
        domain::{Command, Request},
        storage,
    };
    fn run(p: &mut Project, command: Command) -> Result<(), String> {
        p.apply(Request {
            expected_revision: p.snapshot().revision,
            command,
        })
        .map(|_| ())
    }
    #[test]
    fn view_roundtrips_without_changing_outputs_and_supports_undo_conflicts() {
        let mut p = Project::default();
        let original = p.snapshot().tables[0].clone();
        let id = original.id.clone();
        let columns = ColumnView {
            schema: serde_json::to_string(&original.columns).unwrap(),
            values: [("0".into(), vec!["文房具".into(), "".into()])].into(),
            sort: Some(DisplaySort {
                column: 1,
                direction: Direction::Desc,
            }),
        };
        run(
            &mut p,
            Command::SetViewColumns {
                id: id.clone(),
                columns: columns.clone(),
                expected_columns: Default::default(),
            },
        )
        .unwrap();
        run(
            &mut p,
            Command::SetViewQuery {
                id: id.clone(),
                query: "日本語".into(),
                expected_query: "".into(),
            },
        )
        .unwrap();
        let before = p.export().unwrap();
        let restored = storage::decode(serde_json::from_slice(&before).unwrap()).unwrap();
        assert_eq!(restored[0].view.columns, columns);
        assert_eq!(restored[0].view.query, "日本語");
        assert_eq!(restored[0].rows, original.rows);
        assert_eq!(restored[0].stale, original.stale);
        assert!(
            run(
                &mut p,
                Command::SetViewQuery {
                    id: id.clone(),
                    query: "競合".into(),
                    expected_query: "".into()
                }
            )
            .is_err()
        );
        assert_eq!(p.export().unwrap(), before);
        run(&mut p, Command::Undo).unwrap();
        assert_eq!(p.snapshot().tables[0].view.query, "");
        run(&mut p, Command::Redo).unwrap();
        assert_eq!(p.export().unwrap(), before);
        let path = std::env::temp_dir().join(format!("sagyodai-view-{}.json", std::process::id()));
        let store = Autosave::open(path.clone()).unwrap();
        store.save(&p).unwrap();
        drop(store);
        let store = Autosave::open(path.clone()).unwrap();
        assert_eq!(store.load().unwrap().unwrap().export().unwrap(), before);
        drop(store);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn browser_request_accepts_json_column_keys() {
        let request: Request = serde_json::from_value(serde_json::json!({
            "expectedRevision": 0,
            "command": { "type": "setViewColumns", "id": "table-1",
                "columns": { "schema": "[\"分類\"]", "values": { "0": ["食品"] }, "sort": null },
                "expectedColumns": { "schema": "", "values": {}, "sort": null }
            }
        }))
        .unwrap();
        Project::default().apply(request).unwrap();
    }
    #[test]
    fn invalid_sort_and_column_values_are_rejected_on_command_and_load() {
        let mut p = Project::default();
        let before = p.export().unwrap();
        let original = &p.snapshot().tables[0];
        let mut columns = ColumnView {
            schema: "[\"分類\"]".into(),
            values: BTreeMap::new(),
            sort: Some(DisplaySort {
                column: 3,
                direction: Direction::Asc,
            }),
        };
        assert!(
            run(
                &mut p,
                Command::SetViewColumns {
                    id: original.id.clone(),
                    columns: columns.clone(),
                    expected_columns: Default::default()
                }
            )
            .is_err()
        );
        assert_eq!(p.export().unwrap(), before);
        columns.sort = None;
        columns.values.insert("2".into(), vec![]);
        let mut doc: serde_json::Value = serde_json::from_slice(&before).unwrap();
        doc["tables"][0]["view"]["columns"] = serde_json::to_value(columns).unwrap();
        assert!(storage::decode(doc).is_err());
    }
}
