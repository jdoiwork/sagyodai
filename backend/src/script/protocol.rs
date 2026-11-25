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
    if let Some(data) = &t.output
        && data.columns.iter().any(|c| {
            c.config.data_type != crate::column_types::DataType::String || c.config.nullable
        })
    {
        return encode_typed(data, format);
    }
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
    for raw in &t.rows {
        let row: Vec<String> = raw
            .iter()
            .enumerate()
            .map(|(i, s)| {
                if t.kind == crate::domain::Kind::Input {
                    t.column_schema
                        .get(i)
                        .map(|c| c.config.parse(s).map(|v| v.text()))
                        .unwrap_or_else(|| Ok(s.clone()))
                } else {
                    Ok(s.clone())
                }
            })
            .collect::<Result<_, String>>()?;
        if row.len() != t.columns.len() {
            return Err("入力の列数が一致しません。".into());
        }
        match format {
            RowFormat::List => serde_json::to_writer(&mut bytes, &row),
            RowFormat::Dict => serde_json::to_writer(
                &mut bytes,
                &t.columns.iter().zip(&row).collect::<BTreeMap<_, _>>(),
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
    let version: serde_json::Value =
        serde_json::from_str(text.lines().next().ok_or("出力の列情報がありません。")?)
            .map_err(|e| format!("出力の列情報が不正です: {e}"))?;
    if version.get("version").and_then(|v| v.as_u64()) == Some(2) {
        return decode_typed(text, format);
    }
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
        typed: None,
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
        typed: None,
        columns: vec!["本文".into()],
        rows: vec![vec![text.into()]],
    })
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TypedHeader {
    format: String,
    version: u32,
    columns: Vec<crate::column_types::Column>,
}
fn encode_typed(data: &crate::column_types::Data, format: RowFormat) -> Result<Vec<u8>, String> {
    crate::column_types::validate_data(data)?;
    let names: Vec<_> = data.columns.iter().map(|c| c.name.clone()).collect();
    if format == RowFormat::Dict {
        unique_columns(&names)?;
    }
    let mut bytes = serde_json::to_vec(&TypedHeader {
        format: "sagyodai-table".into(),
        version: 2,
        columns: data.columns.clone(),
    })
    .map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    for row in &data.rows {
        match format {
            RowFormat::List => serde_json::to_writer(&mut bytes, row),
            RowFormat::Dict => serde_json::to_writer(
                &mut bytes,
                &names.iter().zip(row).collect::<BTreeMap<_, _>>(),
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
// v2のdictも重複キーを拒否する。通常のserde_json::Valueは同名キーを上書きする。
struct TypedDict(BTreeMap<String, crate::column_types::Value>);
impl<'de> Deserialize<'de> for TypedDict {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = TypedDict;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("列名から型付き値へのオブジェクト")
            }
            fn visit_map<M: serde::de::MapAccess<'de>>(
                self,
                mut a: M,
            ) -> Result<Self::Value, M::Error> {
                let mut map = BTreeMap::new();
                while let Some((k, v)) = a.next_entry::<String, crate::column_types::Value>()? {
                    if map.insert(k, v).is_some() {
                        return Err(serde::de::Error::custom("キーが重複しています。"));
                    }
                }
                Ok(TypedDict(map))
            }
        }
        d.deserialize_map(Visitor)
    }
}
fn decode_typed(text: &str, format: RowFormat) -> Result<Data, String> {
    let mut lines = text.lines();
    let header: TypedHeader =
        serde_json::from_str(lines.next().ok_or("出力の列情報がありません。")?)
            .map_err(|e| e.to_string())?;
    if header.format != "sagyodai-table" || header.version != 2 || header.columns.is_empty() {
        return Err("型付き表の形式が不正です。".into());
    }
    crate::column_types::validate_columns(&header.columns)?;
    let names: Vec<_> = header.columns.iter().map(|c| c.name.clone()).collect();
    if format == RowFormat::Dict {
        unique_columns(&names)?;
    }
    let mut rows = vec![];
    for line in lines {
        let row = match format {
            RowFormat::List => {
                serde_json::from_str(line).map_err(|e| format!("出力行が不正です: {e}"))?
            }
            RowFormat::Dict => {
                let TypedDict(mut map) = serde_json::from_str(line).map_err(|e| e.to_string())?;
                if map.len() != names.len() {
                    return Err("出力のキーが列名と一致しません。".into());
                }
                names
                    .iter()
                    .map(|n| {
                        map.remove(n)
                            .ok_or_else(|| "出力のキーが不足しています。".to_string())
                    })
                    .collect::<Result<Vec<_>, _>>()?
            }
        };
        rows.push(row);
        if rows.len() > crate::storage::MAX_ROWS {
            return Err("出力の行数が上限を超えています。".into());
        }
    }
    let data = crate::column_types::Data {
        columns: header.columns,
        rows,
    };
    crate::column_types::validate_data(&data)?;
    Ok(Data {
        columns: names,
        rows: data
            .rows
            .iter()
            .map(|r| r.iter().map(crate::column_types::Value::text).collect())
            .collect(),
        typed: Some(data),
    })
}
