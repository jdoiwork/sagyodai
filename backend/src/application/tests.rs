use super::*;

fn run(project: &mut Project, command: Command) -> Result<Snapshot, String> {
    project.apply(Request {
        expected_revision: project.revision,
        command,
    })
}
#[test]
fn paste_expands_table_atomically_and_is_one_undo() {
    let mut p = Project::default();
    let before = p.snapshot().tables[0].rows.clone();
    run(
        &mut p,
        Command::Paste {
            id: "table-1".into(),
            row: 5,
            col: 3,
            expected_values: None,
            values: vec![
                vec!["日本語".into(), "列追加".into()],
                vec!["改行\nあり".into(), "".into()],
            ],
        },
    )
    .unwrap();
    assert_eq!(p.tables[0].rows.len(), 7);
    assert_eq!(p.tables[0].columns.len(), 5);
    assert_eq!(p.tables[0].rows[6][3], "改行\nあり");
    run(&mut p, Command::Undo).unwrap();
    assert_eq!(p.tables[0].rows, before);
    run(&mut p, Command::Redo).unwrap();
    assert_eq!(p.tables[0].rows[5][4], "列追加");
}
#[test]
fn opening_file_is_atomic_undoable_and_preserves_unique_ids() {
    let mut p = Project::default();
    let initial = p.export().unwrap();
    let mut tables = vec![
        sample_table("table-1".into(), 0),
        sample_table("table-2".into(), 1),
    ];
    tables[0].rows[0][0] = "復元したデータ".into();
    crate::column_types::refresh_input(&mut tables[0]);
    let document: serde_json::Value =
        serde_json::from_slice(&storage::encode(&tables).unwrap()).unwrap();
    let mut invalid = document.clone();
    invalid["formatVersion"] = 99.into();
    assert!(run(&mut p, Command::OpenProject { document: invalid }).is_err());
    assert_eq!(p.export().unwrap(), initial);
    assert_eq!(p.revision, 0);
    run(&mut p, Command::OpenProject { document }).unwrap();
    assert_eq!(p.tables[0].rows[0][0], "復元したデータ");
    run(&mut p, Command::Undo).unwrap();
    assert_eq!(p.export().unwrap(), initial);
    run(&mut p, Command::Redo).unwrap();
    run(&mut p, Command::AddTable).unwrap();
    assert_eq!(p.tables[2].id, "table-3");
}
#[test]
fn invalid_paste_and_stale_edit_leave_state_untouched() {
    let mut p = Project::default();
    assert!(
        run(
            &mut p,
            Command::Paste {
                id: "table-1".into(),
                row: 4999,
                col: 0,
                expected_values: None,
                values: vec![vec!["x".into()], vec!["y".into()]]
            }
        )
        .is_err()
    );
    assert_eq!(p.revision, 0);
    assert!(!p.snapshot().can_undo);
    run(
        &mut p,
        Command::AddColumn {
            id: "table-1".into(),
        },
    )
    .unwrap();
    assert!(
        p.apply(Request {
            expected_revision: 0,
            command: Command::AddTable
        })
        .is_err()
    );
    assert_eq!(p.tables.len(), 1);
}

#[cfg(test)]
mod sync_tests {
    use super::*;
    #[test]
    fn guarded_paste_preserves_other_edits_and_rejects_same_cell_conflicts() {
        let mut project = Project::default();
        let edit = |revision, col, value: &str, expected: &str| Request {
            expected_revision: revision,
            command: Command::Paste {
                id: "table-1".into(),
                row: 0,
                col,
                values: vec![vec![value.into()]],
                expected_values: Some(vec![vec![Some(expected.into())]]),
            },
        };
        project.apply(edit(0, 0, "別タブ", "ノート")).unwrap();
        assert!(project.apply(edit(1, 0, "自分の入力", "ノート")).is_err());
        assert_eq!(project.snapshot().revision, 1);
        project.apply(edit(1, 1, "4", "3")).unwrap();
        assert_eq!(project.snapshot().tables[0].rows[0][0], "別タブ");
        project
            .apply(Request {
                expected_revision: 2,
                command: Command::Undo,
            })
            .unwrap();
        assert_eq!(project.snapshot().tables[0].rows[0][1], "3");
        assert_eq!(project.snapshot().tables[0].rows[0][0], "別タブ");
    }
}
