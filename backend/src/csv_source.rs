//! ファイルパスではなく読み込み済みの表を保存するCSV入力。
use crate::domain::{Kind, Table};
use crate::storage::{MAX_CELL_BYTES, MAX_COLS, MAX_ROWS};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_CSV_BYTES: usize = 1024 * 1024;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CsvSource {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original: Option<CsvData>,
    pub file_name: String,
    pub has_headers: bool,
    #[serde(default)]
    pub skip_empty_rows: bool,
    #[serde(default)]
    pub skip_empty_columns: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CsvData {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}
fn valid_name(name: &str) -> bool {
    !name.trim().is_empty() && name.len() <= 1024 && !name.contains(['/', '\\'])
}
pub fn validate(table: &Table) -> Result<(), String> {
    if let Some(csv) = &table.csv {
        if csv
            .source_text
            .as_ref()
            .is_some_and(|text| text.len() > MAX_CSV_BYTES)
        {
            return Err("CSVの元データは1 MiB以内にしてください。".into());
        }
        if let Some(data) = &csv.original
            && (data.columns.is_empty()
                || data.columns.len() > MAX_COLS
                || data.columns.iter().any(|c| c.len() > 1024)
                || data.rows.len() > MAX_ROWS
                || data.rows.iter().any(|row| {
                    row.len() != data.columns.len() || row.iter().any(|v| v.len() > MAX_CELL_BYTES)
                }))
        {
            return Err("CSVの元データが不正です。".into());
        }
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
    skip_empty_rows: bool,
    skip_empty_columns: bool,
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
    let mut rows: Vec<Vec<String>> = Vec::new();
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
    let original = CsvData { columns, rows };
    let (columns, rows) = filtered(&original, skip_empty_rows, skip_empty_columns)?;
    // パース完了まで既存の出力を触らない。再読み込みでも列名や先頭ゼロは文字列として保持。
    if table.columns != columns {
        table.view = Default::default();
        table.column_widths.clear();
    }
    table.columns = columns;
    table.rows = rows;
    table.csv = Some(CsvSource {
        source_text: Some(text.to_string()),
        original: None,
        file_name,
        has_headers,
        skip_empty_rows,
        skip_empty_columns,
    });
    table.stale = false;
    table.error = None;
    Ok(())
}

fn filtered(
    data: &CsvData,
    skip_empty_rows: bool,
    skip_empty_columns: bool,
) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let mut columns = data.columns.clone();
    let mut rows = data.rows.clone();
    // ヘッダーは空列の判定に含めない。データ0行のファイルは列定義を残す。
    if skip_empty_columns && !rows.is_empty() {
        let keep: Vec<usize> = (0..columns.len())
            .filter(|&col| rows.iter().any(|row| !row[col].is_empty()))
            .collect();
        if keep.is_empty() {
            return Err(
                "空列をスキップすると列がなくなります。オプションを外して読み込んでください。"
                    .into(),
            );
        }
        columns = keep.iter().map(|&col| columns[col].clone()).collect();
        rows = rows
            .into_iter()
            .map(|row| keep.iter().map(|&col| row[col].clone()).collect())
            .collect();
    }
    if skip_empty_rows {
        rows.retain(|row| row.iter().any(|value| !value.is_empty()));
    }
    Ok((columns, rows))
}

pub fn set_options(
    table: &mut Table,
    has_headers: bool,
    skip_empty_rows: bool,
    skip_empty_columns: bool,
) -> Result<(), String> {
    if table.kind != Kind::Csv {
        return Err("CSV入力ノードではありません。".into());
    }
    let mut csv = table
        .csv
        .clone()
        .ok_or("先にCSVファイルを読み込んでください。")?;
    if let Some(text) = &csv.source_text {
        return import(
            table,
            csv.file_name.clone(),
            text,
            has_headers,
            skip_empty_rows,
            skip_empty_columns,
        );
    }
    if has_headers != csv.has_headers {
        return Err("このCSVは元の1行目が保存されていません。一度だけファイルを選び直してください。以後は設定変更だけで反映できます。".into());
    }
    // 以前の版で除外済みのデータは復元できないため、推測で空行・空列を作らない。
    let original = match csv.original.take() {
        Some(data) => data,
        None if !csv.skip_empty_rows && !csv.skip_empty_columns => CsvData { columns: table.columns.clone(), rows: table.rows.clone() },
        None => return Err("このCSVは元データが保存されていません。一度だけファイルを選び直してください。以後は設定変更だけで反映できます。".into()),
    };
    let (columns, rows) = filtered(&original, skip_empty_rows, skip_empty_columns)?;
    if table.columns != columns {
        table.view = Default::default();
        table.column_widths.clear();
    }
    table.columns = columns;
    table.rows = rows;
    csv.original = Some(original);
    csv.skip_empty_rows = skip_empty_rows;
    csv.skip_empty_columns = skip_empty_columns;
    table.csv = Some(csv);
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
    fn import(
        table: &mut Table,
        file_name: String,
        text: &str,
        has_headers: bool,
    ) -> Result<(), String> {
        super::import(table, file_name, text, has_headers, false, false)
    }
    fn table() -> Table {
        let mut t = crate::domain::sample_table("csv".into(), 0);
        t.kind = Kind::Csv;
        t.columns.clear();
        t.rows.clear();
        t
    }
    #[test]
    fn header_toggle_restores_exact_first_row_after_save() {
        let mut t = table();
        let text = " 名前 ,名前,,数量\nペン,赤,,001\n,,,";
        super::import(&mut t, "元.csv".into(), text, true, true, true).unwrap();
        let saved = storage::encode(&[t]).unwrap();
        let mut tables = storage::decode(serde_json::from_slice(&saved).unwrap()).unwrap();
        let t = &mut tables[0];
        set_options(t, false, true, true).unwrap();
        assert_eq!(t.columns, ["列1", "列2", "列4"]);
        assert_eq!(t.rows[0], [" 名前 ", "名前", "数量"]);
        set_options(t, true, false, false).unwrap();
        assert_eq!(t.columns, ["名前", "名前 (2)", "列3", "数量"]);
        assert_eq!(
            t.rows,
            [vec!["ペン", "赤", "", "001"], vec!["", "", "", ""]]
        );
    }
    #[test]
    fn invalid_header_toggle_keeps_data_and_options() {
        let mut t = table();
        import(&mut t, "長い値.csv".into(), &"x".repeat(1001), false).unwrap();
        let before = t.clone();
        assert!(set_options(&mut t, true, false, false).is_err());
        assert_eq!(
            serde_json::to_value(t).unwrap(),
            serde_json::to_value(before).unwrap()
        );
        let mut t = table();
        import(&mut t, "上限.csv".into(), &"A\n".repeat(5001), true).unwrap();
        assert!(set_options(&mut t, false, true, false).is_err());
        assert!(t.csv.unwrap().has_headers);
    }
    #[test]
    fn skips_empty_rows_and_data_columns_independently_and_saves_options() {
        let text = "品名,空列,数量\nペン,,001\n,,\nノート,,2\n";
        let mut t = table();
        super::import(&mut t, "data.csv".into(), text, true, false, false).unwrap();
        assert_eq!(t.rows.len(), 3);
        assert_eq!(t.columns.len(), 3);
        super::import(&mut t, "data.csv".into(), text, true, true, false).unwrap();
        assert_eq!(t.rows.len(), 2);
        assert_eq!(t.columns.len(), 3);
        super::import(&mut t, "data.csv".into(), text, true, false, true).unwrap();
        assert_eq!(t.rows.len(), 3);
        assert_eq!(t.rows[1], ["", ""]);
        super::import(&mut t, "data.csv".into(), text, true, true, true).unwrap();
        assert_eq!(t.columns, ["品名", "数量"]);
        assert_eq!(t.rows, [vec!["ペン", "001"], vec!["ノート", "2"]]);
        let saved = storage::encode(&[t.clone()]).unwrap();
        let restored = storage::decode(serde_json::from_slice(&saved).unwrap()).unwrap();
        assert_eq!(restored[0].csv, t.csv);
        assert!(restored[0].csv.as_ref().unwrap().skip_empty_rows);
        assert!(restored[0].csv.as_ref().unwrap().skip_empty_columns);
        let before = serde_json::to_value(&t).unwrap();
        assert!(super::import(&mut t, "empty.csv".into(), "A,B\n,", true, true, true).is_err());
        assert_eq!(serde_json::to_value(&t).unwrap(), before);
        super::import(&mut t, "header.csv".into(), "A,B", true, true, true).unwrap();
        assert_eq!(t.columns, ["A", "B"]);
        assert!(t.rows.is_empty());
        super::import(
            &mut t,
            "no-header.csv".into(),
            "001,, \n,,",
            false,
            true,
            true,
        )
        .unwrap();
        assert_eq!(t.columns, ["列1", "列3"]);
        assert_eq!(t.rows, [vec!["001", " "]]);
    }
    #[test]
    fn options_restore_original_after_restart_propagate_and_undo() {
        let mut p = Project::default();
        for kind in [Kind::Csv, Kind::Display] {
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
            Command::ImportCsv {
                id: "table-2".into(),
                file_name: "元.csv".into(),
                text: "品名,空列,数量\nペン,,001\n,,\nノート,,2".into(),
                has_headers: true,
                skip_empty_rows: true,
                skip_empty_columns: true,
            },
        );
        assert_eq!(p.snapshot().tables[2].columns, ["品名", "数量"]);
        assert_eq!(p.snapshot().tables[2].rows.len(), 2);
        let value = serde_json::from_slice(&p.export().unwrap()).unwrap();
        let mut p = Project::restore(value, 0).unwrap();
        let options = |r, c| Command::SetCsvOptions {
            id: "table-2".into(),
            has_headers: true,
            skip_empty_rows: r,
            skip_empty_columns: c,
        };
        run(&mut p, options(false, false));
        assert_eq!(p.snapshot().tables[2].columns, ["品名", "空列", "数量"]);
        assert_eq!(p.snapshot().tables[2].rows[1], ["", "", ""]);
        run(&mut p, Command::Undo);
        assert_eq!(p.snapshot().tables[2].columns, ["品名", "数量"]);
        run(&mut p, Command::Redo);
        run(
            &mut p,
            Command::Configure {
                id: "table-3".into(),
                filter: None,
                manual: true,
            },
        );
        run(&mut p, options(true, true));
        assert!(p.snapshot().tables[2].stale);
        assert_eq!(p.snapshot().tables[2].rows.len(), 3);
        run(
            &mut p,
            Command::Run {
                id: "table-3".into(),
            },
        );
        assert_eq!(p.snapshot().tables[2].rows.len(), 2);
    }
    #[test]
    fn failed_options_preserve_source_and_output() {
        let mut t = table();
        import(&mut t, "空.csv".into(), "A,B\n,", true).unwrap();
        let before = serde_json::to_value(&t).unwrap();
        assert!(set_options(&mut t, true, true, true).is_err());
        assert_eq!(serde_json::to_value(&t).unwrap(), before);
        set_options(&mut t, true, true, false).unwrap();
        assert!(t.rows.is_empty());
        set_options(&mut t, true, false, false).unwrap();
        assert_eq!(t.rows, [vec!["", ""]]);
        t.csv.as_mut().unwrap().original = None;
        t.csv.as_mut().unwrap().source_text = None;
        t.csv.as_mut().unwrap().skip_empty_rows = true;
        assert!(
            set_options(&mut t, true, false, false)
                .unwrap_err()
                .contains("一度だけ")
        );
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
            skip_empty_rows: false,
            skip_empty_columns: false,
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
