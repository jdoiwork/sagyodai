mod application;
mod domain;
mod storage;

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

type SharedProject = Arc<Mutex<Project>>;
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
            .lock()
            .map_err(|_| error("内部状態にアクセスできません。"))?
            .snapshot(),
    ))
}
async fn command(
    State(project): State<SharedProject>,
    Json(request): Json<Request>,
) -> Result<Json<Snapshot>, ApiError> {
    project
        .lock()
        .map_err(|_| error("内部状態にアクセスできません。"))?
        .apply(request)
        .map(Json)
        .map_err(error)
}
async fn export(State(project): State<SharedProject>) -> Result<Response, ApiError> {
    let state = project
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
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut project = Project::default();
    if let Ok(path) = std::env::var("SAGYODAI_STARTUP_PROJECT") {
        let bytes = std::fs::read(path)?;
        if bytes.len() > storage::MAX_FILE_BYTES {
            return Err("起動ファイルが8 MiBを超えています。".into());
        }
        let document = serde_json::from_slice(&bytes)?;
        project.apply(Request {
            expected_revision: 0,
            command: domain::Command::OpenProject { document },
        })?;
    }
    let app = Router::new()
        .route("/api/project", get(snapshot))
        .route("/api/command", post(command))
        .route("/api/project/export", get(export))
        .layer(DefaultBodyLimit::max(16 * 1024 * 1024))
        .with_state(Arc::new(Mutex::new(project)));
    let port: u16 = std::env::var("SAGYODAI_CORE_PORT")
        .unwrap_or_else(|_| "4318".into())
        .parse()?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    println!("作業台の試作コア: http://127.0.0.1:{port}");
    axum::serve(listener, app).await?;
    Ok(())
}
