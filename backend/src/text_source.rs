//! UTF-8テキストを改行ごとに1列の表へ変換し、原文と一緒に保存する。
use crate::domain::{Kind, Table};
use crate::storage::{MAX_CELL_BYTES, MAX_ROWS};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextDisplay {
    #[default]
    Markdown,
    Plain,
}

pub const MAX_TEXT_BYTES: usize = 1024 * 1024;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextSource {
    pub file_name: String,
    pub text: String,
}
fn rows(text: &str) -> Result<Vec<Vec<String>>, String> {
    if text.len() > MAX_TEXT_BYTES {
        return Err("テキストファイルは1 MiB以内にしてください。".into());
    }
    let lines: Vec<_> = text.split('\n').collect();
    if lines.len() > MAX_ROWS {
        return Err("テキストは5000行以内にしてください（空行も含みます）。".into());
    }
    if lines.iter().any(|line| line.len() > MAX_CELL_BYTES) {
        return Err("テキストの1行は100000バイト以内にしてください。".into());
    }
    Ok(lines
        .into_iter()
        .map(|line| vec![line.strip_suffix('\r').unwrap_or(line).to_string()])
        .collect())
}
fn valid_name(name: &str) -> bool {
    !name.trim().is_empty() && name.len() <= 1024 && !name.contains(['/', '\\'])
}
pub fn validate(table: &Table) -> Result<(), String> {
    if let Some(source) = &table.text_source {
        if table.kind != Kind::Text || !valid_name(&source.file_name) {
            return Err("テキスト入力のファイル情報が不正です。".into());
        }
        if table.columns != ["本文"] || table.rows != rows(&source.text)? {
            return Err("テキスト入力の原文と出力が一致しません。".into());
        }
    } else if table.kind == Kind::Text && (!table.columns.is_empty() || !table.rows.is_empty()) {
        return Err("テキスト入力のファイル情報がありません。".into());
    }
    Ok(())
}
pub fn import(table: &mut Table, file_name: String, text: String) -> Result<(), String> {
    if table.kind != Kind::Text || !valid_name(&file_name) {
        return Err("テキスト入力ノードまたはファイル名が不正です。".into());
    }
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text).to_string();
    let rows = rows(&text)?;
    if table.columns != ["本文"] {
        table.view = Default::default();
        table.column_widths.clear();
    }
    table.columns = vec!["本文".into()];
    table.rows = rows;
    table.text_source = Some(TextSource { file_name, text });
    table.stale = false;
    table.error = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        application::Project,
        domain::{Command, Request},
        storage,
    };
    fn run(p: &mut Project, command: Command) -> Result<crate::domain::Snapshot, String> {
        p.apply(Request {
            expected_revision: p.snapshot().revision,
            command,
        })
    }
    #[test]
    fn display_mode_roundtrips_undoes_and_leaves_manual_output_fresh() {
        let mut p = Project::default();
        for kind in [Kind::Text, Kind::Display] {
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
        run(
            &mut p,
            Command::ImportText {
                id: "table-2".into(),
                file_name: "a.txt".into(),
                text: "# 日本語\n  本文".into(),
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
        run(
            &mut p,
            Command::Configure {
                id: "table-3".into(),
                filter: None,
                manual: true,
            },
        )
        .unwrap();
        let before = p.snapshot().tables;
        run(
            &mut p,
            Command::SetTextDisplay {
                id: "table-2".into(),
                display: TextDisplay::Plain,
            },
        )
        .unwrap();
        let now = p.snapshot().tables;
        assert_eq!(now[1].rows, before[1].rows);
        assert_eq!(now[2].rows, before[2].rows);
        assert!(!now[2].stale);
        let restored =
            Project::restore(serde_json::from_slice(&p.export().unwrap()).unwrap(), 0).unwrap();
        assert_eq!(
            restored.snapshot().tables[1].text_display,
            TextDisplay::Plain
        );
        run(&mut p, Command::Undo).unwrap();
        assert_eq!(p.snapshot().tables[1].text_display, TextDisplay::Markdown);
        run(&mut p, Command::Redo).unwrap();
        assert_eq!(p.snapshot().tables[1].text_display, TextDisplay::Plain);
        assert!(
            run(
                &mut p,
                Command::SetTextDisplay {
                    id: "table-1".into(),
                    display: TextDisplay::Plain
                }
            )
            .is_err()
        );
    }
    #[test]
    fn preserves_lines_bom_whitespace_and_rejects_invalid_imports_atomically() {
        let mut t = crate::domain::sample_table("text".into(), 0);
        t.kind = Kind::Text;
        for (text, expected) in [
            ("", vec![""]),
            (
                "\u{feff}日本語\r\n\r\n 001 \n",
                vec!["日本語", "", " 001 ", ""],
            ),
        ] {
            import(&mut t, "入力.txt".into(), text.into()).unwrap();
            assert_eq!(
                t.rows,
                expected
                    .into_iter()
                    .map(|s| vec![s.to_string()])
                    .collect::<Vec<_>>()
            );
            validate(&t).unwrap();
        }
        let before = serde_json::to_value(&t).unwrap();
        for text in [
            "x".repeat(MAX_TEXT_BYTES + 1),
            "x".repeat(MAX_CELL_BYTES + 1),
            "\n".repeat(MAX_ROWS),
        ] {
            assert!(import(&mut t, "bad.txt".into(), text).is_err());
            assert_eq!(serde_json::to_value(&t).unwrap(), before);
        }
        assert!(import(&mut t, "../bad.txt".into(), "bad".into()).is_err());
        assert_eq!(serde_json::to_value(&t).unwrap(), before);
        t.rows[0][0] = "改変".into();
        assert!(validate(&t).is_err());
    }
    #[test]
    fn propagates_to_filter_persists_and_supports_undo_manual_cache_and_stale_requests() {
        let mut p = Project::default();
        for kind in [Kind::Text, Kind::Filter, Kind::Display] {
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
        let import = |text: &str| Command::ImportText {
            id: "table-2".into(),
            file_name: "日本語.txt".into(),
            text: text.into(),
        };
        let mut filter = p.snapshot().tables[2].filter.clone().unwrap();
        filter.value = "猫".into();
        run(
            &mut p,
            Command::Configure {
                id: "table-3".into(),
                filter: Some(filter.clone()),
                manual: false,
            },
        )
        .unwrap();
        run(&mut p, import("猫\n犬\n猫")).unwrap();
        assert_eq!(p.snapshot().tables[3].rows, [vec!["猫"], vec!["猫"]]);
        let saved = p.export().unwrap();
        let restored = storage::decode(serde_json::from_slice(&saved).unwrap()).unwrap();
        assert_eq!(restored[1].text_source.as_ref().unwrap().text, "猫\n犬\n猫");
        assert_eq!(restored[3].rows, p.snapshot().tables[3].rows);
        run(
            &mut p,
            Command::Configure {
                id: "table-3".into(),
                filter: Some(filter),
                manual: true,
            },
        )
        .unwrap();
        run(&mut p, import("猫")).unwrap();
        assert!(p.snapshot().tables[2].stale);
        assert_eq!(p.snapshot().tables[3].rows.len(), 2);
        run(&mut p, Command::Undo).unwrap();
        assert_eq!(p.snapshot().tables[1].rows.len(), 3);
        run(&mut p, Command::Redo).unwrap();
        run(
            &mut p,
            Command::Run {
                id: "table-3".into(),
            },
        )
        .unwrap();
        assert_eq!(p.snapshot().tables[3].rows.len(), 1);
        let before = p.export().unwrap();
        assert!(run(&mut p, import(&"x".repeat(MAX_CELL_BYTES + 1))).is_err());
        assert!(
            p.apply(Request {
                expected_revision: 0,
                command: import("古い結果")
            })
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
        assert_eq!(p.export().unwrap(), before);
    }
}
