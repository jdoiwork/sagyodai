use crate::{
    application::Project,
    domain::{Command, Request},
};
use serde_json::{Value, json};
fn run(p: &mut Project, command: Value) -> Result<(), String> {
    let command: Command = serde_json::from_value(command).unwrap();
    p.apply(Request {
        expected_revision: p.snapshot().revision,
        command,
    })
    .map(|_| ())
}
fn document(p: &Project) -> Value {
    serde_json::from_slice(&p.export().unwrap()).unwrap()
}
#[test]
fn moving_all_node_kinds_keeps_connections_cache_colors_layout_and_history() {
    let mut p = Project::default();
    run(&mut p, json!({"type":"addSheet"})).unwrap();
    for kind in ["filter", "union", "display"] {
        run(&mut p, json!({"type":"addNode","kind":kind})).unwrap();
    }
    for (id, source) in [
        ("table-2", "table-1"),
        ("table-3", "table-1"),
        ("table-3", "table-2"),
        ("table-4", "table-3"),
    ] {
        run(&mut p, json!({"type":"connect","id":id,"source":source})).unwrap();
    }
    run(
        &mut p,
        json!({"type":"setUnionEdgeColor","id":"table-3","source":"table-2","color":"blue"}),
    )
    .unwrap();
    for id in ["table-1", "table-2", "table-3", "table-4"] {
        let before = document(&p);
        run(&mut p,json!({"type":"moveNodeToSheet","id":id,"sheetId":"sheet-2","expectedSheetId":"sheet-1"})).unwrap();
        let moved = document(&p);
        let mut expected = before.clone();
        for t in expected["tables"].as_array_mut().unwrap() {
            if t["id"] == id {
                t["sheetId"] = "sheet-2".into();
            }
        }
        assert_eq!(moved, expected);
        run(&mut p, json!({"type":"undo"})).unwrap();
        assert_eq!(document(&p), before);
        run(&mut p, json!({"type":"redo"})).unwrap();
        assert_eq!(document(&p), moved);
        assert_eq!(
            document(&Project::restore(moved.clone(), 0).unwrap()),
            moved
        );
    }
    run(
        &mut p,
        json!({"type":"paste","id":"table-1","row":0,"col":0,"values":[["移動後の更新"]]}),
    )
    .unwrap();
    assert_eq!(p.snapshot().tables[3].rows[0][0], "移動後の更新");
}
#[test]
fn invalid_destination_and_concurrent_move_leave_state_unchanged() {
    let mut p = Project::default();
    run(&mut p, json!({"type":"addSheet"})).unwrap();
    for (destination, expected) in [("missing", "sheet-1"), ("sheet-2", "sheet-2")] {
        let before = document(&p);
        let revision = p.snapshot().revision;
        assert!(run(&mut p,json!({"type":"moveNodeToSheet","id":"table-1","sheetId":destination,"expectedSheetId":expected})).is_err());
        assert_eq!(document(&p), before);
        assert_eq!(p.snapshot().revision, revision);
    }
}
