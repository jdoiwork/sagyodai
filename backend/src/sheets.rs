//! シートは表示上の所属。依存関係と計算はプロジェクト全体で扱う。
use crate::domain::Table;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sheet {
    pub id: String,
    pub title: String,
}
pub fn default_sheet_id() -> String {
    "sheet-1".into()
}
pub fn default_sheets() -> Vec<Sheet> {
    vec![Sheet {
        id: default_sheet_id(),
        title: "シート 1".into(),
    }]
}
pub fn validate(sheets: &[Sheet], tables: &[Table]) -> Result<(), String> {
    if sheets.is_empty() || sheets.len() > 20 {
        return Err("シート数は1〜20個にしてください。".into());
    }
    let mut ids = HashSet::new();
    for sheet in sheets {
        if sheet.id.is_empty() || sheet.id.len() > 128 || !ids.insert(&sheet.id) {
            return Err("シートのIDが不正または重複しています。".into());
        }
        if sheet.title.trim().is_empty() || sheet.title.len() > 1024 {
            return Err("シート名は空欄にせず、1024バイト以内で入力してください。".into());
        }
    }
    if tables.iter().any(|t| !ids.contains(&t.sheet_id)) {
        return Err("ノードの所属シートが見つかりません。".into());
    }
    Ok(())
}
pub fn add(sheets: &mut Vec<Sheet>) -> Result<(), String> {
    if sheets.len() >= 20 {
        return Err("シートは20個までです。".into());
    }
    let mut n = 1;
    while sheets.iter().any(|s| s.id == format!("sheet-{n}")) {
        n += 1;
    }
    sheets.push(Sheet {
        id: format!("sheet-{n}"),
        title: format!("シート {n}"),
    });
    Ok(())
}
pub fn rename(sheets: &mut [Sheet], id: &str, title: &str, expected: &str) -> Result<(), String> {
    let sheet = sheets
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or("シートが見つかりません。")?;
    if sheet.title != expected {
        return Err("シート名が別の操作で変更されました。".into());
    }
    let title = title.trim();
    if title.is_empty() || title.len() > 1024 {
        return Err("シート名は空欄にせず、1024バイト以内で入力してください。".into());
    }
    sheet.title = title.into();
    Ok(())
}

pub fn move_sheet(
    sheets: &mut Vec<Sheet>,
    id: &str,
    target: &str,
    after: bool,
) -> Result<(), String> {
    let from = sheets
        .iter()
        .position(|s| s.id == id)
        .ok_or("シートが見つかりません。")?;
    if !sheets.iter().any(|s| s.id == target) {
        return Err("移動先のシートが見つかりません。".into());
    }
    if id == target {
        return Ok(());
    }
    let sheet = sheets.remove(from);
    let to = sheets
        .iter()
        .position(|s| s.id == target)
        .ok_or("移動先のシートが見つかりません。")?;
    sheets.insert(to + usize::from(after), sheet);
    Ok(())
}
pub fn remove(
    sheets: &mut Vec<Sheet>,
    tables: &mut Vec<Table>,
    id: &str,
    expected: &[String],
) -> Result<(), String> {
    if !sheets.iter().any(|s| s.id == id) {
        return Err("シートが見つかりません。".into());
    }
    if sheets.len() == 1 {
        return Err("最後のシートは削除できません。".into());
    }
    let removed: HashSet<String> = tables
        .iter()
        .filter(|t| t.sheet_id == id)
        .map(|t| t.id.clone())
        .collect();
    if removed != expected.iter().cloned().collect() {
        return Err("シート内のノードが変更されました。削除対象を確認し直してください。".into());
    }
    tables.retain(|t| !removed.contains(&t.id));
    for t in tables {
        t.union_inputs
            .retain(|input| !removed.contains(&input.source));
        if t.source
            .as_ref()
            .is_some_and(|source| removed.contains(source))
        {
            t.source = None;
        }
    }
    sheets.retain(|s| s.id != id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::{
        application::Project,
        domain::{Command, Kind, Request},
        storage,
    };
    fn run(p: &mut Project, command: Command) -> Result<crate::domain::Snapshot, String> {
        p.apply(Request {
            expected_revision: p.snapshot().revision,
            command,
        })
    }

    #[test]
    fn reorder_delete_restore_and_conflicts() {
        let mut p = Project::default();
        run(&mut p, Command::AddSheet).unwrap();
        run(&mut p, Command::AddSheet).unwrap();
        run(
            &mut p,
            Command::AddNode {
                kind: Kind::Display,
                sheet_id: Some("sheet-2".into()),
                position: None,
            },
        )
        .unwrap();
        run(
            &mut p,
            Command::Connect {
                id: "table-2".into(),
                source: Some("table-1".into()),
            },
        )
        .unwrap();
        let good = p.snapshot().tables[1].rows.clone();
        run(
            &mut p,
            Command::MoveSheet {
                id: "sheet-3".into(),
                target: "sheet-1".into(),
                after: false,
            },
        )
        .unwrap();
        assert_eq!(
            p.snapshot()
                .sheets
                .iter()
                .map(|s| s.id.as_str())
                .collect::<Vec<_>>(),
            ["sheet-3", "sheet-1", "sheet-2"]
        );
        let before = p.export().unwrap();
        assert!(
            run(
                &mut p,
                Command::RemoveSheet {
                    id: "sheet-1".into(),
                    expected_nodes: vec![]
                }
            )
            .is_err()
        );
        assert_eq!(before, p.export().unwrap());
        run(
            &mut p,
            Command::RemoveSheet {
                id: "sheet-1".into(),
                expected_nodes: vec!["table-1".into()],
            },
        )
        .unwrap();
        assert_eq!(p.snapshot().tables.len(), 1);
        assert!(p.snapshot().tables[0].source.is_none());
        assert_eq!(p.snapshot().tables[0].rows, good);
        let restored =
            Project::restore(serde_json::from_slice(&p.export().unwrap()).unwrap(), 0).unwrap();
        assert_eq!(restored.snapshot().sheets[0].id, "sheet-3");
        run(&mut p, Command::Undo).unwrap();
        assert_eq!(p.export().unwrap(), before);
        run(&mut p, Command::Redo).unwrap();
        run(
            &mut p,
            Command::RemoveSheet {
                id: "sheet-2".into(),
                expected_nodes: vec!["table-2".into()],
            },
        )
        .unwrap();
        assert!(
            Project::restore(serde_json::from_slice(&p.export().unwrap()).unwrap(), 0)
                .unwrap()
                .snapshot()
                .tables
                .is_empty()
        );
        assert!(
            run(
                &mut p,
                Command::RemoveSheet {
                    id: "sheet-3".into(),
                    expected_nodes: vec![]
                }
            )
            .is_err()
        );
        // 既定のシート1がなくても、APIからノードを追加できる。
        run(&mut p, Command::AddTable).unwrap();
        assert_eq!(p.snapshot().tables[0].sheet_id, "sheet-3");
    }
    #[test]
    fn sheets_share_references_updates_history_and_saved_cache() {
        let mut p = Project::default();
        run(&mut p, Command::AddSheet).unwrap();
        run(
            &mut p,
            Command::RenameSheet {
                id: "sheet-2".into(),
                title: "結果".into(),
                expected_title: "シート 2".into(),
            },
        )
        .unwrap();
        run(
            &mut p,
            Command::AddNode {
                kind: Kind::Display,
                sheet_id: Some("sheet-2".into()),
                position: None,
            },
        )
        .unwrap();
        let s = run(
            &mut p,
            Command::Connect {
                id: "table-2".into(),
                source: Some("table-1".into()),
            },
        )
        .unwrap();
        assert_eq!(s.tables[1].sheet_id, "sheet-2");
        assert_eq!(s.tables[0].rows, s.tables[1].rows);
        run(
            &mut p,
            Command::Configure {
                id: "table-2".into(),
                filter: None,
                manual: true,
            },
        )
        .unwrap();
        let s = run(
            &mut p,
            Command::Paste {
                id: "table-1".into(),
                row: 0,
                col: 0,
                values: vec![vec!["別シートから更新".into()]],
                expected_values: None,
            },
        )
        .unwrap();
        assert!(s.tables[1].stale);
        assert_ne!(s.tables[0].rows, s.tables[1].rows);
        let s = run(
            &mut p,
            Command::Run {
                id: "table-2".into(),
            },
        )
        .unwrap();
        assert_eq!(s.tables[0].rows, s.tables[1].rows);
        let restored = Project::restore(serde_json::from_slice(&p.export().unwrap()).unwrap(), 0)
            .unwrap()
            .snapshot();
        assert_eq!(restored.sheets[1].title, "結果");
        assert_eq!(restored.tables[1].source.as_deref(), Some("table-1"));
        assert_eq!(restored.tables[1].rows, s.tables[1].rows);
        run(
            &mut p,
            Command::Configure {
                id: "table-2".into(),
                filter: None,
                manual: false,
            },
        )
        .unwrap();
        let s = run(
            &mut p,
            Command::Paste {
                id: "table-1".into(),
                row: 0,
                col: 0,
                values: vec![vec!["自動更新".into()]],
                expected_values: None,
            },
        )
        .unwrap();
        assert_eq!(s.tables[0].rows, s.tables[1].rows);
        let before = p.export().unwrap();
        assert!(
            run(
                &mut p,
                Command::AddNode {
                    kind: Kind::Input,
                    sheet_id: Some("missing".into()),
                    position: None
                }
            )
            .is_err()
        );
        assert_eq!(before, p.export().unwrap());
        let mut invalid: serde_json::Value = serde_json::from_slice(&before).unwrap();
        invalid["tables"][1]["sheetId"] = "missing".into();
        assert!(storage::decode_project(invalid).is_err());
    }
    #[test]
    fn empty_sheets_can_be_saved_and_creation_is_undoable() {
        let mut p = Project::default();
        run(&mut p, Command::AddSheet).unwrap();
        assert_eq!(p.snapshot().sheets.len(), 2);
        run(&mut p, Command::Undo).unwrap();
        assert_eq!(p.snapshot().sheets.len(), 1);
        run(&mut p, Command::Redo).unwrap();
        assert_eq!(p.snapshot().sheets.len(), 2);
        assert!(
            run(
                &mut p,
                Command::RenameSheet {
                    id: "sheet-2".into(),
                    title: " ".into(),
                    expected_title: "シート 2".into()
                }
            )
            .is_err()
        );
        assert_eq!(
            Project::restore(serde_json::from_slice(&p.export().unwrap()).unwrap(), 0)
                .unwrap()
                .snapshot()
                .sheets
                .len(),
            2
        );
    }
}
