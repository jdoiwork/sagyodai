//! ファイルパスではなく読み込み済みの表を保存するCSV入力。
use crate::domain::{Kind, Table};
use crate::storage::{MAX_CELL_BYTES, MAX_COLS, MAX_ROWS};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_CSV_BYTES: usize = 1024 * 1024;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CsvSource {
    pub file_name: String,
    pub has_headers: bool,
}
fn valid_name(name: &str) -> bool {
    !name.trim().is_empty() && name.len() <= 1024 && !name.contains(['/', '\\'])
}
pub fn validate(table: &Table) -> Result<(), String> {
    if let Some(csv) = &table.csv {
        if table.kind != Kind::Csv || !valid_name(&csv.file_name) || table.columns.is_empty() {
            return Err("CSV入力の保存内容が不正です。".into());
        }
    } else if table.kind == Kind::Csv && (!table.columns.is_empty() || !table.rows.is_empty()) {
        return Err("CSV入力のファイル情報がありません。".into());
    }
    Ok(())
}
pub fn import(
    table: &mut Table,
    file_name: String,
    text: &str,
    has_headers: bool,
) -> Result<(), String> {
    if table.kind != Kind::Csv {
        return Err("CSV入力ノードではありません。".into());
    }
    if !valid_name(&file_name) {
        return Err("CSVのファイル名が不正です。".into());
    }
    if text.len() > MAX_CSV_BYTES {
        return Err("CSVファイルは1 MiB以内にしてください。".into());
    }
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .from_reader(text.as_bytes());
    let mut columns = Vec::new();
    let mut rows = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let record = record.map_err(|e| {
            format!("CSVの読み込みに失敗しました（列数などを確認してください）: {e}")
        })?;
        if record.len() > MAX_COLS {
            return Err("CSVは50列以内にしてください。".into());
        }
        if record.iter().any(|v| v.len() > MAX_CELL_BYTES) {
            return Err("CSVのセルは100000バイト以内にしてください。".into());
        }
        if index == 0 {
            let mut used = HashSet::new();
            for (i, value) in record.iter().enumerate() {
                let base = if has_headers && !value.trim().is_empty() {
                    value.trim().to_string()
                } else {
                    format!("列{}", i + 1)
                };
                if base.len() > 1000 {
                    return Err("CSVの列名は1000バイト以内にしてください。".into());
                }
                let mut name = base.clone();
                let mut suffix = 2;
                while !used.insert(name.clone()) {
                    name = format!("{base} ({suffix})");
                    suffix += 1;
                }
                columns.push(name);
            }
            if has_headers {
                continue;
            }
        }
        if rows.len() >= MAX_ROWS {
            return Err("CSVのデータ行は5000行以内にしてください。".into());
        }
        rows.push(record.iter().map(str::to_string).collect());
    }
    if columns.is_empty() {
        return Err("CSVファイルが空です。".into());
    }
    // パース完了まで既存の出力を触らない。再読み込みでも列名や先頭ゼロは文字列として保持。
    if table.columns != columns {
        table.view = Default::default();
        table.column_widths.clear();
    }
    table.columns = columns;
    table.rows = rows;
    table.csv = Some(CsvSource {
        file_name,
        has_headers,
    });
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
    fn table() -> Table {
        let mut t = crate::domain::sample_table("csv".into(), 0);
        t.kind = Kind::Csv;
        t.columns.clear();
        t.rows.clear();
        t
    }
    #[test]
    fn parses_bom_quotes_newlines_and_preserves_strings() {
        let mut t = table();
        import(
            &mut t,
            "日本語.csv".into(),
            "\u{feff}品名,数量,メモ\r\n\"ペン,赤\",001,\"改行\nと\"\"引用\"\"\"\r\n",
            true,
        )
        .unwrap();
        assert_eq!(t.columns, ["品名", "数量", "メモ"]);
        assert_eq!(t.rows, [vec!["ペン,赤", "001", "改行\nと\"引用\""]]);
        import(&mut t, "header.csv".into(), ",名前,名前,名前 (2)\n", true).unwrap();
        assert_eq!(t.columns, ["列1", "名前", "名前 (2)", "名前 (2) (2)"]);
        assert!(t.rows.is_empty());
        import(&mut t, "no-header.csv".into(), "001,日本語\n002,abc", false).unwrap();
        assert_eq!(t.columns, ["列1", "列2"]);
        assert_eq!(t.rows[0], ["001", "日本語"]);
    }
    #[test]
    fn invalid_csv_and_limits_preserve_previous_output() {
        let mut t = table();
        import(&mut t, "ok.csv".into(), "A,B\n1,2", true).unwrap();
        let before = serde_json::to_value(&t).unwrap();
        for text in [
            String::new(),
            "A,B\n1".into(),
            "A\n".repeat(5002),
            vec!["A"; 51].join(","),
            "x".repeat(MAX_CSV_BYTES + 1),
            format!("A\n{}", "x".repeat(MAX_CELL_BYTES + 1)),
        ] {
            assert!(import(&mut t, "bad.csv".into(), &text, true).is_err());
            assert_eq!(serde_json::to_value(&t).unwrap(), before);
        }
    }
    fn run(p: &mut Project, command: Command) {
        p.apply(Request {
            expected_revision: p.snapshot().revision,
            command,
        })
        .unwrap();
    }
    #[test]
    fn import_propagates_roundtrips_and_undoes_with_manual_cache() {
        let mut p = Project::default();
        for kind in [Kind::Csv, Kind::Filter, Kind::Display] {
            run(
                &mut p,
                Command::AddNode {
                    kind,
                    position: None,
                    sheet_id: None,
                },
            );
        }
        run(
            &mut p,
            Command::Connect {
                id: "table-3".into(),
                source: Some("table-2".into()),
            },
        );
        run(
            &mut p,
            Command::Connect {
                id: "table-4".into(),
                source: Some("table-3".into()),
            },
        );
        let mut filter = p.snapshot().tables[2].filter.clone().unwrap();
        filter.value = "ペン".into();
        run(
            &mut p,
            Command::Configure {
                id: "table-3".into(),
                filter: Some(filter.clone()),
                manual: false,
            },
        );
        let import_command = |text: &str| Command::ImportCsv {
            id: "table-2".into(),
            file_name: "商品.csv".into(),
            text: text.into(),
            has_headers: true,
        };
        run(&mut p, import_command("品名,数量\nペン,001\nノート,2"));
        assert_eq!(p.snapshot().tables[3].rows, [vec!["ペン", "001"]]);
        let saved = p.export().unwrap();
        let restored = storage::decode(serde_json::from_slice(&saved).unwrap()).unwrap();
        assert_eq!(restored[1].csv.as_ref().unwrap().file_name, "商品.csv");
        assert_eq!(restored[1].rows, p.snapshot().tables[1].rows);
        let revision = p.snapshot().revision;
        assert!(
            p.apply(Request {
                expected_revision: revision,
                command: import_command("A,B\n1")
            })
            .is_err()
        );
        assert_eq!(p.snapshot().revision, revision);
        assert_eq!(p.export().unwrap(), saved);
        run(
            &mut p,
            Command::Configure {
                id: "table-3".into(),
                filter: Some(filter),
                manual: true,
            },
        );
        run(&mut p, import_command("品名,数量\nペン,009"));
        assert!(p.snapshot().tables[2].stale);
        assert_eq!(p.snapshot().tables[3].rows, [vec!["ペン", "001"]]);
        run(&mut p, Command::Undo);
        assert_eq!(p.snapshot().tables[1].rows.len(), 2);
        run(&mut p, Command::Redo);
        run(
            &mut p,
            Command::Run {
                id: "table-3".into(),
            },
        );
        assert_eq!(p.snapshot().tables[3].rows, [vec!["ペン", "009"]]);
        let revision = p.snapshot().revision;
        assert!(
            p.apply(Request {
                expected_revision: revision,
                command: Command::Connect {
                    id: "table-2".into(),
                    source: Some("table-1".into())
                }
            })
            .is_err()
        );
        assert!(
            p.apply(Request {
                expected_revision: revision - 1,
                command: import_command("A\nold")
            })
            .is_err()
        );
    }
}
