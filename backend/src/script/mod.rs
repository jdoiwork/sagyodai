//! 文字列表を受け渡す外部スクリプト。型付き表の形式は将来別バージョンで定義する。
pub mod api;
mod runner;
#[cfg(test)]
mod tests;
use crate::domain::{Kind, Table};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum OutputMode {
    #[default]
    Table,
    Text,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub program: String,
    pub script_path: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub timeout_seconds: u64,
    #[serde(default)]
    pub output_mode: OutputMode,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            program: String::new(),
            script_path: String::new(),
            args: vec![],
            cwd: String::new(),
            timeout_seconds: 30,
            output_mode: OutputMode::Table,
        }
    }
}
impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=3600).contains(&self.timeout_seconds)
            || self.args.len() > 100
            || self.args.iter().any(|a| a.len() > 8192 || a.contains('\0'))
        {
            return Err("引数は100個・各8192バイト以内、制限時間は1〜3600秒です。".into());
        }
        for path in [&self.program, &self.script_path, &self.cwd] {
            if !std::path::Path::new(path).is_absolute() || path.len() > 4096 || path.contains('\0')
            {
                return Err(
                    "実行プログラム・スクリプト・作業フォルダを絶対パスで指定してください。".into(),
                );
            }
        }
        Ok(())
    }
    pub fn source(&self) -> Result<String, String> {
        use std::io::Read;
        self.validate()?;
        let mut bytes = Vec::new();
        std::fs::File::open(&self.script_path)
            .map_err(|e| format!("スクリプトを開けません: {e}"))?
            .take(100_001)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 100_000 {
            return Err("スクリプトは100000バイト以内です。".into());
        }
        String::from_utf8(bytes).map_err(|_| "スクリプトはUTF-8で保存してください。".into())
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Script {
    pub config: Config,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Data {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    format: String,
    version: u32,
    columns: Vec<String>,
}
pub const MAX_BYTES: usize = 10 * 1024 * 1024;
pub fn encode(t: &Table) -> Result<Vec<u8>, String> {
    let mut bytes = serde_json::to_vec(&Header {
        format: "sagyodai-table".into(),
        version: 1,
        columns: t.columns.clone(),
    })
    .map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    for row in &t.rows {
        serde_json::to_writer(&mut bytes, row).map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        if bytes.len() > MAX_BYTES {
            return Err("スクリプト入力は10 MiB以内です。".into());
        }
    }
    Ok(bytes)
}
pub fn decode(bytes: &[u8]) -> Result<Data, String> {
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
    let mut rows = Vec::new();
    for line in lines {
        let row: Vec<String> = serde_json::from_str(line)
            .map_err(|e| format!("出力{}行目が不正です: {e}", rows.len() + 2))?;
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
pub fn decode_output(bytes: &[u8], mode: OutputMode) -> Result<Data, String> {
    if mode == OutputMode::Table {
        return decode(bytes);
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
pub fn validate(t: &Table) -> Result<(), String> {
    if (t.kind == Kind::Script) != t.script.is_some() {
        return Err("スクリプト設定とノード種類が一致しません。".into());
    }
    if let Some(s) = &t.script
        && s.config != Config::default()
    {
        s.config.validate()?;
    }
    Ok(())
}
pub fn complete(t: &mut Table, result: Result<Data, String>) -> Result<(), String> {
    if t.script.is_none() {
        return Err("スクリプトノードではありません。".into());
    }
    match result {
        Ok(data) => {
            t.columns = data.columns;
            t.rows = data.rows;
            t.column_widths.truncate(t.columns.len());
            t.stale = false;
            t.error = None;
        }
        Err(e) => {
            t.stale = true;
            t.error = Some(e);
        }
    }
    Ok(())
}
pub fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
