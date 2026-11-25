//! 原文と成功出力を分ける。整数はi64で計算し、JSONでは十進文字列として渡す。
use crate::domain::{Kind, Table};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum DataType {
    #[default]
    String,
    Integer,
    Boolean,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "mode",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum EmptyValue {
    Value(String),
    Null,
    Error,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TypeConfig {
    pub data_type: DataType,
    pub nullable: bool,
    pub empty: EmptyValue,
}
impl Default for TypeConfig {
    fn default() -> Self {
        Self {
            data_type: DataType::String,
            nullable: false,
            empty: EmptyValue::Value(String::new()),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Column {
    pub id: String,
    pub name: String,
    pub config: TypeConfig,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum Value {
    String(String),
    Integer(#[serde(with = "integer_string")] i64),
    Boolean(bool),
    Null,
}
mod integer_string {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(value: &i64, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&value.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
        String::deserialize(d)?
            .parse()
            .map_err(serde::de::Error::custom)
    }
}
impl Value {
    pub fn text(&self) -> String {
        match self {
            Self::String(s) => s.clone(),
            Self::Integer(n) => n.to_string(),
            Self::Boolean(b) => b.to_string(),
            Self::Null => "null".into(),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Data {
    pub columns: Vec<Column>,
    pub rows: Vec<Vec<Value>>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CellError {
    pub row: usize,
    pub col: usize,
    pub message: String,
}
impl TypeConfig {
    pub fn validate(&self) -> Result<(), String> {
        match &self.empty {
            EmptyValue::Null if !self.nullable => {
                Err("nullを使うにはnull許容をオンにしてください。".into())
            }
            EmptyValue::Value(s) => {
                if s.len() > crate::storage::MAX_CELL_BYTES {
                    return Err("空欄の代替値が長すぎます。".into());
                }
                self.parse_nonempty(s).map(|_| ())
            }
            _ => Ok(()),
        }
    }
    fn parse_nonempty(&self, s: &str) -> Result<Value, String> {
        match self.data_type {
            DataType::String => Ok(Value::String(s.into())),
            DataType::Integer => {
                let s = s.trim();
                let digits = s.strip_prefix(['+', '-']).unwrap_or(s);
                if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
                    return Err("整数を入力してください（小数・指数表記は使えません）。".into());
                }
                s.parse::<i64>()
                    .map(Value::Integer)
                    .map_err(|_| "整数が64ビットの範囲を超えています。".into())
            }
            DataType::Boolean => match s.trim() {
                "true" => Ok(Value::Boolean(true)),
                "false" => Ok(Value::Boolean(false)),
                _ => Err("true または false を入力してください。".into()),
            },
        }
    }
    pub fn parse(&self, s: &str) -> Result<Value, String> {
        if !s.is_empty() {
            return self.parse_nonempty(s);
        }
        match &self.empty {
            EmptyValue::Value(v) => self.parse_nonempty(v),
            EmptyValue::Null if self.nullable => Ok(Value::Null),
            EmptyValue::Null => Err("この列はnullを許容しません。".into()),
            EmptyValue::Error => Err("空欄は許可されていません。".into()),
        }
    }
    pub fn accepts(&self, value: &Value) -> bool {
        matches!(
            (self.data_type, value),
            (DataType::String, Value::String(_))
                | (DataType::Integer, Value::Integer(_))
                | (DataType::Boolean, Value::Boolean(_))
        ) || (self.nullable && *value == Value::Null)
    }
}
// 列の新規作成時だけ発番する。名前・位置の変更やUndoでIDを作り直さない。
pub fn new_column(table: &Table, name: String) -> Column {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|t| t.as_nanos())
        .unwrap_or_default();
    Column {
        id: format!(
            "{}-{time:x}-{}",
            table.id,
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ),
        name,
        config: TypeConfig::default(),
    }
}
pub fn ensure_schema(table: &mut Table) {
    table.column_schema.truncate(table.columns.len());
    while table.column_schema.len() < table.columns.len() {
        let col = new_column(table, table.columns[table.column_schema.len()].clone());
        table.column_schema.push(col);
    }
    for (col, name) in table.column_schema.iter_mut().zip(&table.columns) {
        col.name.clone_from(name);
    }
}
pub fn refresh_source(table: &mut Table) {
    table.column_schema = table
        .columns
        .iter()
        .map(|name| {
            table
                .column_schema
                .iter()
                .find(|c| &c.name == name)
                .cloned()
                .unwrap_or_else(|| new_column(table, name.clone()))
        })
        .collect();
    if !table.stale && table.error.is_none() {
        table.output = Some(strings(table));
    }
}
pub fn strings(table: &Table) -> Data {
    Data {
        columns: table.column_schema.clone(),
        rows: table
            .rows
            .iter()
            .map(|r| r.iter().cloned().map(Value::String).collect())
            .collect(),
    }
}
pub fn refresh_input(table: &mut Table) {
    ensure_schema(table);
    table.cell_errors.clear();
    let mut rows = vec![];
    for (r, row) in table.rows.iter().enumerate() {
        let mut values = vec![];
        for (c, (raw, column)) in row.iter().zip(&table.column_schema).enumerate() {
            match column.config.parse(raw) {
                Ok(value) => values.push(value),
                Err(message) => table.cell_errors.push(CellError {
                    row: r,
                    col: c,
                    message,
                }),
            }
        }
        rows.push(values);
    }
    table.stale = !table.cell_errors.is_empty();
    table.error = table.cell_errors.first().map(|e| {
        format!(
            "{}行 {}列: {}（型エラー{}件）",
            e.row + 1,
            e.col + 1,
            e.message,
            table.cell_errors.len()
        )
    });
    if !table.stale {
        table.output = Some(Data {
            columns: table.column_schema.clone(),
            rows,
        });
    }
}
pub fn commit(table: &mut Table, data: Data) {
    let positions: Vec<_> = data
        .columns
        .iter()
        .map(|c| table.column_schema.iter().position(|old| old.id == c.id))
        .collect();
    if !table.column_widths.is_empty() {
        table.column_widths = positions
            .iter()
            .map(|p| {
                p.and_then(|i| table.column_widths.get(i))
                    .copied()
                    .unwrap_or(160.0)
            })
            .collect();
    }
    if let Some(footer) = &table.footer {
        table.footer = Some(
            positions
                .iter()
                .map(|p| p.and_then(|i| footer.get(i)).copied().unwrap_or_default())
                .collect(),
        );
    }
    table.columns = data.columns.iter().map(|c| c.name.clone()).collect();
    table.column_schema = data.columns.clone();
    table.rows = data
        .rows
        .iter()
        .map(|r| r.iter().map(Value::text).collect())
        .collect();
    table.output = Some(data);
    table.cell_errors.clear();
    table.stale = false;
    table.error = None;
}
pub fn set_column(
    table: &mut Table,
    id: &str,
    config: TypeConfig,
    expected: TypeConfig,
) -> Result<(), String> {
    if table.kind != Kind::Input {
        return Err("手入力以外は型変換ノードで型を指定してください。".into());
    }
    config.validate()?;
    ensure_schema(table);
    let col = table
        .column_schema
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or("列が見つかりません。")?;
    if col.config != expected {
        return Err("列の型設定が変更されています。最新の設定を確認してください。".into());
    }
    col.config = config;
    Ok(())
}
pub fn validate(table: &Table) -> Result<(), String> {
    if table.column_schema.len() != table.columns.len() {
        return Err("列の型情報と列数が一致しません。".into());
    }
    validate_columns(&table.column_schema)?;
    if table
        .column_schema
        .iter()
        .zip(&table.columns)
        .any(|(c, n)| &c.name != n)
    {
        return Err("列の型情報と列名が一致しません。".into());
    }
    for config in table.type_conversion.values() {
        config.validate()?;
    }
    if table.type_conversion.len() > crate::storage::MAX_COLS
        || (table.kind != Kind::Convert && !table.type_conversion.is_empty())
    {
        return Err("型変換設定が不正です。".into());
    }
    if let Some(data) = &table.output {
        validate_data(data)?;
        if table.kind != Kind::Input
            && (data.columns != table.column_schema
                || data
                    .rows
                    .iter()
                    .map(|r| r.iter().map(Value::text).collect::<Vec<_>>())
                    .collect::<Vec<_>>()
                    != table.rows)
        {
            return Err("表示データと成功キャッシュが一致しません。".into());
        }
    } else if table.kind != Kind::Input && !table.rows.is_empty() {
        return Err("成功キャッシュのない結果行は読み込めません。".into());
    }
    if table.kind == Kind::Input {
        let mut checked = table.clone();
        refresh_input(&mut checked);
        if checked.stale != table.stale
            || checked.cell_errors != table.cell_errors
            || (!checked.stale && checked.output != table.output)
        {
            return Err("入力原文・型設定と検証結果が一致しません。".into());
        }
    }
    if table
        .cell_errors
        .iter()
        .any(|e| e.row >= table.rows.len() || e.col >= table.columns.len())
    {
        return Err("セルエラーの位置が不正です。".into());
    }
    Ok(())
}
pub fn validate_columns(cols: &[Column]) -> Result<(), String> {
    let mut ids = std::collections::HashSet::new();
    if cols.len() > crate::storage::MAX_COLS {
        return Err("列数が上限を超えています。".into());
    }
    for c in cols {
        if c.id.is_empty() || c.id.len() > 256 || !ids.insert(&c.id) || c.name.len() > 1024 {
            return Err("列IDまたは列名が不正です。".into());
        }
        c.config.validate()?;
    }
    Ok(())
}
pub fn validate_data(data: &Data) -> Result<(), String> {
    validate_columns(&data.columns)?;
    if data.rows.len() > crate::storage::MAX_ROWS {
        return Err("行数が上限を超えています。".into());
    }
    for row in &data.rows {
        if row.len() != data.columns.len() {
            return Err("成功キャッシュの列数が一致しません。".into());
        }
        for (value, col) in row.iter().zip(&data.columns) {
            if !col.config.accepts(value)
                || value.text().len() > crate::storage::MAX_OUTPUT_CELL_BYTES
            {
                return Err("成功キャッシュの型またはサイズが不正です。".into());
            }
        }
    }
    Ok(())
}
