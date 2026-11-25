use super::*;
use crate::{
    SharedProject,
    application::Project,
    autosave::Autosave,
    domain::{Command, Kind, Request},
};
use axum::{Json, extract::State};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture {
    dir: PathBuf,
    config: Config,
    shared: SharedProject,
}
impl Fixture {
    fn new(code: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "sagyodai-script-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("transform.py");
        std::fs::write(&script, code).unwrap();
        let config = Config {
            program: "/usr/bin/python3".into(),
            script_path: script.to_string_lossy().into(),
            cwd: dir.to_string_lossy().into(),
            args: vec![],
            timeout_seconds: 3,
            output_mode: OutputMode::Table,
            input_row_format: RowFormat::List,
            output_row_format: RowFormat::List,
        };
        let shared = SharedProject {
            project: Arc::new(Mutex::new(Project::default())),
            autosave: Arc::new(Autosave::open(dir.join("project.json")).unwrap()),
            changes: tokio::sync::watch::channel(0).0,
            http_runs: Default::default(),
            scripts: Default::default(),
        };
        Self {
            dir,
            config,
            shared,
        }
    }
    async fn edit(&self, command: Command) {
        let rev = self.shared.project.lock().unwrap().snapshot().revision;
        let _ = crate::command(
            State(self.shared.clone()),
            Json(Request {
                expected_revision: rev,
                command,
            }),
        )
        .await
        .unwrap();
    }
    async fn setup(&self) {
        self.edit(Command::AddNode {
            kind: Kind::Script,
            sheet_id: None,
            position: None,
        })
        .await;
        self.edit(Command::SetScript {
            id: "table-2".into(),
            config: self.config.clone(),
        })
        .await;
        self.edit(Command::Connect {
            id: "table-2".into(),
            source: Some("table-1".into()),
        })
        .await;
        self.edit(Command::AddNode {
            kind: Kind::Display,
            sheet_id: None,
            position: None,
        })
        .await;
        self.edit(Command::Connect {
            id: "table-3".into(),
            source: Some("table-2".into()),
        })
        .await;
    }
    async fn start(&self, automatic: bool) -> u64 {
        let rev = self.shared.project.lock().unwrap().snapshot().revision;
        api::start(
            State(self.shared.clone()),
            Json(api::Start {
                id: "table-2".into(),
                expected_revision: rev,
                allow_automatic: automatic,
            }),
        )
        .await
        .unwrap()
        .0["runId"]
            .as_u64()
            .unwrap()
    }
    async fn wait(&self) -> serde_json::Value {
        for _ in 0..150 {
            let v = api::status(
                State(self.shared.clone()),
                Json(api::Node {
                    id: "table-2".into(),
                }),
            )
            .await
            .unwrap()
            .0;
            if v["state"] != "running" && v["state"] != "idle" {
                return v;
            }
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        }
        panic!("run timeout")
    }
    fn snapshot(&self) -> crate::domain::Snapshot {
        self.shared.project.lock().unwrap().snapshot()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        api::reset_permissions(&self.shared);
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
const ECHO: &str = "import sys\ndata=sys.stdin.buffer.read()\nprint('日本語ログ',file=sys.stderr)\nsys.stdout.buffer.write(data)\n";
#[test]
fn protocol_preserves_strings_empty_results_and_rejects_invalid_output() {
    let t = crate::domain::sample_table("t".into(), 0);
    let d = decode(&encode(&t, RowFormat::List).unwrap(), RowFormat::List).unwrap();
    assert_eq!(d.rows, t.rows);
    let header = b"{\"format\":\"sagyodai-table\",\"version\":1,\"columns\":[\"a\"]}\n";
    assert!(decode(header, RowFormat::List).unwrap().rows.is_empty());
    for suffix in ["[1]\n", "[null]\n", "[\"a\",\"b\"]\n", "debug\n", "\n"] {
        let mut bytes = header.to_vec();
        bytes.extend_from_slice(suffix.as_bytes());
        assert!(decode(&bytes, RowFormat::List).is_err());
    }
    assert!(decode(b"not json", RowFormat::List).is_err());
    assert!(decode(&vec![b' '; MAX_BYTES + 1], RowFormat::List).is_err());
}
#[tokio::test]
async fn success_propagates_logs_restores_and_shares_undo() {
    let f = Fixture::new(ECHO);
    f.setup().await;
    let rev = f.snapshot().revision;
    f.start(false).await;
    let status = f.wait().await;
    assert_eq!(status["state"], "succeeded");
    assert!(status["log"].as_str().unwrap().contains("日本語"));
    let s = f.snapshot();
    assert_eq!(s.tables[0].rows, s.tables[2].rows);
    assert!(!s.tables[1].stale);
    assert_eq!(s.revision, rev + 1);
    let restored = f.shared.autosave.load().unwrap().unwrap().snapshot();
    assert_eq!(restored.tables[1].rows, s.tables[1].rows);
    f.edit(Command::Undo).await;
    assert!(f.snapshot().tables[1].rows.is_empty());
    f.edit(Command::Redo).await;
    assert_eq!(f.snapshot().tables[1].rows, s.tables[1].rows);
    assert_eq!(
        api::status(
            State(f.shared.clone()),
            Json(api::Node {
                id: "table-2".into()
            })
        )
        .await
        .unwrap()
        .0["automaticAllowed"],
        false
    );
}
#[tokio::test]
async fn failures_preserve_success_cache_and_timeout() {
    let f = Fixture::new(ECHO);
    f.setup().await;
    f.start(false).await;
    assert_eq!(f.wait().await["state"], "succeeded");
    let old = f.snapshot().tables[1].rows.clone();
    for code in [
        "import sys;sys.stdin.read();sys.exit(7)",
        "import sys;sys.stdin.read();print('invalid')",
        "import sys;sys.stdin.read();sys.stdout.write('x'*(11*1024*1024))",
    ] {
        std::fs::write(&f.config.script_path, code).unwrap();
        f.start(false).await;
        assert_eq!(f.wait().await["state"], "failed");
        assert_eq!(f.snapshot().tables[1].rows, old);
        assert!(f.snapshot().tables[1].stale);
    }
    let mut config = f.config.clone();
    config.timeout_seconds = 1;
    f.edit(Command::SetScript {
        id: "table-2".into(),
        config,
    })
    .await;
    std::fs::write(&f.config.script_path, "import time;time.sleep(5)").unwrap();
    f.start(false).await;
    let status = f.wait().await;
    assert_eq!(status["state"], "failed");
    assert!(status["message"].as_str().unwrap().contains("制限時間"));
    assert_eq!(f.snapshot().tables[1].rows, old);
}
#[tokio::test]
async fn cancellation_stops_descendant_and_logs_are_bounded() {
    let f = Fixture::new(
        "import sys,subprocess,time\nsys.stdin.read()\nsubprocess.Popen([sys.executable,'-c',\"import time;time.sleep(2);open('escaped','w').write('bad')\"])\nsys.stderr.write('x'*100000);sys.stderr.flush()\ntime.sleep(5)\n",
    );
    f.setup().await;
    let run_id = f.start(true).await;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let _ = api::cancel(
        State(f.shared.clone()),
        Json(api::Cancel {
            id: "table-2".into(),
            run_id,
        }),
    )
    .await
    .unwrap();
    let status = f.wait().await;
    assert_eq!(status["state"], "canceled");
    assert_eq!(status["automaticAllowed"], false);
    assert_eq!(status["logTruncated"], true);
    assert_eq!(status["log"].as_str().unwrap().len(), runner::MAX_LOG);
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    assert!(!f.dir.join("escaped").exists());
}
#[tokio::test]
async fn input_changes_discard_runs_but_layout_changes_do_not() {
    let f = Fixture::new(
        "import sys,time\ndata=sys.stdin.buffer.read()\ntime.sleep(.4)\nsys.stdout.buffer.write(data)\n",
    );
    f.setup().await;
    f.start(false).await;
    f.edit(Command::Place {
        id: "table-1".into(),
        x: 500.,
        y: 100.,
        width: 760.,
        height: 390.,
    })
    .await;
    assert_eq!(f.wait().await["state"], "succeeded");
    let old = f.snapshot().tables[1].rows.clone();
    f.start(false).await;
    f.edit(Command::Paste {
        id: "table-1".into(),
        row: 0,
        col: 0,
        values: vec![vec!["新入力".into()]],
        expected_values: None,
    })
    .await;
    assert_eq!(f.wait().await["state"], "discarded");
    assert_eq!(f.snapshot().tables[1].rows, old);
}
#[tokio::test]
async fn automatic_runs_require_permission_and_manual_mode_stops_them() {
    let f = Fixture::new(ECHO);
    f.setup().await;
    api::start_scheduler(f.shared.clone());
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    assert!(f.snapshot().tables[1].rows.is_empty());
    f.start(true).await;
    assert_eq!(f.wait().await["state"], "succeeded");
    f.edit(Command::Paste {
        id: "table-1".into(),
        row: 0,
        col: 0,
        values: vec![vec!["自動".into()]],
        expected_values: None,
    })
    .await;
    for _ in 0..60 {
        if !f.snapshot().tables[1].stale {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert_eq!(f.snapshot().tables[2].rows[0][0], "自動");
    f.edit(Command::Configure {
        id: "table-2".into(),
        filter: None,
        manual: true,
    })
    .await;
    f.edit(Command::Paste {
        id: "table-1".into(),
        row: 0,
        col: 0,
        values: vec![vec!["手動待ち".into()]],
        expected_values: None,
    })
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(700)).await;
    assert_eq!(f.snapshot().tables[2].rows[0][0], "自動");
    assert!(f.snapshot().tables[1].stale);
}

#[tokio::test]
async fn modified_script_and_save_failure_do_not_replace_cache() {
    let f = Fixture::new(ECHO);
    f.setup().await;
    f.start(false).await;
    assert_eq!(f.wait().await["state"], "succeeded");
    let original = f.snapshot().tables[1].rows.clone();
    std::fs::write(
        &f.config.script_path,
        "import sys,time\ndata=sys.stdin.read()\ntime.sleep(.4)\nprint(data,end='')\n",
    )
    .unwrap();
    f.start(true).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    std::fs::write(&f.config.script_path, ECHO).unwrap();
    let status = f.wait().await;
    assert_eq!(status["state"], "failed");
    assert_eq!(status["automaticAllowed"], false);
    assert_eq!(f.snapshot().tables[1].rows, original);
    std::fs::create_dir(f.dir.join("project.json.tmp")).unwrap();
    f.start(false).await;
    let status = f.wait().await;
    assert_eq!(status["state"], "failed");
    assert!(status["message"].as_str().unwrap().contains("保存"));
    assert_eq!(f.snapshot().tables[1].rows, original);
}

#[tokio::test]
async fn input_column_reorder_does_not_remap_script_output_columns() {
    let f = Fixture::new(ECHO);
    f.setup().await;
    f.start(false).await;
    f.wait().await;
    let before = f.snapshot();
    let response = crate::command(
        State(f.shared.clone()),
        Json(Request {
            expected_revision: before.revision,
            command: Command::MoveColumn {
                id: "table-1".into(),
                from: 0,
                to: 1,
                expected_columns: before.tables[0].columns.clone(),
                expected_rows: before.tables[0].rows.clone(),
            },
        }),
    )
    .await;
    assert!(response.is_ok());
    assert!(f.snapshot().tables[1].stale);
    assert_eq!(f.snapshot().tables[1].output, before.tables[1].output);
}

#[tokio::test]
async fn source_free_execution_propagates_restores_and_keeps_cache_on_failure() {
    let f = Fixture::new(
        "import sys,json\nassert sys.stdin.read() == ''\nprint(json.dumps({'format':'sagyodai-table','version':1,'columns':['generated']}))\nprint(json.dumps(['hello']))\n",
    );
    f.setup().await;
    f.edit(Command::Connect {
        id: "table-2".into(),
        source: None,
    })
    .await;
    assert!(f.snapshot().tables[1].error.is_none());
    f.start(false).await;
    assert_eq!(f.wait().await["state"], "succeeded");
    let s = f.snapshot();
    assert_eq!(s.tables[1].rows, vec![vec!["hello"]]);
    assert_eq!(s.tables[1].rows, s.tables[2].rows);
    assert!(!s.tables[1].stale);
    let restored = f.shared.autosave.load().unwrap().unwrap().snapshot();
    assert_eq!(restored.tables[1].rows, s.tables[1].rows);
    assert!(!restored.tables[1].stale);
    std::fs::write(&f.config.script_path, "import sys;sys.exit(7)").unwrap();
    f.start(false).await;
    assert_eq!(f.wait().await["state"], "failed");
    assert_eq!(f.snapshot().tables[1].rows, s.tables[1].rows);
}

#[tokio::test]
async fn connecting_or_disconnecting_during_execution_discards_result() {
    let f = Fixture::new(
        "import sys,time,json\nsys.stdin.read()\ntime.sleep(.2)\nprint(json.dumps({'format':'sagyodai-table','version':1,'columns':['generated']}))\nprint(json.dumps(['old']))\n",
    );
    f.setup().await;
    for source in [None, Some("table-1".into())] {
        f.start(false).await;
        f.edit(Command::Connect {
            id: "table-2".into(),
            source,
        })
        .await;
        assert_eq!(f.wait().await["state"], "discarded");
        assert!(f.snapshot().tables[1].rows.is_empty());
    }
}

#[tokio::test]
async fn text_output_preserves_whitespace_restores_and_switches_modes() {
    let mut f = Fixture::new("import sys\nsys.stdout.write(' 日本語\\r\\n\\n末尾\\n')\n");
    f.config.output_mode = OutputMode::Text;
    f.setup().await;
    f.edit(Command::Connect {
        id: "table-2".into(),
        source: None,
    })
    .await;
    f.start(false).await;
    assert_eq!(f.wait().await["state"], "succeeded");
    let rows = vec![vec![" 日本語\r\n\n末尾\n".to_string()]];
    assert_eq!(f.snapshot().tables[2].rows, rows);
    let restored = f.shared.autosave.load().unwrap().unwrap().snapshot();
    assert_eq!(restored.tables[1].rows, rows);
    assert_eq!(
        restored.tables[1]
            .script
            .as_ref()
            .unwrap()
            .config
            .output_mode,
        OutputMode::Text
    );
    f.config.output_mode = OutputMode::Table;
    f.edit(Command::SetScript {
        id: "table-2".into(),
        config: f.config.clone(),
    })
    .await;
    f.start(false).await;
    assert_eq!(f.wait().await["state"], "failed");
    assert_eq!(f.snapshot().tables[1].rows, rows);
    assert!(
        decode_output(&[], OutputMode::Text, RowFormat::List)
            .unwrap()
            .rows
            == vec![vec![""]]
    );
    assert!(decode_output(&[255], OutputMode::Text, RowFormat::List).is_err());
    assert!(
        decode_output(
            &vec![b'x'; MAX_BYTES + 1],
            OutputMode::Text,
            RowFormat::List
        )
        .is_err()
    );
}

#[tokio::test]
async fn output_mode_change_discards_running_output_and_revokes_permission() {
    let f =
        Fixture::new("import sys,time\nsys.stdin.read()\ntime.sleep(.2)\nprint('text result')\n");
    f.setup().await;
    f.start(true).await;
    let mut config = f.config.clone();
    config.output_mode = OutputMode::Text;
    f.edit(Command::SetScript {
        id: "table-2".into(),
        config,
    })
    .await;
    let status = f.wait().await;
    assert_eq!(status["state"], "discarded");
    assert_eq!(status["automaticAllowed"], false);
    assert!(f.snapshot().tables[1].rows.is_empty());
    f.start(false).await;
    assert_eq!(f.wait().await["state"], "succeeded");
    assert_eq!(f.snapshot().tables[1].rows, vec![vec!["text result\n"]]);
}

#[test]
fn dict_rows_validate_keys_types_and_column_order() {
    let header = "{\"format\":\"sagyodai-table\",\"version\":1,\"columns\":[\"名前\",\"数量\"]}\n";
    let valid = format!("{header}{{\"数量\":\"2\",\"名前\":\"りんご\"}}\n");
    assert_eq!(
        decode(valid.as_bytes(), RowFormat::Dict).unwrap().rows,
        vec![vec!["りんご", "2"]]
    );
    assert!(
        decode(header.as_bytes(), RowFormat::Dict)
            .unwrap()
            .rows
            .is_empty()
    );
    for row in [
        r#"["りんご","2"]"#,
        r#"{"名前":"a"}"#,
        r#"{"名前":"a","数量":"2","extra":"x"}"#,
        r#"{"名前":"a","数量":2}"#,
        r#"{"名前":"a","数量":null}"#,
        r#"{"名前":"a","名前":"b","数量":"2"}"#,
    ] {
        assert!(
            decode(format!("{header}{row}\n").as_bytes(), RowFormat::Dict).is_err(),
            "{row}"
        );
    }
    assert!(decode(valid.as_bytes(), RowFormat::List).is_err());
    let mut t = crate::domain::sample_table("t".into(), 0);
    t.columns = vec!["同名".into(), "同名".into()];
    t.rows = vec![vec!["a".into(), "b".into()]];
    assert!(encode(&t, RowFormat::Dict).is_err());
    let list = encode(&t, RowFormat::List).unwrap();
    assert!(decode(&list, RowFormat::Dict).is_err());
    assert!(decode(&list, RowFormat::List).is_ok());
}

#[tokio::test]
async fn list_and_dict_can_be_selected_independently_and_restored() {
    for input in [RowFormat::List, RowFormat::Dict] {
        for output in [RowFormat::List, RowFormat::Dict] {
            let code = format!(
                "import sys,json\nh=json.loads(sys.stdin.readline())\nprint(json.dumps(h))\nfor line in sys.stdin:\n r=json.loads(line)\n assert isinstance(r,{})\n values=[r[c] for c in h['columns']] if isinstance(r,dict) else r\n print(json.dumps({}))\n",
                if input == RowFormat::Dict {
                    "dict"
                } else {
                    "list"
                },
                if output == RowFormat::Dict {
                    "dict(zip(h['columns'],values))"
                } else {
                    "values"
                }
            );
            let mut f = Fixture::new(&code);
            f.config.input_row_format = input;
            f.config.output_row_format = output;
            f.setup().await;
            f.start(false).await;
            assert_eq!(f.wait().await["state"], "succeeded");
            let snapshot = f.snapshot();
            assert_eq!(snapshot.tables[0].rows, snapshot.tables[2].rows);
            let restored = f.shared.autosave.load().unwrap().unwrap().snapshot();
            assert_eq!(restored.tables[1].script.as_ref().unwrap().config, f.config);
            assert_eq!(restored.tables[1].rows, snapshot.tables[0].rows);
            if output == RowFormat::Dict {
                std::fs::write(&f.config.script_path,"import sys,json\nh=json.loads(sys.stdin.readline())\nsys.stdin.read()\nprint(json.dumps(h))\nprint('{}')\n").unwrap();
                f.start(false).await;
                assert_eq!(f.wait().await["state"], "failed");
                assert_eq!(f.snapshot().tables[1].rows, snapshot.tables[1].rows);
            }
        }
    }
}

#[tokio::test]
async fn typed_list_and_dict_echo_preserves_i64_nulls_and_rejects_wrong_types() {
    use crate::column_types::{DataType, EmptyValue, TypeConfig, Value};
    for format in [RowFormat::List, RowFormat::Dict] {
        let f = Fixture::new("import sys\nprint(sys.stdin.read(),end='')\n");
        f.setup().await;
        let mut cfg = f.config.clone();
        cfg.input_row_format = format;
        cfg.output_row_format = format;
        f.edit(Command::SetScript {
            id: "table-2".into(),
            config: cfg,
        })
        .await;
        f.edit(Command::Paste {
            id: "table-1".into(),
            row: 0,
            col: 1,
            values: vec![vec!["9223372036854775807".into()]],
            expected_values: None,
        })
        .await;
        let col = f.snapshot().tables[0].column_schema[1].clone();
        f.edit(Command::SetColumnType {
            id: "table-1".into(),
            column_id: col.id,
            expected_config: col.config,
            config: TypeConfig {
                data_type: DataType::Integer,
                nullable: true,
                empty: EmptyValue::Null,
            },
        })
        .await;
        f.start(false).await;
        assert_eq!(f.wait().await["state"], "succeeded");
        let good = f.snapshot();
        assert_eq!(
            good.tables[2].output.as_ref().unwrap().rows[0][1],
            Value::Integer(i64::MAX)
        );
        assert_eq!(
            good.tables[2].output.as_ref().unwrap().rows[3][1],
            Value::Null
        );
        let bytes = protocol::encode(&good.tables[0], format).unwrap();
        let bad = String::from_utf8(bytes).unwrap().replace(
            "\"value\":\"9223372036854775807\"",
            "\"value\":\"9223372036854775808\"",
        );
        assert!(protocol::decode(bad.as_bytes(), format).is_err());
        std::fs::write(&f.config.script_path,"import sys\nprint(sys.stdin.read().replace('9223372036854775807','9223372036854775808'),end='')\n").unwrap();
        f.start(false).await;
        assert_eq!(f.wait().await["state"], "failed");
        assert_eq!(f.snapshot().tables[1].output, good.tables[1].output);
    }
}
