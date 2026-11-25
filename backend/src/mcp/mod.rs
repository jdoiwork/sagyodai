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
    instructions = "起動中の作業台を操作します。最初にget_projectで状態を確認してください。GUIと状態・Undoを共有します。入力原文は文字列、列型はcolumnSchemaで確認します。整数は64ビット十進文字列です。行列は0始まりです。"
)]
impl rmcp::ServerHandler for McpBridge {}

#[tool_router]
impl McpBridge {
    #[tool(
        description = "外部スクリプトを実行する。ファイル書き込み・通信などの副作用はUndoできない。expectedRevisionで確認済みの設定を指定。allowAutomatic=trueは同じ設定・スクリプトの自動実行をコア終了まで許可する。実行IDを返すのでscript_statusで結果・ログを確認する。",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn start_script(
        &self,
        Parameters(request): Parameters<crate::script::api::Start>,
    ) -> CallToolResult {
        self.request("/api/script/start", Some(json!(request)))
            .await
    }
    #[tool(
        description = "スクリプトの実行状態と上限付きログを取得する。",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn script_status(
        &self,
        Parameters(request): Parameters<crate::script::api::Node>,
    ) -> CallToolResult {
        self.request("/api/script/status", Some(json!(request)))
            .await
    }
    #[tool(
        description = "実行IDを指定して外部スクリプトを停止し、自動実行許可も解除する。外部副作用は戻らない。",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn cancel_script(
        &self,
        Parameters(request): Parameters<crate::script::api::Cancel>,
    ) -> CallToolResult {
        self.request("/api/script/cancel", Some(json!(request)))
            .await
    }
    #[tool(
        description = "設定済みスクリプトのUTF-8原文を読み取り専用で取得する（最大100000バイト）。",
        annotations(read_only_hint = true, open_world_hint = true)
    )]
    async fn script_source(
        &self,
        Parameters(request): Parameters<crate::script::api::Node>,
    ) -> CallToolResult {
        self.request("/api/script/source", Some(json!(request)))
            .await
    }
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
        description = "ノードの列・条件・更新状態と指定範囲の行を取得。行列は0始まり、rowsは入力原文または結果の表示文字列。columnSchemaは型・空欄規則、typedRowsは最新結果の型付き値（文字列本文はrows参照）。最大100行、1セル2048バイト、合計32768バイトまで。truncatedCellsがある値は省略されており編集前の完全な値として扱わない。",
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
        description = "共通操作APIで1操作を実行し自動保存・画面同期する。expectedRevisionは直前に観測したrevisionを指定。手入力表(input)・フィルタ(filter)・結果表(display)・スクリプト(script)を追加可能。手入力表にはサンプルが入るため必要に応じ置換・行削除する。Undo/RedoはGUIを含むプロジェクト共通。失敗時は再取得して判断し、盲目的に再試行しない。外部スクリプトの明示実行はstart_scriptを使う。許可済み自動スクリプトは入力の変更に応じて実行される。HTTP取得・ファイル書き出しは公開しない。",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = true
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
