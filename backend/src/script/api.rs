//! 実行権限はコアのメモリだけに保持する。保存・復元やUndoでプログラムを起動しない。
use super::{
    Config, digest, encode,
    runner::{self, Progress},
};
use crate::{
    ApiError, SharedProject,
    domain::{Command, Kind, Request, Snapshot},
    error,
};
use axum::{Json, extract::State};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::sync::watch;

#[derive(Default)]
pub struct Runs {
    next: u64,
    jobs: HashMap<String, Job>,
    approvals: HashMap<String, (Config, String)>,
}
struct Job {
    run_id: u64,
    key: String,
    cancel: watch::Sender<bool>,
    obsolete: bool,
    view: View,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct View {
    run_id: u64,
    state: String,
    message: Option<String>,
    #[serde(skip)]
    progress: Arc<Mutex<Progress>>,
}
#[derive(Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Start {
    pub id: String,
    pub expected_revision: u64,
    pub allow_automatic: bool,
}
#[derive(Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Node {
    pub id: String,
}
#[derive(Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cancel {
    pub id: String,
    pub run_id: u64,
}
fn key(snapshot: &Snapshot, id: &str) -> Result<(String, Config, Vec<u8>), String> {
    let t = snapshot
        .tables
        .iter()
        .find(|t| t.id == id)
        .ok_or("ノードがありません。")?;
    let config = t
        .script
        .as_ref()
        .ok_or("スクリプトノードではありません。")?
        .config
        .clone();
    config.validate()?;
    // 未接続は生成用スクリプトとして実行し、空の標準入力をEOFで閉じる。
    let input = if let Some(source) = &t.source {
        let s = snapshot
            .tables
            .iter()
            .find(|s| &s.id == source)
            .ok_or("入力ノードがありません。")?;
        if s.stale || s.error.is_some() {
            return Err("入力が更新待ちです。".into());
        }
        encode(s)?
    } else {
        Vec::new()
    };
    let info = serde_json::to_vec(&(t.source.as_ref(), t.manual, &config, digest(&input)))
        .map_err(|e| e.to_string())?;
    Ok((digest(&info), config, input))
}
// 呼出元はprojectロックを保持。ロック順はproject→scriptsで統一する。
pub fn invalidate(shared: &SharedProject, snapshot: &Snapshot) {
    if let Ok(mut runs) = shared.scripts.lock() {
        for (id, job) in &mut runs.jobs {
            if key(snapshot, id).map_or(true, |(k, _, _)| k != job.key) {
                job.obsolete = true;
                job.cancel.send_replace(true);
            }
        }
        runs.jobs.retain(|id, job| {
            job.view.state == "running" || snapshot.tables.iter().any(|t| &t.id == id)
        });
        runs.approvals.retain(|id, (config, _)| {
            snapshot
                .tables
                .iter()
                .any(|t| t.id == *id && t.script.as_ref().is_some_and(|s| s.config == *config))
        });
    }
}
pub fn reset_permissions(shared: &SharedProject) {
    if let Ok(mut runs) = shared.scripts.lock() {
        runs.approvals.clear();
        for job in runs.jobs.values_mut() {
            job.obsolete = true;
            job.cancel.send_replace(true);
        }
    }
}
fn job_json(job: &Job, approved: bool) -> Value {
    let progress = job
        .view
        .progress
        .lock()
        .map(|p| p.clone())
        .unwrap_or_default();
    json!({"runId":job.run_id,"state":job.view.state,"message":job.view.message,"log":progress.log,"logTruncated":progress.log_truncated,"automaticAllowed":approved})
}
pub async fn status(
    State(shared): State<SharedProject>,
    Json(node): Json<Node>,
) -> Result<Json<Value>, ApiError> {
    let runs = shared
        .scripts
        .lock()
        .map_err(|_| error("実行状態にアクセスできません。"))?;
    Ok(Json(runs.jobs.get(&node.id).map(|j|job_json(j,runs.approvals.contains_key(&node.id))).unwrap_or(json!({"runId":0,"state":"idle","message":null,"log":"","logTruncated":false,"automaticAllowed":false}))))
}
pub async fn source(
    State(shared): State<SharedProject>,
    Json(node): Json<Node>,
) -> Result<Json<Value>, ApiError> {
    let config = {
        let p = shared
            .project
            .lock()
            .map_err(|_| error("内部状態にアクセスできません。"))?;
        p.snapshot()
            .tables
            .into_iter()
            .find(|t| t.id == node.id)
            .and_then(|t| t.script)
            .ok_or_else(|| error("スクリプトノードがありません。"))?
            .config
    };
    let text = config.source().map_err(error)?;
    Ok(Json(json!({"text":text})))
}
pub async fn cancel(
    State(shared): State<SharedProject>,
    Json(request): Json<Cancel>,
) -> Result<Json<Value>, ApiError> {
    let mut runs = shared
        .scripts
        .lock()
        .map_err(|_| error("実行状態にアクセスできません。"))?;
    let job = runs
        .jobs
        .get_mut(&request.id)
        .ok_or_else(|| error("実行がありません。"))?;
    if job.run_id != request.run_id {
        return Err(error(
            "新しい実行に変わっています。状態を確認してください。",
        ));
    }
    job.cancel.send_replace(true);
    runs.approvals.remove(&request.id);
    Ok(Json(json!({"cancelRequested":true})))
}
pub async fn start(
    State(shared): State<SharedProject>,
    Json(request): Json<Start>,
) -> Result<Json<Value>, ApiError> {
    let snapshot = shared
        .project
        .lock()
        .map_err(|_| error("内部状態にアクセスできません。"))?
        .snapshot();
    if snapshot.revision != request.expected_revision {
        return Err((
            axum::http::StatusCode::CONFLICT,
            Json(json!({"error":"状態が更新されています。確認して再実行してください。"})),
        ));
    }
    launch(
        &shared,
        &snapshot,
        &request.id,
        Some(request.allow_automatic),
    )
    .map(Json)
    .map_err(error)
}
// 開始直前にもrevisionを確認する。起動待ちの間に編集された入力は使わない。
fn launch(
    shared: &SharedProject,
    snapshot: &Snapshot,
    id: &str,
    explicit: Option<bool>,
) -> Result<Value, String> {
    let (key, config, input) = key(snapshot, id)?;
    let text = config.source()?;
    let hash = digest(text.as_bytes());
    let project = shared
        .project
        .lock()
        .map_err(|_| "内部状態にアクセスできません。")?;
    if project.snapshot().revision != snapshot.revision {
        return Err("状態が更新されています。".into());
    }
    let mut runs = shared
        .scripts
        .lock()
        .map_err(|_| "実行状態にアクセスできません。")?;
    if runs
        .jobs
        .values()
        .filter(|j| j.view.state == "running")
        .count()
        >= 4
    {
        return Err("同時実行は4件までです。".into());
    }
    if runs.jobs.get(id).is_some_and(|j| j.view.state == "running") {
        return Err("実行中です。停止完了後に再実行してください。".into());
    }
    if let Some(automatic) = explicit {
        if automatic {
            runs.approvals
                .insert(id.into(), (config.clone(), hash.clone()));
        } else {
            runs.approvals.remove(id);
        }
    } else if !runs
        .approvals
        .get(id)
        .is_some_and(|(c, h)| c == &config && h == &hash)
    {
        return Err("実行許可が必要です。".into());
    }
    runs.next += 1;
    let run_id = runs.next;
    let (cancel, receiver) = watch::channel(false);
    let progress = Arc::new(Mutex::new(Progress::default()));
    runs.jobs.insert(
        id.into(),
        Job {
            run_id,
            key,
            cancel,
            obsolete: false,
            view: View {
                run_id,
                state: "running".into(),
                message: None,
                progress: progress.clone(),
            },
        },
    );
    let response = job_json(&runs.jobs[id], runs.approvals.contains_key(id));
    let shared = shared.clone();
    let id = id.to_string();
    tokio::spawn(async move {
        let mut result = runner::execute(&config, input, receiver, progress).await;
        if config
            .source()
            .map_or(true, |current| digest(current.as_bytes()) != hash)
        {
            result = Err("実行中にスクリプトが変更されました。結果は破棄しました。".into());
            if let Ok(mut runs) = shared.scripts.lock() {
                runs.approvals.remove(&id);
            }
        }
        finish(&shared, &id, run_id, result);
    });
    Ok(response)
}
fn finish(shared: &SharedProject, id: &str, run_id: u64, result: Result<super::Data, String>) {
    let Ok(mut project) = shared.project.lock() else {
        return;
    };
    let Ok(mut runs) = shared.scripts.lock() else {
        return;
    };
    let Some(job) = runs.jobs.get_mut(id).filter(|j| j.run_id == run_id) else {
        return;
    };
    let snapshot = project.snapshot();
    let canceled = *job.cancel.borrow();
    if job.obsolete || key(&snapshot, id).map_or(true, |(k, _, _)| k != job.key) {
        job.view.state = "discarded".into();
        job.view.message = Some("入力・設定が変更されたため結果を破棄しました。".into());
        return;
    }
    let result = if canceled {
        Err("キャンセルしました。".into())
    } else {
        result
    };
    job.view.state = if canceled {
        "canceled"
    } else if result.is_ok() {
        "succeeded"
    } else {
        "failed"
    }
    .into();
    job.view.message = result.as_ref().err().cloned();
    let request = Request {
        expected_revision: snapshot.revision,
        command: Command::CompleteScript {
            id: id.into(),
            result,
        },
    };
    match shared.autosave.apply(&mut project, request) {
        Ok(next) => {
            drop(runs);
            invalidate(shared, &next);
            shared.changes.send_replace(next.revision);
        }
        Err(e) => {
            job.view.state = "failed".into();
            job.view.message = Some(e);
        }
    }
}
pub fn start_scheduler(shared: SharedProject) {
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(std::time::Duration::from_millis(500));
        loop {
            timer.tick().await;
            if shared
                .scripts
                .lock()
                .is_ok_and(|runs| runs.approvals.is_empty())
            {
                continue;
            }
            let snapshot = match shared.project.lock() {
                Ok(p) => p.snapshot(),
                Err(_) => continue,
            };
            let candidates = {
                let Ok(runs) = shared.scripts.lock() else {
                    continue;
                };
                snapshot
                    .tables
                    .iter()
                    .filter(|t| {
                        t.kind == Kind::Script
                            && !t.manual
                            && t.stale
                            && runs.approvals.contains_key(&t.id)
                    })
                    .filter(|t| {
                        key(&snapshot, &t.id).is_ok_and(|(k, _, _)| {
                            runs.jobs.get(&t.id).is_none_or(|j| {
                                j.view.state != "running" && (j.obsolete || j.key != k)
                            })
                        })
                    })
                    .map(|t| t.id.clone())
                    .collect::<Vec<_>>()
            };
            for id in candidates {
                let _ = launch(&shared, &snapshot, &id, None);
            }
        }
    });
}

pub async fn shutdown(shared: SharedProject) {
    #[cfg(unix)]
    {
        if let Ok(mut term) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            tokio::select! {_=tokio::signal::ctrl_c()=>{},_=term.recv()=>{}}
        } else {
            let _ = tokio::signal::ctrl_c().await;
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
    reset_permissions(&shared);
    // 子の終了・パイプ回収を待ってからランタイムを閉じる。
    for _ in 0..50 {
        if shared
            .scripts
            .lock()
            .is_ok_and(|r| r.jobs.values().all(|j| j.view.state != "running"))
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}
