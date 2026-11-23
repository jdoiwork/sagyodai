use crate::{
    application::Project,
    domain::{Command, Kind, Request},
    http_source::*,
    *,
};
use axum::{body::Bytes, routing::any};
use std::sync::atomic::{AtomicUsize, Ordering};
fn run(p: &mut Project, command: Command) {
    p.apply(Request {
        expected_revision: p.snapshot().revision,
        command,
    })
    .unwrap();
}
fn config(url: String) -> HttpConfig {
    HttpConfig {
        url,
        ..Default::default()
    }
}
async fn server(router: Router) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (url, task)
}
#[tokio::test]
async fn sends_method_headers_body_and_keeps_http_errors_as_responses() {
    let count = Arc::new(AtomicUsize::new(0));
    let seen = count.clone();
    let (url, task) = server(Router::new().route(
        "/",
        any(
            move |method: axum::http::Method, headers: axum::http::HeaderMap, body: Bytes| {
                let seen = seen.clone();
                async move {
                    seen.fetch_add(1, Ordering::SeqCst);
                    assert_eq!(method, "POST");
                    assert_eq!(headers["x-test"], "sample");
                    assert_eq!(body, "日本語");
                    (
                        StatusCode::NOT_FOUND,
                        [("x-result", "yes")],
                        "{\"message\":\"見つかりません\"}",
                    )
                }
            },
        ),
    ))
    .await;
    let cfg = HttpConfig {
        url,
        method: "POST".into(),
        headers: "X-Test: sample".into(),
        body: "日本語".into(),
    };
    let response = fetch(&cfg).await.unwrap();
    assert!(response.status_line.contains("404"));
    assert!(response.headers.contains("x-result: yes"));
    assert!(response.body.contains("見つかりません"));
    assert_eq!(count.load(Ordering::SeqCst), 1);
    task.abort();
    assert!(fetch(&cfg).await.is_err());
    for url in [
        "file:///tmp/x",
        "ftp://example.com",
        "https://name:pass@example.com",
        "bad",
    ] {
        assert!(config(url.into()).validate().is_err());
    }
}
#[test]
fn output_switch_cache_failure_restore_manual_downstream_and_undo() {
    let mut p = Project::default();
    for kind in [Kind::Http, Kind::TextDisplay] {
        run(
            &mut p,
            Command::AddNode {
                kind,
                position: None,
                sheet_id: None,
            },
        );
    }
    run(
        &mut p,
        Command::Connect {
            id: "table-3".into(),
            source: Some("table-2".into()),
        },
    );
    let cfg = config("https://example.com/data".into());
    let response = HttpResponse {
        status_line: "HTTP/1.1 200 OK".into(),
        headers: "x-test: yes".into(),
        body: "日本語\n2".into(),
    };
    run(
        &mut p,
        Command::CompleteHttp {
            id: "table-2".into(),
            config: cfg.clone(),
            result: Ok(response),
        },
    );
    assert_eq!(p.snapshot().tables[2].rows, [vec!["日本語"], vec!["2"]]);
    run(
        &mut p,
        Command::SetHttpOutput {
            id: "table-2".into(),
            output: HttpOutput::Raw,
        },
    );
    assert_eq!(p.snapshot().tables[2].rows[0], ["HTTP/1.1 200 OK"]);
    run(
        &mut p,
        Command::Configure {
            id: "table-3".into(),
            filter: None,
            manual: true,
        },
    );
    run(
        &mut p,
        Command::SetHttpOutput {
            id: "table-2".into(),
            output: HttpOutput::Headers,
        },
    );
    assert!(p.snapshot().tables[2].stale);
    assert_eq!(p.snapshot().tables[1].rows, [vec!["x-test: yes"]]);
    run(
        &mut p,
        Command::Run {
            id: "table-3".into(),
        },
    );
    assert_eq!(p.snapshot().tables[2].rows, [vec!["x-test: yes"]]);
    run(
        &mut p,
        Command::CompleteHttp {
            id: "table-2".into(),
            config: cfg,
            result: Err("通信失敗".into()),
        },
    );
    assert_eq!(p.snapshot().tables[1].rows, [vec!["x-test: yes"]]);
    assert_eq!(p.snapshot().tables[1].error.as_deref(), Some("通信失敗"));
    let restored =
        Project::restore(serde_json::from_slice(&p.export().unwrap()).unwrap(), 0).unwrap();
    assert_eq!(
        restored.snapshot().tables[1].rows,
        p.snapshot().tables[1].rows
    );
    assert_eq!(
        restored.snapshot().tables[1].http.as_ref().unwrap().output,
        HttpOutput::Headers
    );
    run(&mut p, Command::Undo);
    assert!(p.snapshot().tables[1].error.is_none());
}
#[tokio::test]
async fn rejects_large_binary_responses_and_does_not_follow_redirects() {
    let (url, task) = server(
        Router::new()
            .route("/large", any(|| async { "a".repeat(1024 * 1024 + 1) }))
            .route("/binary", any(|| async { vec![0xffu8] }))
            .route(
                "/redirect",
                any(|| async { (StatusCode::FOUND, [("location", "/binary")], "redirect") }),
            ),
    )
    .await;
    assert!(
        fetch(&config(format!("{url}/large")))
            .await
            .unwrap_err()
            .contains("1 MiB")
    );
    assert!(
        fetch(&config(format!("{url}/binary")))
            .await
            .unwrap_err()
            .contains("UTF-8")
    );
    assert_eq!(
        fetch(&config(format!("{url}/redirect")))
            .await
            .unwrap()
            .body,
        "redirect"
    );
    task.abort();
}
#[tokio::test]
async fn delayed_response_never_overwrites_new_request_or_edited_project() {
    let started = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (s, r) = (started.clone(), release.clone());
    let newer_started = Arc::new(tokio::sync::Notify::new());
    let newer_release = Arc::new(tokio::sync::Notify::new());
    let (ns, nr) = (newer_started.clone(), newer_release.clone());
    let (url, task) = server(
        Router::new()
            .route(
                "/slow",
                any(move || {
                    let (s, r) = (s.clone(), r.clone());
                    async move {
                        s.notify_one();
                        r.notified().await;
                        "old"
                    }
                }),
            )
            .route(
                "/fast",
                any(move || {
                    let (ns, nr) = (ns.clone(), nr.clone());
                    async move {
                        ns.notify_one();
                        nr.notified().await;
                        "new"
                    }
                }),
            ),
    )
    .await;
    let dir = std::env::temp_dir().join(format!("sagyodai-http-tests-{}", std::process::id()));
    let mut p = Project::default();
    run(
        &mut p,
        Command::AddNode {
            kind: Kind::Http,
            position: None,
            sheet_id: None,
        },
    );
    let shared = SharedProject {
        project: Arc::new(Mutex::new(p)),
        autosave: Arc::new(autosave::Autosave::open(dir.join("project.json")).unwrap()),
        changes: tokio::sync::watch::channel(1).0,
        http_runs: Default::default(),
    };
    let request = |path: &str, rev| Request {
        expected_revision: rev,
        command: Command::FetchHttp {
            id: "table-2".into(),
            config: config(format!("{url}/{path}")),
        },
    };
    let a = shared.clone();
    let req = request("slow", 1);
    let old = tokio::spawn(async move { command(State(a), Json(req)).await });
    started.notified().await;
    // 通信待機中にもロックを取得できる。
    assert_eq!(shared.project.lock().unwrap().snapshot().revision, 1);
    let a = shared.clone();
    let req = request("fast", 1);
    let newer = tokio::spawn(async move { command(State(a), Json(req)).await });
    newer_started.notified().await;
    release.notify_one();
    assert_eq!(old.await.unwrap().unwrap_err().0, StatusCode::CONFLICT);
    assert_eq!(shared.project.lock().unwrap().snapshot().revision, 1);
    newer_release.notify_one();
    let _ = newer.await.unwrap().unwrap();
    assert_eq!(
        shared.project.lock().unwrap().snapshot().tables[1].rows,
        [vec!["new"]]
    );
    let a = shared.clone();
    let req = request("slow", 2);
    let old = tokio::spawn(async move { command(State(a), Json(req)).await });
    started.notified().await;
    let _ = command(
        State(shared.clone()),
        Json(Request {
            expected_revision: 2,
            command: Command::Undo,
        }),
    )
    .await
    .unwrap();
    release.notify_one();
    assert_eq!(old.await.unwrap().unwrap_err().0, StatusCode::CONFLICT);
    assert!(
        shared.project.lock().unwrap().snapshot().tables[1]
            .rows
            .is_empty()
    );
    drop(shared);
    task.abort();
    std::fs::remove_dir_all(dir).unwrap();
}
