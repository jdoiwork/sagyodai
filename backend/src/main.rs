mod aggregation;
mod application;
mod autosave;
mod csv_source;
mod domain;
mod graph;
#[cfg(test)]
mod graph_tests;
mod group;
mod group_stats;
mod http_api;
mod http_source;
mod note;
mod projection;
mod replacement;
#[cfg(test)]
mod sheet_move_tests;
mod sheets;
mod sort;
mod storage;
mod table_edit;
mod table_view;
mod text_source;
mod union;
#[cfg(test)]
mod union_tests;
mod view_filters;

use application::Project;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use domain::{Request, Snapshot};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct SharedProject {
    project: Arc<Mutex<Project>>,
    autosave: Arc<autosave::Autosave>,
    changes: tokio::sync::watch::Sender<u64>,
    http_runs: Arc<Mutex<std::collections::HashMap<String, u64>>>,
}
type ApiError = (StatusCode, Json<serde_json::Value>);
fn error(message: impl ToString) -> ApiError {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({"error": message.to_string()})),
    )
}
async fn snapshot(State(project): State<SharedProject>) -> Result<Json<Snapshot>, ApiError> {
    Ok(Json(
        project
            .project
            .lock()
            .map_err(|_| error("内部状態にアクセスできません。"))?
            .snapshot(),
    ))
}
async fn command(
    State(project): State<SharedProject>,
    Json(mut request): Json<Request>,
) -> Result<Json<Snapshot>, ApiError> {
    let http_run = http_api::prepare(&project, &mut request).await?;
    let mut state = project
        .project
        .lock()
        .map_err(|_| error("内部状態にアクセスできません。"))?;
    http_api::check_generation(&project, http_run)?;
    if request.expected_revision != state.snapshot().revision {
        return Err((
            StatusCode::CONFLICT,
            Json(
                serde_json::json!({"error": "別の操作で状態が更新されました。操作結果は反映していません。入力を確認して再実行してください。"}),
            ),
        ));
    }
    let next = project.autosave.apply(&mut state, request).map_err(error)?;
    project.changes.send_replace(next.revision);
    Ok(Json(next))
}
async fn export(State(project): State<SharedProject>) -> Result<Response, ApiError> {
    let state = project
        .project
        .lock()
        .map_err(|_| error("内部状態にアクセスできません。"))?;
    let bytes = state.export().map_err(error)?;
    let revision = state.snapshot().revision;
    let mut response = (
        [
            (header::CONTENT_TYPE, "application/json; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=project.sagyodai.json",
            ),
        ],
        bytes,
    )
        .into_response();
    response.headers_mut().insert(
        "x-project-revision",
        revision.to_string().parse().map_err(error)?,
    );
    Ok(response)
}
async fn events(State(project): State<SharedProject>) -> impl IntoResponse {
    use axum::response::sse::{Event, KeepAlive, Sse};
    let receiver = project.changes.subscribe();
    // 接続時にも通知し、初期取得との隙間や再接続中の変更を取りこぼさない。
    let stream =
        futures_util::stream::unfold((receiver, true), |(mut receiver, first)| async move {
            if !first && receiver.changed().await.is_err() {
                return None;
            }
            let revision = *receiver.borrow_and_update();
            Some((
                Ok::<_, std::convert::Infallible>(Event::default().data(revision.to_string())),
                (receiver, false),
            ))
        });
    Sse::new(stream).keep_alive(KeepAlive::default())
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port: u16 = std::env::var("SAGYODAI_CORE_PORT")
        .unwrap_or_else(|_| "4318".into())
        .parse()?;
    let path = std::env::var_os("SAGYODAI_AUTOSAVE_PATH")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../.sagyodai")
                .join(format!("project-{port}.json"))
        });
    let autosave = Arc::new(autosave::Autosave::open(path)?);
    let project = if let Some(saved) = autosave.load()? {
        saved
    } else if let Ok(path) = std::env::var("SAGYODAI_STARTUP_PROJECT") {
        let bytes = std::fs::read(path)?;
        if bytes.len() > storage::MAX_FILE_BYTES {
            return Err("起動ファイルが128 MiBを超えています。".into());
        }
        Project::restore(serde_json::from_slice(&bytes)?, 0)?
    } else {
        Project::default()
    };
    // 初期データも保存。既存の自動保存が不正なら、ここまで到達しない。
    autosave.save(&project)?;
    let app = Router::new()
        .route("/api/project", get(snapshot))
        .route("/api/project/events", get(events))
        .route("/api/command", post(command))
        .route("/api/project/export", get(export))
        .layer(DefaultBodyLimit::max(storage::MAX_FILE_BYTES + 1024))
        .with_state(SharedProject {
            changes: tokio::sync::watch::channel(project.snapshot().revision).0,
            http_runs: Default::default(),
            project: Arc::new(Mutex::new(project)),
            autosave,
        });
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    println!("作業台の試作コア: http://127.0.0.1:{port}");
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod text_display_tests;

mod tree_display;

#[cfg(test)]
mod http_tests;
