//! ロック外で通信し、開始時のrevisionと実行順を確かめてから共通操作に戻す。
use crate::{
    ApiError, SharedProject,
    domain::{Command, Kind, Request},
    error,
};
use axum::{Json, http::StatusCode};

pub async fn prepare(
    project: &SharedProject,
    request: &mut Request,
) -> Result<Option<(String, u64)>, ApiError> {
    let Command::FetchHttp { id, config } = &request.command else {
        return Ok(None);
    };
    let generation = {
        let state = project
            .project
            .lock()
            .map_err(|_| error("内部状態にアクセスできません。"))?;
        let snapshot = state.snapshot();
        if request.expected_revision != snapshot.revision {
            return Err((
                StatusCode::CONFLICT,
                Json(
                    serde_json::json!({"error":"状態が変更されています。確認して再実行してください。"}),
                ),
            ));
        }
        if !snapshot
            .tables
            .iter()
            .any(|t| t.id == *id && t.kind == Kind::Http)
        {
            return Err(error("HTTPノードが見つかりません。"));
        }
        config.validate().map_err(error)?;
        // 完了時と同じくproject→runsの順にロックし、実行順の確認と確定を競合させない。
        let mut runs = project
            .http_runs
            .lock()
            .map_err(|_| error("実行状態にアクセスできません。"))?;
        let generation = runs.entry(id.clone()).or_default();
        *generation += 1;
        *generation
    };
    let result = crate::http_source::fetch(config).await;
    let run = Some((id.clone(), generation));
    request.command = Command::CompleteHttp {
        id: id.clone(),
        config: config.clone(),
        result,
    };
    Ok(run)
}
// 呼び出し元がprojectのロックを保持している間に確認する。
pub fn check_generation(
    project: &SharedProject,
    run: Option<(String, u64)>,
) -> Result<(), ApiError> {
    if let Some((id, generation)) = run
        && project
            .http_runs
            .lock()
            .map_err(|_| error("実行状態にアクセスできません。"))?
            .get(&id)
            != Some(&generation)
    {
        return Err((
            StatusCode::CONFLICT,
            Json(
                serde_json::json!({"error":"新しいHTTPリクエストが実行されたため、古い応答は破棄しました。"}),
            ),
        ));
    }
    Ok(())
}
