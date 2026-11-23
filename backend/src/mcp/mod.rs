//! stdioプロセスは状態を持たず、起動中のローカルコアに接続する。
pub mod api;
mod params;
#[cfg(test)]
mod tests;

use params::{Edit, ReadNode};
use rmcp::{
    ServiceExt, handler::server::wrapper::Parameters, model::CallToolResult, tool, tool_router,
};
use serde_json::{Value, json};

#[derive(Clone)]
struct McpBridge {
    client: reqwest::Client,
    base: String,
}

impl McpBridge {
    async fn request(&self, path: &str, body: Option<Value>) -> CallToolResult {
        let url = format!("{}{path}", self.base);
        let request = if let Some(body) = body {
            self.client
                .post(url)
                .header("content-type", "application/json")
                .body(body.to_string())
        } else {
            self.client.get(url)
        };
        let response = async {
            let response = request.send().await.map_err(|e| e.to_string())?;
            let status = response.status();
            let bytes = response.bytes().await.map_err(|e| e.to_string())?;
            let value: Value = if status.is_success() {
                serde_json::from_slice(&bytes)
                    .map_err(|e| format!("コアの応答形式が不正です: {e}"))?
            } else {
                serde_json::from_slice(&bytes)
                    .unwrap_or_else(|_| json!({"error": String::from_utf8_lossy(&bytes)}))
            };
            Ok::<_, String>((status, value))
        }
        .await;
        match response {
            Ok((status, value)) if status.is_success() => CallToolResult::structured(value),
            Ok((status, value)) => CallToolResult::structured_error(json!({
                "code": if status.as_u16() == 409 { "revision_conflict" } else { "operation_rejected" },
                "status": status.as_u16(), "details": value,
                "recovery": "get_project / get_nodeで最新状態を確認し、操作を再検討してください。自動再送はしていません。",
            })),
            Err(message) => CallToolResult::structured_error(json!({
                "code": "core_unavailable", "message": message,
                "recovery": "同じポートのコアが起動しているか確認してください。通信失敗でも操作済みの可能性があります。再送前に状態を確認してください。",
            })),
        }
    }
}

#[rmcp::tool_handler(
    name = "sagyodai",
    version = "0.1.0",
    instructions = "起動中の作業台を操作します。最初にget_projectで状態を確認してください。GUIと状態・Undoを共有します。セルは文字列で行列は0始まりです。"
)]
impl rmcp::ServerHandler for McpBridge {}

#[tool_router]
impl McpBridge {
    #[tool(
        description = "起動中の作業台のrevision、シート、ノードID・接続・件数・更新状態・Undo可否を取得。セルデータはget_nodeで部分取得する。",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            open_world_hint = false
        )
    )]
    async fn get_project(&self) -> CallToolResult {
        self.request("/api/mcp/project", None).await
    }

    #[tool(
        description = "ノードの列・条件・更新状態と指定範囲の行を取得。行列は0始まり、セルは文字列。最大100行、1セル2048バイト、合計32768バイトまで。truncatedCellsがある値は省略されており編集前の完全な値として扱わない。",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            open_world_hint = false
        )
    )]
    async fn get_node(&self, Parameters(read): Parameters<ReadNode>) -> CallToolResult {
        self.request("/api/mcp/node", Some(json!(read))).await
    }

    #[tool(
        description = "共通操作APIで1操作を実行し自動保存・画面同期する。expectedRevisionは直前に観測したrevisionを指定。手入力表(input)・フィルタ(filter)・結果表(display)を追加可能。手入力表にはサンプルが入るため必要に応じ置換・行削除する。Undo/RedoはGUIを含むプロジェクト共通。失敗時は再取得して判断し、盲目的に再試行しない。HTTP取得・外部スクリプト・ファイル書き出しは公開しない。",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn apply_operation(&self, Parameters(edit): Parameters<Edit>) -> CallToolResult {
        self.request("/api/mcp/command", Some(json!(edit))).await
    }
}

pub async fn serve_stdio(port: u16) -> Result<(), Box<dyn std::error::Error>> {
    let bridge = McpBridge {
        client: reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(30))
            .build()?,
        base: format!("http://127.0.0.1:{port}"),
    };
    // stdoutはMCP専用。コアの起動・保存ファイルのオープンは行わない。
    bridge
        .serve(rmcp::transport::stdio())
        .await?
        .waiting()
        .await?;
    Ok(())
}
