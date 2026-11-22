//! ブラウザ版のプロジェクトファイル。ディスクへの書き込みはブラウザの保存機能に任せる。
use crate::domain::{Kind, Table};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const FORMAT_VERSION: u32 = 2;
pub const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_NODES: usize = 100;
pub const MAX_ROWS: usize = 5000;
pub const MAX_COLS: usize = 50;
pub const MAX_CELL_BYTES: usize = 100_000;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectFile {
    pub format: String,
    pub format_version: u32,
    pub tables: Vec<Table>,
    #[serde(default = "crate::sheets::default_sheets")]
    pub sheets: Vec<crate::sheets::Sheet>,
}

#[cfg(test)]
pub fn encode(tables: &[Table]) -> Result<Vec<u8>, String> {
    encode_project(tables, &crate::sheets::default_sheets())
}
pub fn encode_project(
    tables: &[Table],
    sheets: &[crate::sheets::Sheet],
) -> Result<Vec<u8>, String> {
    let file = ProjectFile {
        format: "sagyodai".into(),
        format_version: FORMAT_VERSION,
        tables: tables.to_vec(),
        sheets: sheets.to_vec(),
    };
    let bytes = serde_json::to_vec_pretty(&file).map_err(|_| "ファイルを生成できませんでした。")?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err("プロジェクトファイルの上限は8 MiBです。".into());
    }
    Ok(bytes)
}

#[cfg(test)]
pub fn decode(value: serde_json::Value) -> Result<Vec<Table>, String> {
    Ok(decode_project(value)?.tables)
}
pub fn decode_project(value: serde_json::Value) -> Result<ProjectFile, String> {
    if value.get("format").and_then(|v| v.as_str()) != Some("sagyodai") {
        return Err("作業台のプロジェクトファイルではありません。".into());
    }
    if value.get("formatVersion").and_then(|v| v.as_u64()) != Some(FORMAT_VERSION.into()) {
        return Err("このプロジェクト形式のバージョンには対応していません。".into());
    }
    let file: ProjectFile =
        serde_json::from_value(value).map_err(|_| "プロジェクトファイルの構造が不正です。")?;
    if file.tables.is_empty() || file.tables.len() > MAX_NODES {
        return Err(format!("ノード数は1〜{MAX_NODES}個にしてください。"));
    }
    let mut ids = HashSet::new();
    for table in &file.tables {
        table.view.validate()?;
        if table.footer.as_ref().is_some_and(|f| {
            f.len() > table.columns.len() || !matches!(table.kind, Kind::Input | Kind::Display)
        }) {
            return Err("フッターの指定が不正です。".into());
        }
        if table.id.is_empty() || table.id.len() > 128 || !ids.insert(&table.id) {
            return Err("表のIDが空、長すぎる、または重複しています。".into());
        }
        if table.column_widths.len() > table.columns.len()
            || table
                .column_widths
                .iter()
                .any(|w| !w.is_finite() || !(60.0..=1200.0).contains(w))
        {
            return Err("列幅の指定が不正です。".into());
        }
        if table.title.len() > 1024 || table.columns.iter().any(|c| c.len() > 1024) {
            return Err("表名または列名が長すぎます。".into());
        }
        if (table.kind == Kind::Input && table.columns.is_empty())
            || table.columns.len() > MAX_COLS
            || (table.kind == Kind::Input && table.rows.is_empty())
            || table.rows.len() > MAX_ROWS
        {
            return Err("表の大きさは1〜5000行・1〜50列にしてください。".into());
        }
        if table
            .rows
            .iter()
            .any(|r| r.len() != table.columns.len() || r.iter().any(|c| c.len() > MAX_CELL_BYTES))
        {
            return Err("行の列数が一致しないか、セルの内容が長すぎます。".into());
        }
        if !valid_layout(table.x, table.y, table.width, table.height) {
            return Err("表の位置またはサイズが不正です。".into());
        }
    }
    crate::sheets::validate(&file.sheets, &file.tables)?;
    crate::graph::order(&file.tables)?;
    // 開けるのに再保存できないデータを受け入れない。
    encode_project(&file.tables, &file.sheets)?;
    Ok(file)
}

pub fn valid_layout(x: f64, y: f64, width: f64, height: f64) -> bool {
    [x, y, width, height].iter().all(|v| v.is_finite())
        && (380.0..=2400.0).contains(&width)
        && (240.0..=1600.0).contains(&height)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::sample_table;
    fn value() -> serde_json::Value {
        serde_json::from_slice(&encode(&[sample_table("table-1".into(), 0)]).unwrap()).unwrap()
    }
    #[test]
    fn file_round_trip_preserves_japanese_multiline_and_layout() {
        let mut t = sample_table("table-7".into(), 0);
        t.rows[0][0] = "日本語\n\"引用\"\tタブ".into();
        t.x = -24.5;
        t.width = 900.0;
        let restored =
            decode(serde_json::from_slice(&encode(&[t.clone()]).unwrap()).unwrap()).unwrap();
        assert_eq!(
            serde_json::to_value(restored).unwrap(),
            serde_json::to_value(vec![t]).unwrap()
        );
    }
    #[test]
    fn rejects_unknown_version_duplicate_ids_and_ragged_rows() {
        let mut v = value();
        v["formatVersion"] = 99.into();
        assert!(decode(v).unwrap_err().contains("バージョン"));
        let mut v = value();
        let t = v["tables"][0].clone();
        v["tables"].as_array_mut().unwrap().push(t);
        assert!(decode(v).unwrap_err().contains("ID"));
        let mut v = value();
        v["tables"][0]["rows"][0] = serde_json::json!(["短い"]);
        assert!(decode(v).unwrap_err().contains("列数"));
        let mut v = value();
        v["tables"][0]["width"] = 0.into();
        assert!(decode(v).unwrap_err().contains("サイズ"));
    }
}
