//! 文字列表を受け渡す外部スクリプト。型付き表の形式は将来別バージョンで定義する。
pub mod api;
mod protocol;
mod runner;
#[cfg(test)]
use protocol::decode;
pub use protocol::{MAX_BYTES, RowFormat, decode_output, encode};
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
    #[serde(default)]
    pub input_row_format: RowFormat,
    #[serde(default)]
    pub output_row_format: RowFormat,
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
            input_row_format: RowFormat::List,
            output_row_format: RowFormat::List,
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
