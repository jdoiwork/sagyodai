//! HTTP取得と、取得済みレスポンスからの出力選択。グラフ再計算では通信しない。
use crate::domain::{Kind, Table};
use reqwest::{
    Method, Url,
    header::{HeaderMap, HeaderName, HeaderValue},
};
use serde::{Deserialize, Serialize};
use std::time::Duration;
pub const MAX_RESPONSE: usize = 10 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HttpConfig {
    pub url: String,
    pub method: String,
    pub headers: String,
    pub body: String,
}
impl Default for HttpConfig {
    fn default() -> Self {
        Self {
            url: String::new(),
            method: "GET".into(),
            headers: String::new(),
            body: String::new(),
        }
    }
}
impl HttpConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.url.len() > 8192 || self.headers.len() > 16384 || self.body.len() > 100000 {
            return Err(
                "URLは8192、ヘッダーは16384、送信本文は100000バイト以内にしてください。".into(),
            );
        }
        let url = Url::parse(&self.url)
            .map_err(|_| "http:// または https:// で始まるURLを入力してください。")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(
                "HTTP/HTTPSのURLを指定してください。認証情報は送信ヘッダーに指定します。".into(),
            );
        }
        if !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
            .contains(&self.method.as_str())
        {
            return Err("未対応のHTTPメソッドです。".into());
        }
        self.header_map()?;
        Ok(())
    }
    fn header_map(&self) -> Result<HeaderMap, String> {
        let mut headers = HeaderMap::new();
        for (i, line) in self.headers.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let (name, value) = line.split_once(':').ok_or_else(|| {
                format!(
                    "送信ヘッダーの{}行目を「名前: 値」で入力してください。",
                    i + 1
                )
            })?;
            let name = HeaderName::from_bytes(name.trim().as_bytes())
                .map_err(|_| format!("送信ヘッダーの{}行目の名前が不正です。", i + 1))?;
            if ["host", "content-length", "transfer-encoding", "connection"]
                .contains(&name.as_str())
            {
                return Err(format!("{} は自動設定されるため指定できません。", name));
            }
            let value = HeaderValue::from_str(value.trim())
                .map_err(|_| format!("送信ヘッダーの{}行目の値が不正です。", i + 1))?;
            headers.append(name, value);
        }
        Ok(headers)
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HttpOutput {
    Raw,
    Headers,
    #[default]
    Body,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HttpResponse {
    pub status_line: String,
    pub headers: String,
    pub body: String,
}
impl HttpResponse {
    fn text(&self, output: HttpOutput) -> String {
        match output {
            HttpOutput::Body => self.body.clone(),
            HttpOutput::Headers => self.headers.clone(),
            HttpOutput::Raw => format!(
                "{}\r\n{}\r\n\r\n{}",
                self.status_line, self.headers, self.body
            ),
        }
    }
    fn validate(&self) -> Result<(), String> {
        if self.status_line.len() > 1024 || self.headers.len() + self.body.len() > MAX_RESPONSE {
            return Err(
                "HTTPレスポンスはヘッダーと本文を合わせて10 MiB以内にしてください。".into(),
            );
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HttpSource {
    pub config: HttpConfig,
    pub output: HttpOutput,
    pub response: Option<HttpResponse>,
}
fn rows(response: &HttpResponse, output: HttpOutput) -> Result<Vec<Vec<String>>, String> {
    response.validate()?;
    let text = response.text(output);
    let lines: Vec<_> = text.split('\n').collect();
    if lines.len() > crate::storage::MAX_ROWS
        || lines
            .iter()
            .any(|s| s.len() > crate::storage::MAX_OUTPUT_CELL_BYTES)
    {
        return Err("HTTP出力は5000行以内、1行11 MiB以内にしてください。".into());
    }
    Ok(lines
        .into_iter()
        .map(|s| vec![s.strip_suffix('\r').unwrap_or(s).into()])
        .collect())
}
pub fn validate(table: &Table) -> Result<(), String> {
    if (table.kind == Kind::Http) != table.http.is_some() {
        return Err("HTTP設定とノードの種類が一致しません。".into());
    }
    if let Some(http) = &table.http {
        // 初期状態の空URLのみ許可する。復元時に外部リクエストは実行しない。
        if http.config != HttpConfig::default() {
            http.config.validate()?;
        }
        if let Some(response) = &http.response {
            if table.columns != ["レスポンス"] || table.rows != rows(response, http.output)? {
                return Err("HTTPキャッシュと出力が一致しません。".into());
            }
        } else if !table.columns.is_empty() || !table.rows.is_empty() {
            return Err("HTTPレスポンスのキャッシュがありません。".into());
        }
    }
    Ok(())
}
pub fn complete(
    table: &mut Table,
    config: HttpConfig,
    result: Result<HttpResponse, String>,
) -> Result<(), String> {
    config.validate()?;
    let http = table.http.as_mut().ok_or("HTTPノードではありません。")?;
    http.config = config;
    match result.and_then(|response| rows(&response, http.output).map(|rows| (response, rows))) {
        Ok((response, rows)) => {
            http.response = Some(response);
            table.columns = vec!["レスポンス".into()];
            table.rows = rows;
            table.stale = false;
            table.error = None;
        }
        Err(error) => {
            table.error = Some(error);
            table.stale = true;
        }
    }
    Ok(())
}
pub fn set_output(table: &mut Table, output: HttpOutput) -> Result<(), String> {
    let http = table.http.as_mut().ok_or("HTTPノードではありません。")?;
    if let Some(response) = &http.response {
        table.rows = rows(response, output)?;
    }
    http.output = output;
    // 通信失敗の表示は出力の切り替えで消さない。
    Ok(())
}
fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "HTTPリクエストがタイムアウトしました（30秒）。".into()
    } else {
        format!("HTTP通信に失敗しました: {}", error.without_url())
    }
}
pub async fn fetch(config: &HttpConfig) -> Result<HttpResponse, String> {
    config.validate()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .build()
        .map_err(network_error)?;
    let method =
        Method::from_bytes(config.method.as_bytes()).map_err(|_| "HTTPメソッドが不正です。")?;
    let mut response = client
        .request(method, &config.url)
        .headers(config.header_map()?)
        .body(config.body.clone())
        .send()
        .await
        .map_err(network_error)?;
    let status_line = format!("{:?} {}", response.version(), response.status());
    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| format!("{}: {}", name, String::from_utf8_lossy(value.as_bytes())))
        .collect::<Vec<_>>()
        .join("\r\n");
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if headers.len() + bytes.len() + chunk.len() > MAX_RESPONSE {
            return Err("HTTPレスポンスが10 MiBを超えています。".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8(bytes)
        .map_err(|_| "HTTP本文をUTF-8テキストとして読み取れません。バイナリは非対応です。")?;
    let result = HttpResponse {
        status_line,
        headers,
        body,
    };
    result.validate()?;
    Ok(result)
}
