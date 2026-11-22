//! 保存済みのメモ本文を、Markdown原文のまま1列1行で出力する。
use crate::domain::{Kind, Table};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Note {
    pub text: String,
}
pub fn validate_text(text: &str) -> Result<(), String> {
    if text.len() > 100_000 {
        return Err("メモは100000バイト以内にしてください。".into());
    }
    Ok(())
}
pub fn validate(table: &Table) -> Result<(), String> {
    if (table.kind == Kind::Note) != table.note.is_some() {
        return Err("メモ設定とノードの種類が一致しません。".into());
    }
    if let Some(note) = &table.note {
        validate_text(&note.text)?;
        if !table.sources().is_empty() || table.manual {
            return Err("メモノードには入力接続や手動更新を設定できません。".into());
        }
    }
    Ok(())
}

// 本文が原本。出力は保存済みの本文から再構成し、別々に編集しない。
pub fn refresh(table: &mut Table) {
    if let Some(note) = &table.note {
        table.columns = vec!["本文".into()];
        table.rows = vec![vec![note.text.clone()]];
        table.stale = false;
        table.error = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        application::Project,
        domain::{Command, Request},
    };
    fn run(p: &mut Project, command: Command) -> Result<crate::domain::Snapshot, String> {
        p.apply(Request {
            expected_revision: p.snapshot().revision,
            command,
        })
    }
    #[test]
    fn note_output_propagates_through_filter_and_respects_manual_cache() {
        use crate::domain::{Filter, Operator};
        let mut p = Project::default();
        for kind in [Kind::Note, Kind::Filter, Kind::Display] {
            run(
                &mut p,
                Command::AddNode {
                    kind,
                    position: None,
                    sheet_id: None,
                },
            )
            .unwrap();
        }
        assert_eq!(p.snapshot().tables[1].rows, vec![vec![String::new()]]);
        for (id, source) in [("table-3", "table-2"), ("table-4", "table-3")] {
            run(
                &mut p,
                Command::Connect {
                    id: id.into(),
                    source: Some(source.into()),
                },
            )
            .unwrap();
        }
        run(
            &mut p,
            Command::Configure {
                id: "table-3".into(),
                filter: Some(Filter {
                    column: 0,
                    operator: Operator::Contains,
                    value: "重要".into(),
                    values: vec![],
                }),
                manual: false,
            },
        )
        .unwrap();
        let text = "# 重要\n日本語の本文".to_string();
        run(
            &mut p,
            Command::SetNote {
                id: "table-2".into(),
                text: text.clone(),
                expected_text: "".into(),
            },
        )
        .unwrap();
        assert_eq!(p.snapshot().tables[3].rows, vec![vec![text.clone()]]);
        run(
            &mut p,
            Command::Configure {
                id: "table-4".into(),
                filter: None,
                manual: true,
            },
        )
        .unwrap();
        run(
            &mut p,
            Command::SetNote {
                id: "table-2".into(),
                text: "対象外".into(),
                expected_text: text.clone(),
            },
        )
        .unwrap();
        assert!(p.snapshot().tables[2].rows.is_empty());
        assert!(p.snapshot().tables[3].stale);
        assert_eq!(p.snapshot().tables[3].rows, vec![vec![text.clone()]]);
        let restored =
            Project::restore(serde_json::from_slice(&p.export().unwrap()).unwrap(), 0).unwrap();
        assert_eq!(restored.snapshot().tables[1].rows, vec![vec!["対象外"]]);
        assert_eq!(restored.snapshot().tables[3].rows, vec![vec![text]]);
        run(
            &mut p,
            Command::Run {
                id: "table-4".into(),
            },
        )
        .unwrap();
        assert!(p.snapshot().tables[3].rows.is_empty());
        run(&mut p, Command::Undo).unwrap();
        assert_eq!(p.snapshot().tables[3].rows.len(), 1);
    }
    #[test]
    fn notes_save_restore_undo_conflicts_and_output_connections() {
        let mut p = Project::default();
        run(
            &mut p,
            Command::AddNode {
                kind: Kind::Note,
                position: None,
                sheet_id: None,
            },
        )
        .unwrap();
        assert!(p.snapshot().tables[1].error.is_none());
        let text = "# 手順\n\n- 日本語のメモ\n- **重要**".to_string();
        run(
            &mut p,
            Command::SetNote {
                id: "table-2".into(),
                text: text.clone(),
                expected_text: "".into(),
            },
        )
        .unwrap();
        assert!(
            run(
                &mut p,
                Command::SetNote {
                    id: "table-2".into(),
                    text: "競合".into(),
                    expected_text: "".into()
                }
            )
            .is_err()
        );
        assert!(
            run(
                &mut p,
                Command::SetNote {
                    id: "table-2".into(),
                    text: "a".repeat(100001),
                    expected_text: text.clone()
                }
            )
            .is_err()
        );
        let restored =
            Project::restore(serde_json::from_slice(&p.export().unwrap()).unwrap(), 0).unwrap();
        assert_eq!(
            restored.snapshot().tables[1].note.as_ref().unwrap().text,
            text
        );
        run(&mut p, Command::Undo).unwrap();
        assert!(
            p.snapshot().tables[1]
                .note
                .as_ref()
                .unwrap()
                .text
                .is_empty()
        );
        run(&mut p, Command::Redo).unwrap();
        assert_eq!(p.snapshot().tables[1].note.as_ref().unwrap().text, text);
        run(
            &mut p,
            Command::AddNode {
                kind: Kind::Display,
                position: None,
                sheet_id: None,
            },
        )
        .unwrap();
        run(
            &mut p,
            Command::Connect {
                id: "table-3".into(),
                source: Some("table-2".into()),
            },
        )
        .unwrap();
        assert_eq!(p.snapshot().tables[2].columns, ["本文"]);
        assert_eq!(p.snapshot().tables[2].rows, vec![vec![text.clone()]]);
        assert!(
            run(
                &mut p,
                Command::Connect {
                    id: "table-2".into(),
                    source: Some("table-1".into())
                }
            )
            .is_err()
        );
        run(
            &mut p,
            Command::RemoveNode {
                id: "table-2".into(),
            },
        )
        .unwrap();
        run(&mut p, Command::Undo).unwrap();
        assert_eq!(p.snapshot().tables[1].note.as_ref().unwrap().text, text);
    }
}
