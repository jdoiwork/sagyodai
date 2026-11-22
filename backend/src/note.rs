//! メモは表データと接続を持たない、保存対象の注釈ノード。
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
        if !table.columns.is_empty()
            || !table.rows.is_empty()
            || !table.sources().is_empty()
            || table.manual
        {
            return Err("メモノードはデータや接続を持てません。".into());
        }
    }
    Ok(())
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
    fn notes_save_restore_undo_conflicts_and_cannot_connect() {
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
        assert!(
            run(
                &mut p,
                Command::Connect {
                    id: "table-3".into(),
                    source: Some("table-2".into())
                }
            )
            .is_err()
        );
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
