use crate::{
    application::Project,
    domain::{Command, Kind, PaletteColor, Request, Snapshot},
    storage,
};
fn run(p: &mut Project, command: Command) -> Result<Snapshot, String> {
    p.apply(Request {
        expected_revision: p.snapshot().revision,
        command,
    })
}
fn setup() -> Project {
    let mut p = Project::default();
    for kind in [Kind::Input, Kind::Union, Kind::Display] {
        run(
            &mut p,
            Command::AddNode {
                sheet_id: None,
                kind,
                position: None,
            },
        )
        .unwrap();
    }
    run(
        &mut p,
        Command::SetUnion {
            id: "table-3".into(),
            sources: vec!["table-1".into(), "table-2".into()],
            distinct: false,
            expected_sources: vec![],
        },
    )
    .unwrap();
    run(
        &mut p,
        Command::Connect {
            id: "table-4".into(),
            source: Some("table-3".into()),
        },
    )
    .unwrap();
    p
}
fn mode(p: &mut Project, sources: &[&str], distinct: bool) {
    let expected_sources = p.snapshot().tables[2]
        .union_inputs
        .iter()
        .map(|i| i.source.clone())
        .collect();
    run(
        p,
        Command::SetUnion {
            id: "table-3".into(),
            sources: sources.iter().map(|s| s.to_string()).collect(),
            distinct,
            expected_sources,
        },
    )
    .unwrap();
}
#[test]
fn union_modes_preserve_order_exact_rows_history_and_files() {
    let mut p = setup();
    let a = p.snapshot().tables[0].rows.clone();
    assert_eq!(p.snapshot().tables[2].rows, [a.clone(), a.clone()].concat());
    mode(&mut p, &["table-1", "table-2"], true);
    assert_eq!(p.snapshot().tables[2].rows, a[..4]);
    assert_eq!(p.snapshot().tables[3].rows, a[..4]);
    run(&mut p, Command::Undo).unwrap();
    assert_eq!(p.snapshot().tables[2].rows.len(), 12);
    run(&mut p, Command::Redo).unwrap();
    run(
        &mut p,
        Command::Paste {
            id: "table-2".into(),
            row: 0,
            col: 0,
            values: vec![vec!["別の行".into()]],
            expected_values: None,
        },
    )
    .unwrap();
    mode(&mut p, &["table-2", "table-1"], true);
    assert_eq!(p.snapshot().tables[2].rows[0][0], "別の行");
    assert_eq!(p.snapshot().tables[2].rows.len(), 5);
    let restored =
        Project::restore(serde_json::from_slice(&p.export().unwrap()).unwrap(), 0).unwrap();
    assert_eq!(
        restored.snapshot().tables[2].rows,
        p.snapshot().tables[2].rows
    );
    assert_eq!(
        restored.snapshot().tables[2].union_inputs,
        p.snapshot().tables[2].union_inputs
    );
    assert!(restored.snapshot().tables[2].union_distinct);
}
#[test]
fn invalid_schema_and_manual_inputs_preserve_cache_and_recover() {
    let mut p = setup();
    let cached = p.snapshot().tables[2].rows.clone();
    let cols = p.snapshot().tables[1].columns.clone();
    run(
        &mut p,
        Command::RenameColumn {
            id: "table-2".into(),
            col: 0,
            name: "別名".into(),
            expected_columns: cols,
        },
    )
    .unwrap();
    assert!(
        p.snapshot().tables[2]
            .error
            .as_ref()
            .unwrap()
            .contains("列名")
    );
    assert_eq!(p.snapshot().tables[2].rows, cached);
    let cols = p.snapshot().tables[1].columns.clone();
    run(
        &mut p,
        Command::RenameColumn {
            id: "table-2".into(),
            col: 0,
            name: "品名".into(),
            expected_columns: cols,
        },
    )
    .unwrap();
    assert!(p.snapshot().tables[2].error.is_none());
    run(
        &mut p,
        Command::Configure {
            id: "table-3".into(),
            filter: None,
            manual: true,
        },
    )
    .unwrap();
    run(
        &mut p,
        Command::Paste {
            id: "table-1".into(),
            row: 0,
            col: 0,
            values: vec![vec!["更新".into()]],
            expected_values: None,
        },
    )
    .unwrap();
    assert!(p.snapshot().tables[2].stale);
    assert!(p.snapshot().tables[3].stale);
    assert_eq!(p.snapshot().tables[2].rows, cached);
    run(
        &mut p,
        Command::Run {
            id: "table-3".into(),
        },
    )
    .unwrap();
    assert_eq!(p.snapshot().tables[3].rows[0][0], "更新");
}
#[test]
fn multi_input_cycles_duplicates_and_missing_sources_are_atomic() {
    let mut p = setup();
    run(
        &mut p,
        Command::AddNode {
            sheet_id: None,
            kind: Kind::Filter,
            position: None,
        },
    )
    .unwrap();
    run(
        &mut p,
        Command::Connect {
            id: "table-5".into(),
            source: Some("table-3".into()),
        },
    )
    .unwrap();
    for sources in [
        vec!["table-5"],
        vec!["table-1", "table-1"],
        vec!["missing"],
        vec!["table-4"],
    ] {
        let before = p.export().unwrap();
        assert!(
            run(
                &mut p,
                Command::SetUnion {
                    id: "table-3".into(),
                    sources: sources.iter().map(|s| s.to_string()).collect(),
                    distinct: false,
                    expected_sources: vec!["table-1".into(), "table-2".into()]
                }
            )
            .is_err()
        );
        assert_eq!(p.export().unwrap(), before);
    }
    let mut file: serde_json::Value = serde_json::from_slice(&p.export().unwrap()).unwrap();
    file["tables"][2]["unionInputs"][0]["source"] = "table-5".into();
    assert!(storage::decode(file).is_err());
}
#[test]
fn ports_colors_disconnect_and_removed_source_preserve_other_inputs() {
    let mut p = setup();
    run(
        &mut p,
        Command::SetColor {
            id: "table-1".into(),
            target: crate::domain::ColorTarget::Output,
            color: Some(PaletteColor::Blue),
        },
    )
    .unwrap();
    mode(&mut p, &["table-2"], false);
    run(
        &mut p,
        Command::ConnectFromPort {
            id: "table-3".into(),
            source: "table-1".into(),
            from_input: false,
        },
    )
    .unwrap();
    assert_eq!(
        p.snapshot().tables[2].union_inputs[1].color,
        Some(PaletteColor::Blue)
    );
    mode(&mut p, &["table-1", "table-2"], false);
    assert_eq!(
        p.snapshot().tables[2].union_inputs[0].color,
        Some(PaletteColor::Blue)
    );
    run(
        &mut p,
        Command::RemoveNode {
            id: "table-2".into(),
        },
    )
    .unwrap();
    let union = &p.snapshot().tables[1];
    assert_eq!(union.union_inputs.len(), 1);
    assert_eq!(union.rows.len(), 6);
}
#[test]
fn merge_bounds_zero_rows_and_string_equality() {
    let mut a = crate::domain::sample_table("a".into(), 0);
    let mut b = a.clone();
    a.rows = vec![vec!["1".into(); 4], vec!["1.0".into(); 4]];
    b.rows = a.rows.clone();
    assert_eq!(
        crate::union::merge(&[a.clone(), b.clone()], true)
            .unwrap()
            .1
            .len(),
        2
    );
    a.rows.clear();
    b.rows.clear();
    assert!(
        crate::union::merge(&[a.clone(), b.clone()], false)
            .unwrap()
            .1
            .is_empty()
    );
    a.rows = vec![vec!["x".into(); 4]; 5000];
    b.rows = vec![vec!["x".into(); 4]];
    assert!(crate::union::merge(&[a.clone(), b.clone()], false).is_err());
    assert_eq!(crate::union::merge(&[a, b], true).unwrap().1.len(), 1);
}
