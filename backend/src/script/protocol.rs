//! JSONLのヘッダーと行形式。dictのキーは列名に完全一致させ、欠落・重複を拒否する。
use super::{Data, OutputMode};
use crate::domain::Table;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RowFormat {
    #[default]
    List,
    Dict,
}
fn unique_columns(columns: &[String]) -> Result<(), String> {
    if columns.iter().collect::<HashSet<_>>().len() != columns.len() {
        return Err("dict形式では列名を重複させられません。".into());
    }
    Ok(())
}
// 通常のMapデシリアライズは同名キーを上書きするため、ここでは明示的に拒否する。
struct DictRow(BTreeMap<String, String>);
impl<'de> Deserialize<'de> for DictRow {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = DictRow;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("列名から文字列へのオブジェクト")
            }
            fn visit_map<M: serde::de::MapAccess<'de>>(
                self,
                mut access: M,
            ) -> Result<Self::Value, M::Error> {
                let mut map = BTreeMap::new();
                while let Some((key, value)) = access.next_entry::<String, String>()? {
                    if map.insert(key, value).is_some() {
                        return Err(serde::de::Error::custom("キーが重複しています。"));
                    }
                }
                Ok(DictRow(map))
            }
        }
        deserializer.deserialize_map(Visitor)
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    format: String,
    version: u32,
    columns: Vec<String>,
}
pub const MAX_BYTES: usize = 10 * 1024 * 1024;
pub fn encode(t: &Table, format: RowFormat) -> Result<Vec<u8>, String> {
    if format == RowFormat::Dict {
        unique_columns(&t.columns)?;
    }
    let mut bytes = serde_json::to_vec(&Header {
        format: "sagyodai-table".into(),
        version: 1,
        columns: t.columns.clone(),
    })
    .map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    for row in &t.rows {
        if row.len() != t.columns.len() {
            return Err("入力の列数が一致しません。".into());
        }
        match format {
            RowFormat::List => serde_json::to_writer(&mut bytes, row),
            RowFormat::Dict => serde_json::to_writer(
                &mut bytes,
                &t.columns.iter().zip(row).collect::<BTreeMap<_, _>>(),
            ),
        }
        .map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        if bytes.len() > MAX_BYTES {
            return Err("スクリプト入力は10 MiB以内です。".into());
        }
    }
    Ok(bytes)
}
pub fn decode(bytes: &[u8], format: RowFormat) -> Result<Data, String> {
    if bytes.len() > MAX_BYTES {
        return Err("スクリプト出力は10 MiB以内です。".into());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "出力がUTF-8ではありません。")?;
    let mut lines = text.lines();
    let header: Header = serde_json::from_str(lines.next().ok_or("出力の列情報がありません。")?)
        .map_err(|e| format!("出力の列情報が不正です: {e}"))?;
    if header.format != "sagyodai-table"
        || header.version != 1
        || header.columns.is_empty()
        || header.columns.len() > 50
        || header.columns.iter().any(|s| s.len() > 1024)
    {
        return Err("出力の形式・バージョン・列数が不正です。".into());
    }
    if format == RowFormat::Dict {
        unique_columns(&header.columns)?;
    }
    let mut rows = Vec::new();
    for line in lines {
        let row: Vec<String> = match format {
            RowFormat::List => serde_json::from_str(line)
                .map_err(|e| format!("出力{}行目が不正です: {e}", rows.len() + 2))?,
            RowFormat::Dict => {
                let DictRow(mut map) = serde_json::from_str(line)
                    .map_err(|e| format!("出力{}行目が不正です: {e}", rows.len() + 2))?;
                if map.len() != header.columns.len()
                    || header.columns.iter().any(|c| !map.contains_key(c))
                {
                    return Err(format!(
                        "出力{}行目のキーが列名と一致しません。",
                        rows.len() + 2
                    ));
                }
                header
                    .columns
                    .iter()
                    .map(|c| {
                        map.remove(c)
                            .ok_or_else(|| "出力のキーが不足しています。".to_string())
                    })
                    .collect::<Result<_, _>>()?
            }
        };
        if row.len() != header.columns.len() || rows.len() >= 5000 {
            return Err("出力の列数が一致しないか、5000行を超えています。".into());
        }
        rows.push(row);
    }
    Ok(Data {
        columns: header.columns,
        rows,
    })
}
pub fn decode_output(bytes: &[u8], mode: OutputMode, format: RowFormat) -> Result<Data, String> {
    if mode == OutputMode::Table {
        return decode(bytes, format);
    }
    if bytes.len() > MAX_BYTES {
        return Err("スクリプト出力は10 MiB以内です。".into());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "出力がUTF-8ではありません。")?;
    // 改行・空白・空出力をそのまま保持し、既存の結果テキストへ渡せる1セルにする。
    Ok(Data {
        columns: vec!["本文".into()],
        rows: vec![vec![text.into()]],
    })
}
