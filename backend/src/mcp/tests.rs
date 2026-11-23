use super::*;
use crate::{
    SharedProject,
    application::Project,
    autosave::Autosave,
    domain::{Command, Request},
};
use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Harness {
    shared: SharedProject,
    bridge: McpBridge,
    task: tokio::task::JoinHandle<()>,
    dir: std::path::PathBuf,
}
impl Drop for Harness {
    fn drop(&mut self) {
        self.task.abort();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
async fn harness() -> Harness {
    let dir = std::env::temp_dir().join(format!(
        "sagyodai-mcp-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let autosave = Arc::new(Autosave::open(dir.join("project.json")).unwrap());
    let project = Project::default();
    autosave.save(&project).unwrap();
    let shared = SharedProject {
        project: Arc::new(Mutex::new(project)),
        autosave,
        changes: tokio::sync::watch::channel(0).0,
        http_runs: Default::default(),
        scripts: Default::default(),
    };
    let router = Router::new()
        .route("/api/mcp/project", get(api::overview))
        .route("/api/mcp/node", post(api::node))
        .route("/api/mcp/command", post(api::apply))
        .with_state(shared.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let bridge = McpBridge {
        client: reqwest::Client::builder().no_proxy().build().unwrap(),
        base,
    };
    Harness {
        shared,
        bridge,
        task,
        dir,
    }
}
fn value(result: CallToolResult) -> Value {
    assert_ne!(result.is_error, Some(true), "{result:?}");
    result.structured_content.unwrap()
}
async fn edit(h: &Harness, command: Value) -> Value {
    let revision = value(h.bridge.get_project().await)["revision"]
        .as_u64()
        .unwrap();
    value(
        h.bridge
            .apply_operation(Parameters(
                serde_json::from_value(json!({"expectedRevision": revision, "command": command}))
                    .unwrap(),
            ))
            .await,
    )
}
async fn read(h: &Harness, id: &str) -> Value {
    value(
        h.bridge
            .get_node(Parameters(ReadNode {
                id: id.into(),
                offset: 0,
                limit: 100,
            }))
            .await,
    )
}

#[tokio::test]
async fn flow_shares_gui_state_notifications_undo_and_autosave() {
    let h = harness().await;
    let mut changes = h.shared.changes.subscribe();
    edit(&h, json!({"type":"addNode", "kind":"input"})).await;
    edit(&h, json!({"type":"paste", "id":"table-2", "row":0, "col":0, "values":[["りんご","8"],["みかん","2"]]})).await;
    edit(&h, json!({"type":"renameColumn", "id":"table-2", "col":0, "name":"商品", "expectedColumns":["品名","数量","分類","メモ"]})).await;
    edit(&h, json!({"type":"addNode", "kind":"filter"})).await;
    edit(
        &h,
        json!({"type":"connect", "id":"table-3", "source":"table-2"}),
    )
    .await;
    let filter = json!({"column":1,"operator":"greater","value":"5"});
    edit(
        &h,
        json!({"type":"configure", "id":"table-3", "manual":false, "filter":filter}),
    )
    .await;
    edit(&h, json!({"type":"addNode", "kind":"display"})).await;
    edit(
        &h,
        json!({"type":"connect", "id":"table-4", "source":"table-3"}),
    )
    .await;
    assert_eq!(
        read(&h, "table-4").await["rows"].as_array().unwrap().len(),
        2
    );
    edit(
        &h,
        json!({"type":"configure", "id":"table-3", "manual":true, "filter":filter}),
    )
    .await;
    edit(
        &h,
        json!({"type":"paste", "id":"table-2", "row":0, "col":1, "values":[["1"]]}),
    )
    .await;
    let stale = read(&h, "table-4").await;
    assert_eq!(stale["stale"], true);
    assert_eq!(stale["rows"][0][1], "8");
    edit(&h, json!({"type":"run", "id":"table-3"})).await;
    assert_eq!(
        read(&h, "table-4").await["rows"].as_array().unwrap().len(),
        1
    );
    let Json(gui) = crate::snapshot(State(h.shared.clone())).await.unwrap();
    assert_eq!(gui.tables[3].rows[0][0], "鉛筆");
    changes.changed().await.unwrap();
    assert_eq!(*changes.borrow(), gui.revision);
    let restored = h.shared.autosave.load().unwrap().unwrap().snapshot();
    assert_eq!(restored.tables[3].rows, gui.tables[3].rows);
    assert_eq!(restored.revision, gui.revision);
    // GUIのUndoでMCPのRunを戻し、MCPのRedoで同じ履歴を進める。
    let _ = crate::command(
        State(h.shared.clone()),
        Json(Request {
            expected_revision: gui.revision,
            command: Command::Undo,
        }),
    )
    .await
    .unwrap();
    assert_eq!(read(&h, "table-4").await["rows"][0][1], "8");
    edit(&h, json!({"type":"redo"})).await;
    assert_eq!(
        read(&h, "table-4").await["rows"].as_array().unwrap().len(),
        1
    );
}

#[tokio::test]
async fn conflict_and_invalid_operation_do_not_change_data_or_notify() {
    let h = harness().await;
    edit(
        &h,
        json!({"type":"paste", "id":"table-1", "row":0, "col":0, "values":[["GUIと共有"]]}),
    )
    .await;
    let before = h.shared.project.lock().unwrap().export().unwrap();
    let changes = h.shared.changes.subscribe();
    let result = h.bridge.apply_operation(Parameters(serde_json::from_value(json!({"expectedRevision":0,"command":{"type":"paste","id":"table-1","row":0,"col":0,"values":[["古い編集"]]}})).unwrap())).await;
    assert_eq!(result.is_error, Some(true));
    assert_eq!(
        result.structured_content.unwrap()["code"],
        "revision_conflict"
    );
    let result = h.bridge.apply_operation(Parameters(serde_json::from_value(json!({"expectedRevision":1,"command":{"type":"connect","id":"table-1","source":"table-1"}})).unwrap())).await;
    assert_eq!(result.is_error, Some(true));
    assert_eq!(h.shared.project.lock().unwrap().export().unwrap(), before);
    assert!(!changes.has_changed().unwrap());
    // 外部通信やプロジェクト置換は公開スキーマにも実行経路にも入れない。
    for kind in ["fetchHttp", "openProject", "completeHttp"] {
        assert!(
            serde_json::from_value::<Edit>(json!({"expectedRevision":1,"command":{"type":kind}}))
                .is_err()
        );
    }
}

#[tokio::test]
async fn bounded_data_reports_truncation_and_pagination() {
    let h = harness().await;
    let text = "あ".repeat(3000);
    edit(
        &h,
        json!({"type":"paste", "id":"table-1", "row":0, "col":0, "values":[[text]]}),
    )
    .await;
    let page = value(
        h.bridge
            .get_node(Parameters(ReadNode {
                id: "table-1".into(),
                offset: 0,
                limit: 1,
            }))
            .await,
    );
    assert_eq!(page["rows"][0][0].as_str().unwrap().len(), 2046);
    assert_eq!(page["truncatedCells"][0]["originalBytes"], 9000);
    assert_eq!(page["nextOffset"], 1);
    assert!(value(h.bridge.get_project().await).get("rows").is_none());
    for (id, offset, limit) in [("table-1", 0, 101), ("table-1", 999, 1), ("missing", 0, 1)] {
        assert_eq!(
            h.bridge
                .get_node(Parameters(ReadNode {
                    id: id.into(),
                    offset,
                    limit
                }))
                .await
                .is_error,
            Some(true)
        );
    }
    let page = value(
        h.bridge
            .get_node(Parameters(ReadNode {
                id: "table-1".into(),
                offset: 0,
                limit: 0,
            }))
            .await,
    );
    assert_eq!(page["rows"], json!([]));
}

#[tokio::test]
async fn save_failure_is_not_reported_as_success() {
    let h = harness().await;
    let before = h.shared.project.lock().unwrap().export().unwrap();
    std::fs::create_dir(h.dir.join("project.json.tmp")).unwrap();
    let result = h
        .bridge
        .apply_operation(Parameters(
            serde_json::from_value(
                json!({"expectedRevision":0,"command":{"type":"addNode","kind":"input"}}),
            )
            .unwrap(),
        ))
        .await;
    assert_eq!(result.is_error, Some(true));
    assert_eq!(h.shared.project.lock().unwrap().export().unwrap(), before);
    assert_eq!(
        h.shared
            .autosave
            .load()
            .unwrap()
            .unwrap()
            .snapshot()
            .revision,
        0
    );
}
