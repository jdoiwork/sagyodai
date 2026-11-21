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

#[test]
fn rename_preserves_connections_rejects_conflicts_and_roundtrips() {
    let mut p = flow();
    let original = p.snapshot().tables[0].title.clone();
    run(
        &mut p,
        Command::Rename {
            id: "table-1".into(),
            title: "売上データ".into(),
            expected_title: original.clone(),
        },
    )
    .unwrap();
    assert_eq!(p.snapshot().tables[1].source.as_deref(), Some("table-1"));
    let saved = p.export().unwrap();
    assert_eq!(
        storage::decode(serde_json::from_slice(&saved).unwrap()).unwrap()[0].title,
        "売上データ"
    );
    for (title, expected) in [("競合", original.as_str()), ("  ", "売上データ")] {
        assert!(
            run(
                &mut p,
                Command::Rename {
                    id: "table-1".into(),
                    title: title.into(),
                    expected_title: expected.into()
                }
            )
            .is_err()
        );
        assert_eq!(p.export().unwrap(), saved);
    }
    run(&mut p, Command::Undo).unwrap();
    assert_eq!(p.snapshot().tables[0].title, original);
    run(&mut p, Command::Redo).unwrap();
    assert_eq!(p.snapshot().tables[0].title, "売上データ");
}

#[test]
fn numeric_equality_handles_notation_invalid_cells_and_saved_conditions() {
    let mut p = flow();
    run(
        &mut p,
        Command::Paste {
            id: "table-1".into(),
            row: 0,
            col: 1,
            values: ["3", "3.0", " 3 ", "3e0", "4", "", "abc", "NaN", "inf"]
                .iter()
                .map(|s| vec![s.to_string()])
                .collect(),
            expected_values: None,
        },
    )
    .unwrap();
    configure(&mut p, Operator::NumberEquals, "3", false);
    assert_eq!(p.snapshot().tables[2].rows.len(), 4);
    configure(&mut p, Operator::NumberNotEquals, "3.0", false);
    assert_eq!(p.snapshot().tables[2].rows.len(), 1);
    assert_eq!(p.snapshot().tables[2].rows[0][1], "4");
    let file = p.export().unwrap();
    let mut restored = Project::default();
    run(
        &mut restored,
        Command::OpenProject {
            document: serde_json::from_slice(&file).unwrap(),
        },
    )
    .unwrap();
    assert_eq!(restored.export().unwrap(), file);
    configure(&mut p, Operator::NumberEquals, "NaN", false);
    assert!(p.snapshot().tables[1].error.is_some());
    assert_eq!(p.snapshot().tables[2].rows.len(), 1);
    configure(&mut p, Operator::Equals, "3", false);
    assert_eq!(p.snapshot().tables[2].rows.len(), 1);
}

#[test]
fn compact_filter_preserves_data_dimensions_and_survives_save_and_undo() {
    let mut p = flow();
    let original = p.snapshot().tables[1].clone();
    run(
        &mut p,
        Command::SetCompact {
            id: original.id.clone(),
            compact: true,
        },
    )
    .unwrap();
    let compact = p.snapshot().tables[1].clone();
    assert!(compact.compact);
    assert_eq!(compact.rows, original.rows);
    assert_eq!(
        (compact.width, compact.height),
        (original.width, original.height)
    );
    let file = p.export().unwrap();
    let restored = storage::decode(serde_json::from_slice(&file).unwrap()).unwrap();
    assert!(restored[1].compact);
    run(&mut p, Command::Undo).unwrap();
    assert!(!p.snapshot().tables[1].compact);
    run(&mut p, Command::Redo).unwrap();
    assert!(p.snapshot().tables[1].compact);
    assert!(
        run(
            &mut p,
            Command::SetCompact {
                id: "table-1".into(),
                compact: true
            }
        )
        .is_err()
    );
}

#[test]
fn editing_rows_and_columns_preserves_filters_and_supports_undo_and_save() {
    let mut p = flow();
    configure(&mut p, Operator::Greater, "2", false);
    let before = p.snapshot().tables[0].clone();
    run(
        &mut p,
        Command::RenameColumn {
            id: before.id.clone(),
            col: 1,
            name: "在庫数".into(),
            expected_columns: before.columns.clone(),
        },
    )
    .unwrap();
    assert_eq!(p.snapshot().tables[2].columns[1], "在庫数");
    let input = p.snapshot().tables[0].clone();
    run(
        &mut p,
        Command::RemoveRow {
            id: input.id.clone(),
            row: 0,
            expected_rows: input.rows.clone(),
        },
    )
    .unwrap();
    assert_eq!(p.snapshot().tables[0].rows.len(), input.rows.len() - 1);
    assert_eq!(p.snapshot().tables[2].rows.len(), 1);
    // 別タブで古い行番号を見ていた削除は受け付けない。
    assert!(
        run(
            &mut p,
            Command::RemoveRow {
                id: input.id.clone(),
                row: 0,
                expected_rows: input.rows
            }
        )
        .is_err()
    );
    run(&mut p, Command::Undo).unwrap();
    assert_eq!(p.snapshot().tables[0].rows, before.rows);
    let input = p.snapshot().tables[0].clone();
    assert!(
        run(
            &mut p,
            Command::RemoveColumn {
                id: input.id.clone(),
                col: 1,
                expected_columns: input.columns.clone(),
                expected_rows: input.rows.clone()
            }
        )
        .is_err()
    );
    run(
        &mut p,
        Command::RemoveColumn {
            id: input.id.clone(),
            col: 0,
            expected_columns: input.columns,
            expected_rows: input.rows,
        },
    )
    .unwrap();
    let s = p.snapshot();
    assert_eq!(s.tables[0].columns[0], "在庫数");
    assert_eq!(s.tables[1].filter.as_ref().unwrap().column, 0);
    assert_eq!(s.tables[2].rows.len(), 2);
    let file = p.export().unwrap();
    let mut restored = Project::default();
    run(
        &mut restored,
        Command::OpenProject {
            document: serde_json::from_slice(&file).unwrap(),
        },
    )
    .unwrap();
    assert_eq!(restored.export().unwrap(), file);
    run(&mut p, Command::Undo).unwrap();
    assert_eq!(p.snapshot().tables[1].filter.as_ref().unwrap().column, 1);
}

#[test]
fn structural_edits_reject_readonly_and_last_row_or_column() {
    let mut p = flow();
    let output = p.snapshot().tables[2].clone();
    assert!(
        run(
            &mut p,
            Command::RemoveRow {
                id: output.id.clone(),
                row: 0,
                expected_rows: output.rows.clone()
            }
        )
        .is_err()
    );
    assert!(
        run(
            &mut p,
            Command::RenameColumn {
                id: output.id.clone(),
                col: 0,
                name: "変更".into(),
                expected_columns: output.columns.clone()
            }
        )
        .is_err()
    );
    assert!(
        run(
            &mut p,
            Command::RemoveColumn {
                id: output.id,
                col: 0,
                expected_columns: output.columns,
                expected_rows: output.rows
            }
        )
        .is_err()
    );
    let mut t = crate::domain::sample_table("table-1".into(), 0);
    t.columns = vec!["列".into()];
    t.rows = vec![vec!["値".into()]];
    run(
        &mut p,
        Command::OpenProject {
            document: serde_json::from_slice(&storage::encode(&[t.clone()]).unwrap()).unwrap(),
        },
    )
    .unwrap();
    assert!(
        run(
            &mut p,
            Command::RemoveRow {
                id: t.id.clone(),
                row: 0,
                expected_rows: t.rows.clone()
            }
        )
        .is_err()
    );
    assert!(
        run(
            &mut p,
            Command::RemoveColumn {
                id: t.id,
                col: 0,
                expected_columns: t.columns,
                expected_rows: t.rows
            }
        )
        .is_err()
    );
}

#[test]
fn column_widths_are_saved_undoable_guarded_and_follow_deletion() {
    let mut p = flow();
    let input = p.snapshot().tables[0].clone();
    run(
        &mut p,
        Command::ResizeColumn {
            id: input.id.clone(),
            col: 1,
            width: 260.0,
            expected_width: 160.0,
            expected_columns: input.columns.clone(),
        },
    )
    .unwrap();
    assert_eq!(p.snapshot().tables[0].column_widths[1], 260.0);
    assert!(
        run(
            &mut p,
            Command::ResizeColumn {
                id: input.id.clone(),
                col: 1,
                width: 300.0,
                expected_width: 160.0,
                expected_columns: input.columns.clone()
            }
        )
        .is_err()
    );
    assert!(
        run(
            &mut p,
            Command::ResizeColumn {
                id: input.id.clone(),
                col: 1,
                width: 0.0,
                expected_width: 260.0,
                expected_columns: input.columns.clone()
            }
        )
        .is_err()
    );
    run(&mut p, Command::Undo).unwrap();
    assert!(p.snapshot().tables[0].column_widths.is_empty());
    run(&mut p, Command::Redo).unwrap();
    let output = p.snapshot().tables[2].clone();
    run(
        &mut p,
        Command::ResizeColumn {
            id: output.id.clone(),
            col: 1,
            width: 200.0,
            expected_width: 160.0,
            expected_columns: output.columns,
        },
    )
    .unwrap();
    assert_eq!(p.snapshot().tables[2].rows, output.rows);
    configure(&mut p, Operator::Greater, "2", false);
    let input = p.snapshot().tables[0].clone();
    run(
        &mut p,
        Command::RemoveColumn {
            id: input.id,
            col: 0,
            expected_columns: input.columns,
            expected_rows: input.rows,
        },
    )
    .unwrap();
    assert_eq!(p.snapshot().tables[0].column_widths[0], 260.0);
    assert_eq!(p.snapshot().tables[2].column_widths[0], 200.0);
    let file = p.export().unwrap();
    let decoded = storage::decode(serde_json::from_slice(&file).unwrap()).unwrap();
    assert_eq!(decoded[0].column_widths[0], 260.0);
    let mut bad: serde_json::Value = serde_json::from_slice(&file).unwrap();
    bad["tables"][0]["columnWidths"][0] = 0.into();
    assert!(storage::decode(bad).is_err());
}

#[test]
fn column_reordering_preserves_filter_meaning_widths_and_history() {
    let mut p = flow();
    configure(&mut p, Operator::Greater, "2", false);
    let original = p.snapshot().tables[0].clone();
    run(
        &mut p,
        Command::ResizeColumn {
            id: original.id.clone(),
            col: 1,
            width: 240.0,
            expected_width: 160.0,
            expected_columns: original.columns.clone(),
        },
    )
    .unwrap();
    let output_rows = p.snapshot().tables[2].rows.clone();
    run(
        &mut p,
        Command::MoveColumn {
            id: original.id.clone(),
            from: 1,
            to: 0,
            expected_columns: original.columns.clone(),
            expected_rows: original.rows.clone(),
        },
    )
    .unwrap();
    let moved = p.snapshot();
    assert_eq!(moved.tables[0].columns, ["数量", "品名", "分類", "メモ"]);
    assert_eq!(moved.tables[0].rows[0][0], "3");
    assert_eq!(moved.tables[0].column_widths[0], 240.0);
    assert_eq!(moved.tables[1].filter.as_ref().unwrap().column, 0);
    assert_eq!(moved.tables[2].rows.len(), output_rows.len());
    for (actual, old) in moved.tables[2].rows.iter().zip(&output_rows) {
        assert_eq!(
            actual,
            &vec![
                old[1].clone(),
                old[0].clone(),
                old[2].clone(),
                old[3].clone()
            ]
        );
    }
    assert!(
        run(
            &mut p,
            Command::MoveColumn {
                id: original.id.clone(),
                from: 1,
                to: 0,
                expected_columns: original.columns.clone(),
                expected_rows: original.rows.clone()
            }
        )
        .is_err()
    );
    let file = p.export().unwrap();
    assert_eq!(
        storage::encode(&storage::decode(serde_json::from_slice(&file).unwrap()).unwrap()).unwrap(),
        file
    );
    run(&mut p, Command::Undo).unwrap();
    assert_eq!(p.snapshot().tables[0].columns, original.columns);
    assert_eq!(p.snapshot().tables[1].filter.as_ref().unwrap().column, 1);
    run(&mut p, Command::Redo).unwrap();
    let current = p.snapshot().tables[0].clone();
    run(
        &mut p,
        Command::MoveColumn {
            id: current.id,
            from: 0,
            to: 3,
            expected_columns: current.columns,
            expected_rows: current.rows,
        },
    )
    .unwrap();
    assert_eq!(p.snapshot().tables[1].filter.as_ref().unwrap().column, 3);
    assert_eq!(p.snapshot().tables[0].column_widths[3], 240.0);
    let current = p.snapshot().tables[0].clone();
    let filter = p.snapshot().tables[1].filter.clone();
    run(
        &mut p,
        Command::Configure {
            id: "table-2".into(),
            filter,
            manual: true,
        },
    )
    .unwrap();
    assert!(
        run(
            &mut p,
            Command::MoveColumn {
                id: current.id,
                from: 0,
                to: 1,
                expected_columns: current.columns,
                expected_rows: current.rows
            }
        )
        .is_err()
    );
    let display = p.snapshot().tables[2].clone();
    assert!(
        run(
            &mut p,
            Command::MoveColumn {
                id: display.id,
                from: 0,
                to: 1,
                expected_columns: display.columns,
                expected_rows: display.rows
            }
        )
        .is_err()
    );
}

#[test]
fn bulk_deletion_is_atomic_and_one_undo() {
    let mut p = flow();
    let before = p.snapshot().tables[0].clone();
    run(
        &mut p,
        Command::RemoveRows {
            id: before.id.clone(),
            indices: vec![2, 0],
            expected_rows: before.rows.clone(),
        },
    )
    .unwrap();
    assert_eq!(p.snapshot().tables[0].rows.len(), before.rows.len() - 2);
    run(&mut p, Command::Undo).unwrap();
    assert_eq!(p.snapshot().tables[0].rows, before.rows);
    // 大きな添字の削除が済んだ後でも、参照列の削除に失敗したら全体を戻す。
    assert!(
        run(
            &mut p,
            Command::RemoveColumns {
                id: before.id.clone(),
                indices: vec![1, 3],
                expected_columns: before.columns.clone(),
                expected_rows: before.rows.clone()
            }
        )
        .is_err()
    );
    assert_eq!(p.snapshot().tables[0].columns, before.columns);
    assert_eq!(p.snapshot().tables[0].rows, before.rows);
    run(
        &mut p,
        Command::RemoveColumns {
            id: before.id.clone(),
            indices: vec![0, 2],
            expected_columns: before.columns.clone(),
            expected_rows: before.rows.clone(),
        },
    )
    .unwrap();
    assert_eq!(p.snapshot().tables[1].filter.as_ref().unwrap().column, 0);
    assert_eq!(
        p.snapshot().tables[0].columns,
        vec![before.columns[1].clone(), before.columns[3].clone()]
    );
    run(&mut p, Command::Undo).unwrap();
    assert_eq!(p.snapshot().tables[0].rows, before.rows);
    for indices in [
        vec![],
        vec![0, 0],
        vec![99],
        (0..before.rows.len()).collect(),
    ] {
        assert!(
            run(
                &mut p,
                Command::RemoveRows {
                    id: before.id.clone(),
                    indices,
                    expected_rows: before.rows.clone()
                }
            )
            .is_err()
        );
        assert_eq!(p.snapshot().tables[0].rows, before.rows);
    }
    let mut stale = before.rows.clone();
    stale[0][0] = "古い値".into();
    assert!(
        run(
            &mut p,
            Command::RemoveRows {
                id: before.id,
                indices: vec![0, 2],
                expected_rows: stale
            }
        )
        .is_err()
    );
}

#[test]
fn multiple_columns_move_together_with_references_and_undo() {
    let mut p = flow();
    let original = p.snapshot().tables[0].clone();
    run(
        &mut p,
        Command::ResizeColumn {
            id: original.id.clone(),
            col: 1,
            width: 240.0,
            expected_width: 160.0,
            expected_columns: original.columns.clone(),
        },
    )
    .unwrap();
    let before = p.snapshot();
    run(
        &mut p,
        Command::MoveColumns {
            id: original.id.clone(),
            indices: vec![3, 1],
            to: 0,
            expected_columns: original.columns.clone(),
            expected_rows: original.rows.clone(),
        },
    )
    .unwrap();
    let moved = p.snapshot();
    assert_eq!(moved.tables[0].columns, ["数量", "メモ", "品名", "分類"]);
    assert_eq!(moved.tables[0].column_widths[0], 240.0);
    assert_eq!(moved.tables[1].filter.as_ref().unwrap().column, 0);
    for (old_table, new_table) in before.tables.iter().zip(&moved.tables) {
        for (old, new) in old_table.rows.iter().zip(&new_table.rows) {
            assert_eq!(
                *new,
                vec![
                    old[1].clone(),
                    old[3].clone(),
                    old[0].clone(),
                    old[2].clone()
                ]
            );
        }
    }
    assert!(
        run(
            &mut p,
            Command::MoveColumns {
                id: original.id.clone(),
                indices: vec![0, 2],
                to: 2,
                expected_columns: original.columns.clone(),
                expected_rows: original.rows.clone()
            }
        )
        .is_err()
    );
    run(&mut p, Command::Undo).unwrap();
    assert_eq!(p.snapshot().tables[0].rows, original.rows);
    assert_eq!(p.snapshot().tables[1].filter.as_ref().unwrap().column, 1);
    for (indices, to) in [(vec![], 0), (vec![1, 1], 0), (vec![99], 0), (vec![0, 1], 3)] {
        assert!(
            run(
                &mut p,
                Command::MoveColumns {
                    id: original.id.clone(),
                    indices,
                    to,
                    expected_columns: original.columns.clone(),
                    expected_rows: original.rows.clone()
                }
            )
            .is_err()
        );
        assert_eq!(p.snapshot().tables[0].rows, original.rows);
    }
    run(
        &mut p,
        Command::MoveColumns {
            id: original.id,
            indices: vec![0, 2],
            to: 2,
            expected_columns: original.columns,
            expected_rows: original.rows,
        },
    )
    .unwrap();
    assert_eq!(
        p.snapshot().tables[0].columns,
        ["数量", "メモ", "品名", "分類"]
    );
}

#[test]
fn row_reordering_preserves_values_filter_order_and_undo() {
    let mut p = flow();
    let before = p.snapshot();
    let input = before.tables[0].clone();
    run(
        &mut p,
        Command::MoveRows {
            id: input.id.clone(),
            indices: vec![2, 0],
            to: input.rows.len() - 2,
            expected_columns: input.columns.clone(),
            expected_rows: input.rows.clone(),
        },
    )
    .unwrap();
    let after = p.snapshot();
    let mut order: Vec<usize> = (0..input.rows.len())
        .filter(|i| *i != 0 && *i != 2)
        .collect();
    order.extend([0, 2]);
    assert_eq!(
        after.tables[0].rows,
        order
            .iter()
            .map(|i| input.rows[*i].clone())
            .collect::<Vec<_>>()
    );
    assert_eq!(after.tables[0].columns, input.columns);
    assert_eq!(after.tables[0].column_widths, input.column_widths);
    let expected: Vec<_> = after.tables[0]
        .rows
        .iter()
        .filter(|r| before.tables[2].rows.contains(r))
        .cloned()
        .collect();
    assert_eq!(after.tables[2].rows, expected);
    assert!(
        run(
            &mut p,
            Command::MoveRows {
                id: input.id.clone(),
                indices: vec![0],
                to: 1,
                expected_columns: input.columns.clone(),
                expected_rows: input.rows.clone()
            }
        )
        .is_err()
    );
    run(&mut p, Command::Undo).unwrap();
    assert_eq!(p.snapshot().tables[0].rows, input.rows);
    run(&mut p, Command::Redo).unwrap();
    assert_eq!(p.snapshot().tables[0].rows, after.tables[0].rows);
    run(&mut p, Command::Undo).unwrap();
    for (indices, to) in [
        (vec![], 0),
        (vec![0, 0], 0),
        (vec![9999], 0),
        (vec![0, 1], input.rows.len()),
    ] {
        assert!(
            run(
                &mut p,
                Command::MoveRows {
                    id: input.id.clone(),
                    indices,
                    to,
                    expected_columns: input.columns.clone(),
                    expected_rows: input.rows.clone()
                }
            )
            .is_err()
        );
        assert_eq!(p.snapshot().tables[0].rows, input.rows);
    }
    let output = before.tables[2].clone();
    assert!(
        run(
            &mut p,
            Command::MoveRows {
                id: output.id,
                indices: vec![0],
                to: 1,
                expected_columns: output.columns,
                expected_rows: output.rows
            }
        )
        .is_err()
    );
}
