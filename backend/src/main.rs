mod application;
mod domain;

use application::Project;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
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
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let app = Router::new()
        .route("/api/project", get(snapshot))
        .route("/api/command", post(command))
        .layer(DefaultBodyLimit::max(8 * 1024 * 1024))
        .with_state(Arc::new(Mutex::new(Project::default())));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:4318").await?;
    println!("作業台の試作コア: http://127.0.0.1:4318");
    axum::serve(listener, app).await?;
    Ok(())
}
