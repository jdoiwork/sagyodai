use crate::{
    application::Project,
    domain::{Command, Kind, Request},
    text_source::TextDisplay,
};
fn run(p: &mut Project, command: Command) -> Result<crate::domain::Snapshot, String> {
    p.apply(Request {
        expected_revision: p.snapshot().revision,
        command,
    })
}
#[test]
fn text_result_updates_caches_roundtrips_and_preserves_table_output() {
    let mut p = Project::default();
    for kind in [Kind::Text, Kind::TextDisplay, Kind::Display] {
        run(
            &mut p,
            Command::AddNode {
                kind,
                position: None,
                sheet_id: None,
            },
        )
        .unwrap();
    }
    assert_eq!(p.snapshot().tables[2].title, "結果テキスト 3");
    assert_eq!(p.snapshot().tables[2].text_display, TextDisplay::Plain);
    let import = |text: &str| Command::ImportText {
        id: "table-2".into(),
        file_name: "test.txt".into(),
        text: text.into(),
    };
    run(&mut p, import("# 見出し\n\n本文")).unwrap();
    for (id, source) in [("table-3", "table-2"), ("table-4", "table-3")] {
        run(
            &mut p,
            Command::Connect {
                id: id.into(),
                source: Some(source.into()),
            },
        )
        .unwrap();
    }
    assert_eq!(
        p.snapshot().tables[3].rows,
        [vec!["# 見出し"], vec![""], vec!["本文"]]
    );
    run(
        &mut p,
        Command::SetTextDisplay {
            id: "table-3".into(),
            display: TextDisplay::Markdown,
        },
    )
    .unwrap();
    run(
        &mut p,
        Command::Configure {
            id: "table-3".into(),
            filter: None,
            manual: true,
        },
    )
    .unwrap();
    run(&mut p, import("更新済み")).unwrap();
    assert!(p.snapshot().tables[2].stale);
    assert_eq!(p.snapshot().tables[2].rows.len(), 3);
    let saved = p.export().unwrap();
    let restored = Project::restore(serde_json::from_slice(&saved).unwrap(), 0).unwrap();
    assert_eq!(
        restored.snapshot().tables[2].text_display,
        TextDisplay::Markdown
    );
    assert_eq!(restored.snapshot().tables[2].rows.len(), 3);
    run(
        &mut p,
        Command::Run {
            id: "table-3".into(),
        },
    )
    .unwrap();
    assert_eq!(p.snapshot().tables[3].rows, [vec!["更新済み"]]);
    run(&mut p, Command::Undo).unwrap();
    assert_eq!(p.snapshot().tables[2].rows.len(), 3);
    run(&mut p, Command::Redo).unwrap();
    run(
        &mut p,
        Command::Connect {
            id: "table-3".into(),
            source: None,
        },
    )
    .unwrap();
    run(
        &mut p,
        Command::Run {
            id: "table-3".into(),
        },
    )
    .unwrap();
    assert!(p.snapshot().tables[2].error.is_some());
    assert_eq!(p.snapshot().tables[2].rows, [vec!["更新済み"]]);
    run(
        &mut p,
        Command::Connect {
            id: "table-3".into(),
            source: Some("table-1".into()),
        },
    )
    .unwrap();
    run(
        &mut p,
        Command::Run {
            id: "table-3".into(),
        },
    )
    .unwrap();
    assert_eq!(
        p.snapshot().tables[0].columns,
        p.snapshot().tables[2].columns
    );
    assert_eq!(p.snapshot().tables[0].rows, p.snapshot().tables[3].rows);
    assert!(
        run(
            &mut p,
            Command::Connect {
                id: "table-3".into(),
                source: Some("table-4".into())
            }
        )
        .is_err()
    );
}
