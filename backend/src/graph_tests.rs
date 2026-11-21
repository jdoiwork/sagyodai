use crate::{
    application::Project,
    domain::{Command, Filter, Kind, Operator, Request, Snapshot},
    storage,
};
fn run(p: &mut Project, command: Command) -> Result<Snapshot, String> {
    p.apply(Request {
        expected_revision: p.snapshot().revision,
        command,
    })
}
fn configure(p: &mut Project, operator: Operator, value: &str, manual: bool) {
    run(
        p,
        Command::Configure {
            id: "table-2".into(),
            filter: Some(Filter {
                column: 1,
                operator,
                value: value.into(),
            }),
            manual,
        },
    )
    .unwrap();
}
fn flow() -> Project {
    let mut p = Project::default();
    run(
        &mut p,
        Command::AddNode {
            kind: Kind::Filter,
            position: None,
        },
    )
    .unwrap();
    run(
        &mut p,
        Command::AddNode {
            kind: Kind::Display,
            position: None,
        },
    )
    .unwrap();
    run(
        &mut p,
        Command::Connect {
            id: "table-2".into(),
            source: Some("table-1".into()),
        },
    )
    .unwrap();
    configure(&mut p, Operator::AtLeast, "3", false);
    run(
        &mut p,
        Command::Connect {
            id: "table-3".into(),
            source: Some("table-2".into()),
        },
    )
    .unwrap();
    p
}
fn paste(p: &mut Project, id: &str, value: &str) -> Result<Snapshot, String> {
    run(
        p,
        Command::Paste {
            id: id.into(),
            row: 0,
            col: 1,
            values: vec![vec![value.into()]],
            expected_values: None,
        },
    )
}
#[test]
fn propagation_branching_read_only_and_shared_undo() {
    let mut p = flow();
    assert_eq!(p.snapshot().tables[2].rows.len(), 2);
    run(
        &mut p,
        Command::AddNode {
            kind: Kind::Display,
            position: None,
        },
    )
    .unwrap();
    run(
        &mut p,
        Command::Connect {
            id: "table-4".into(),
            source: Some("table-2".into()),
        },
    )
    .unwrap();
    paste(&mut p, "table-1", "1").unwrap();
    assert_eq!(p.snapshot().tables[2].rows.len(), 1);
    assert_eq!(p.snapshot().tables[3].rows, p.snapshot().tables[2].rows);
    assert!(paste(&mut p, "table-3", "編集禁止").is_err());
    run(&mut p, Command::Undo).unwrap();
    assert_eq!(p.snapshot().tables[2].rows.len(), 2);
    run(&mut p, Command::Redo).unwrap();
    assert_eq!(p.snapshot().tables[2].rows.len(), 1);
}
#[test]
fn manual_updates_hold_cache_and_run_propagates() {
    let mut p = flow();
    configure(&mut p, Operator::AtLeast, "3", true);
    paste(&mut p, "table-1", "1").unwrap();
    let state = p.snapshot();
    assert!(state.tables[1].stale && state.tables[2].stale);
    assert_eq!(state.tables[2].rows.len(), 2);
    run(
        &mut p,
        Command::Run {
            id: "table-2".into(),
        },
    )
    .unwrap();
    assert!(!p.snapshot().tables[2].stale);
    assert_eq!(p.snapshot().tables[2].rows.len(), 1);
    run(
        &mut p,
        Command::Configure {
            id: "table-3".into(),
            filter: None,
            manual: true,
        },
    )
    .unwrap();
    paste(&mut p, "table-1", "5").unwrap();
    assert!(p.snapshot().tables[2].stale);
    assert_eq!(p.snapshot().tables[2].rows.len(), 1);
    run(
        &mut p,
        Command::Run {
            id: "table-3".into(),
        },
    )
    .unwrap();
    assert!(p.snapshot().tables[2].error.is_some());
    assert_eq!(p.snapshot().tables[2].rows.len(), 1);
    run(
        &mut p,
        Command::Run {
            id: "table-2".into(),
        },
    )
    .unwrap();
    assert_eq!(p.snapshot().tables[2].rows.len(), 1);
    run(
        &mut p,
        Command::Run {
            id: "table-3".into(),
        },
    )
    .unwrap();
    assert_eq!(p.snapshot().tables[2].rows.len(), 2);
}
#[test]
fn failure_preserves_cache_zero_rows_is_success_and_files_roundtrip() {
    let mut p = flow();
    configure(&mut p, Operator::Greater, "not a number", false);
    assert!(p.snapshot().tables[1].error.is_some());
    assert_eq!(p.snapshot().tables[2].rows.len(), 2);
    let bytes = p.export().unwrap();
    let mut restored = Project::default();
    run(
        &mut restored,
        Command::OpenProject {
            document: serde_json::from_slice(&bytes).unwrap(),
        },
    )
    .unwrap();
    assert_eq!(restored.export().unwrap(), bytes);
    configure(&mut p, Operator::Greater, "100", false);
    assert_eq!(p.snapshot().tables[2].rows.len(), 0);
    assert!(!p.snapshot().tables[2].stale);
    assert_eq!(p.snapshot().tables[2].columns.len(), 4);
    assert!(storage::decode(serde_json::from_slice(&p.export().unwrap()).unwrap()).is_ok());
    configure(&mut p, Operator::AtLeast, "0", false);
    assert_eq!(p.snapshot().tables[2].rows.len(), 3); // 空欄は数値0として扱わない。
}
#[test]
fn cycles_invalid_sources_and_corrupt_saved_graphs_are_atomic() {
    let mut p = flow();
    run(
        &mut p,
        Command::AddNode {
            kind: Kind::Filter,
            position: None,
        },
    )
    .unwrap();
    run(
        &mut p,
        Command::Connect {
            id: "table-4".into(),
            source: Some("table-2".into()),
        },
    )
    .unwrap();
    let before = p.export().unwrap();
    for source in ["table-4", "table-2", "table-3", "missing"] {
        assert!(
            run(
                &mut p,
                Command::Connect {
                    id: "table-2".into(),
                    source: Some(source.into())
                }
            )
            .is_err()
        );
        assert_eq!(before, p.export().unwrap());
    }
    let mut file: serde_json::Value = serde_json::from_slice(&before).unwrap();
    file["tables"][1]["source"] = "table-4".into();
    assert!(storage::decode(file).is_err());
    run(
        &mut p,
        Command::RemoveNode {
            id: "table-2".into(),
        },
    )
    .unwrap();
    assert!(p.snapshot().tables[1].source.is_none());
    assert_eq!(p.snapshot().tables[1].rows.len(), 2); // 削除後も表示キャッシュを維持。
}
#[test]
fn japanese_string_filters_and_empty_match() {
    let mut p = flow();
    for (operator, value, count) in [
        (Operator::Equals, "文房具", 2),
        (Operator::Contains, "品", 1),
        (Operator::NotEquals, "", 3),
    ] {
        run(
            &mut p,
            Command::Configure {
                id: "table-2".into(),
                filter: Some(Filter {
                    column: 2,
                    operator,
                    value: value.into(),
                }),
                manual: false,
            },
        )
        .unwrap();
        assert_eq!(p.snapshot().tables[2].rows.len(), count);
    }
}

#[test]
fn node_creation_uses_requested_position_and_undo_restores_it() {
    let mut p = Project::default();
    run(
        &mut p,
        Command::AddNode {
            kind: Kind::Filter,
            position: Some(crate::domain::Position {
                x: -1200.5,
                y: 930.0,
            }),
        },
    )
    .unwrap();
    assert_eq!(p.snapshot().tables[1].x, -1200.5);
    run(&mut p, Command::Undo).unwrap();
    assert_eq!(p.snapshot().tables.len(), 1);
    run(&mut p, Command::Redo).unwrap();
    assert_eq!(p.snapshot().tables[1].y, 930.0);
}
