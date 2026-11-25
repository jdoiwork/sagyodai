use crate::{
    application::Project,
    column_types::*,
    domain::{Command, Request},
    storage,
};
use serde_json::{Value as Json, json};
fn apply(p: &mut Project, c: Json) {
    p.apply(Request {
        expected_revision: p.snapshot().revision,
        command: serde_json::from_value(c).unwrap(),
    })
    .unwrap();
}
fn integer() -> TypeConfig {
    TypeConfig {
        data_type: DataType::Integer,
        nullable: false,
        empty: EmptyValue::Value("0".into()),
    }
}
fn set(p: &mut Project, col: usize, config: TypeConfig) {
    let c = p.snapshot().tables[0].column_schema[col].clone();
    apply(
        p,
        json!({"type":"setColumnType","id":"table-1","columnId":c.id,"config":config,"expectedConfig":c.config}),
    );
}
fn add(p: &mut Project, kind: &str, source: &str) -> String {
    apply(p, json!({"type":"addNode","kind":kind}));
    let id = p.snapshot().tables.last().unwrap().id.clone();
    apply(p, json!({"type":"connect","id":id,"source":source}));
    id
}
#[test]
fn parsing_empty_policy_nullable_and_integer_boundaries_are_independent() {
    let mut c = integer();
    for (text, n) in [
        ("", 0),
        ("  +0012 ", 12),
        ("9223372036854775807", i64::MAX),
        ("-9223372036854775808", i64::MIN),
    ] {
        assert_eq!(c.parse(text).unwrap(), Value::Integer(n));
    }
    for text in [
        "1.0",
        "1e2",
        "NaN",
        "未定",
        " ",
        "9223372036854775808",
        "-9223372036854775809",
    ] {
        assert!(c.parse(text).is_err(), "{text}");
    }
    c.empty = EmptyValue::Value("12".into());
    assert_eq!(c.parse("").unwrap(), Value::Integer(12));
    c.empty = EmptyValue::Null;
    assert!(c.validate().is_err());
    c.nullable = true;
    assert_eq!(c.parse("").unwrap(), Value::Null);
    c.empty = EmptyValue::Error;
    assert!(c.parse("").is_err());
    c.data_type = DataType::Boolean;
    c.empty = EmptyValue::Value("false".into());
    assert_eq!(c.parse("").unwrap(), Value::Boolean(false));
    assert_eq!(c.parse(" true ").unwrap(), Value::Boolean(true));
    assert!(c.parse("0").is_err());
    let c = TypeConfig::default();
    assert_eq!(c.parse("00123").unwrap(), Value::String("00123".into()));
    assert_eq!(c.parse("null").unwrap(), Value::String("null".into()));
}
#[test]
fn raw_errors_preserve_success_cache_downstream_undo_and_restore() {
    let mut p = Project::default();
    let display = add(&mut p, "display", "table-1");
    set(&mut p, 1, integer());
    let good = p.snapshot();
    assert_eq!(good.tables[0].rows[3][1], "");
    assert_eq!(good.tables[1].rows[3][1], "0");
    apply(
        &mut p,
        json!({"type":"paste","id":"table-1","row":0,"col":1,"values":[["未定"]]}),
    );
    let bad = p.snapshot();
    assert_eq!(bad.tables[0].rows[0][1], "未定");
    assert_eq!(bad.tables[0].cell_errors[0].row, 0);
    assert!(bad.tables[0].stale && bad.tables[1].stale);
    assert_eq!(bad.tables[0].output, good.tables[0].output);
    assert_eq!(bad.tables[1].output, good.tables[1].output);
    let restored = Project::restore(
        serde_json::from_slice(&p.export().unwrap()).unwrap(),
        bad.revision,
    )
    .unwrap();
    assert_eq!(restored.snapshot().tables[0].rows, bad.tables[0].rows);
    assert_eq!(restored.snapshot().tables[1].output, good.tables[1].output);
    apply(&mut p, json!({"type":"undo"}));
    assert_eq!(p.snapshot().tables[0].output, good.tables[0].output);
    apply(&mut p, json!({"type":"redo"}));
    assert!(p.snapshot().tables[0].stale);
    apply(
        &mut p,
        json!({"type":"paste","id":"table-1","row":0,"col":1,"values":[["9007199254740993"]]}),
    );
    assert_eq!(p.snapshot().tables[1].rows[0][1], "9007199254740993");
    assert_eq!(p.snapshot().tables[1].id, display);
}
#[test]
fn ids_survive_rename_reorder_manual_cache_and_group_references() {
    let mut p = Project::default();
    set(&mut p, 1, integer());
    let g = add(&mut p, "aggregate", "table-1");
    apply(
        &mut p,
        json!({"type":"setGroup","id":g,"config":{"groupBy":[],"sums":[1],"count":false}}),
    );
    assert_eq!(p.snapshot().tables[1].rows, vec![vec!["17"]]);
    apply(
        &mut p,
        json!({"type":"configure","id":g,"filter":null,"manual":true}),
    );
    let before = p.snapshot().tables[0].clone();
    let id = before.column_schema[1].id.clone();
    apply(
        &mut p,
        json!({"type":"moveColumn","id":"table-1","from":1,"to":0,"expectedColumns":before.columns,"expectedRows":before.rows}),
    );
    assert_eq!(p.snapshot().tables[0].column_schema[0].id, id);
    assert!(p.snapshot().tables[1].stale);
    assert_eq!(p.snapshot().tables[1].rows, vec![vec!["17"]]);
    let t = p.snapshot().tables[0].clone();
    apply(
        &mut p,
        json!({"type":"renameColumn","id":"table-1","col":0,"name":"個数","expectedColumns":t.columns}),
    );
    apply(&mut p, json!({"type":"run","id":g}));
    assert_eq!(p.snapshot().tables[1].rows, vec![vec!["17"]]);
    assert_eq!(p.snapshot().tables[1].group.as_ref().unwrap().sums, vec![0]);
    let file = p.export().unwrap();
    let mut restored = Project::restore(serde_json::from_slice(&file).unwrap(), 0).unwrap();
    apply(&mut restored, json!({"type":"run","id":g}));
    assert_eq!(restored.snapshot().tables[1].rows, vec![vec!["17"]]);
}
#[test]
fn conversion_nulls_union_filters_and_overflow_do_not_coerce_invalid_values() {
    let mut p = Project::default();
    let cv = add(&mut p, "convert", "table-1");
    let id = p.snapshot().tables[0].column_schema[1].id.clone();
    let mut config = integer();
    config.nullable = true;
    config.empty = EmptyValue::Null;
    apply(
        &mut p,
        json!({"type":"setTypeConversion","id":cv,"columns":{id.clone():config}}),
    );
    assert_eq!(
        p.snapshot().tables[1].output.as_ref().unwrap().rows[3][1],
        Value::Null
    );
    assert_eq!(
        p.snapshot().tables[0].column_schema[1].config.data_type,
        DataType::String
    );
    let f = add(&mut p, "filter", &cv);
    apply(
        &mut p,
        json!({"type":"configure","id":f,"manual":false,"filter":{"column":1,"operator":"greater","value":"2"}}),
    );
    assert_eq!(p.snapshot().tables[2].rows.len(), 2);
    let group = add(&mut p, "aggregate", &cv);
    apply(
        &mut p,
        json!({"type":"setGroup","id":group,"config":{"groupBy":[],"sums":[1],"count":false}}),
    );
    let good = p.snapshot().tables[3].output.clone();
    apply(
        &mut p,
        json!({"type":"paste","id":"table-1","row":0,"col":1,"values":[["9223372036854775807"]]}),
    );
    assert!(
        p.snapshot().tables[3]
            .error
            .as_deref()
            .unwrap()
            .contains("範囲")
    );
    assert_eq!(p.snapshot().tables[3].output, good);
    let before = p.snapshot().tables[1].output.clone();
    apply(
        &mut p,
        json!({"type":"paste","id":"table-1","row":0,"col":1,"values":[["1.5"]]}),
    );
    assert!(p.snapshot().tables[1].stale);
    assert_eq!(p.snapshot().tables[1].output, before);
}
#[test]
fn integer_sort_and_footer_are_exact_above_javascript_safe_integer() {
    let mut p = Project::default();
    apply(
        &mut p,
        json!({"type":"paste","id":"table-1","row":0,"col":1,"values":[["9007199254740993"],["9007199254740992"],["-1"]]}),
    );
    set(&mut p, 1, integer());
    let sort = add(&mut p, "sort", "table-1");
    apply(
        &mut p,
        json!({"type":"setSort","id":sort,"keys":[{"column":1,"mode":"number","direction":"desc"}]}),
    );
    assert_eq!(p.snapshot().tables[1].rows[0][1], "9007199254740993");
    let cols = p.snapshot().tables[0].columns.clone();
    apply(
        &mut p,
        json!({"type":"setFooter","id":"table-1","expectedColumns":cols,"columns":[false,true,false,false]}),
    );
    assert_eq!(
        p.snapshot().tables[0].footer_totals[1].as_deref(),
        Some("18014398509481984")
    );
    apply(
        &mut p,
        json!({"type":"paste","id":"table-1","row":0,"col":1,"values":[["bad"]]}),
    );
    assert_eq!(
        p.snapshot().tables[0].footer_totals[1].as_deref(),
        Some("型エラー")
    );
}
#[test]
fn malformed_schema_cache_and_invalid_null_policy_are_rejected_atomically() {
    let mut p = Project::default();
    let t = p.snapshot().tables[0].clone();
    let mut c = integer();
    c.empty = EmptyValue::Null;
    assert!(
        p.apply(Request {
            expected_revision: 0,
            command: Command::SetColumnType {
                id: t.id.clone(),
                column_id: t.column_schema[1].id.clone(),
                config: c,
                expected_config: t.column_schema[1].config.clone()
            }
        })
        .is_err()
    );
    assert_eq!(p.snapshot().revision, 0);
    let doc: Json = serde_json::from_slice(&p.export().unwrap()).unwrap();
    for change in [0, 1, 2, 3] {
        let mut bad = doc.clone();
        match change {
            0 => {
                bad["tables"][0]["columnSchema"][1]["id"] =
                    bad["tables"][0]["columnSchema"][0]["id"].clone()
            }
            1 => bad["tables"][0]["output"]["rows"][0][1] = json!({"type":"integer","value":"2"}),
            2 => bad["tables"][0]["columnSchema"][0]["config"]["empty"] = json!({"mode":"null"}),
            _ => bad["formatVersion"] = json!(2),
        }
        assert!(storage::decode(bad).is_err());
    }
}

#[test]
fn manual_footer_follows_cached_column_ids_only_when_output_is_refreshed() {
    let mut p = Project::default();
    set(&mut p, 1, integer());
    let display = add(&mut p, "display", "table-1");
    let cols = p.snapshot().tables[1].columns.clone();
    apply(
        &mut p,
        json!({"type":"setFooter","id":display,"expectedColumns":cols,"columns":[false,true,false,false]}),
    );
    apply(
        &mut p,
        json!({"type":"configure","id":display,"filter":null,"manual":true}),
    );
    let input = p.snapshot().tables[0].clone();
    apply(
        &mut p,
        json!({"type":"moveColumn","id":"table-1","from":1,"to":0,"expectedColumns":input.columns,"expectedRows":input.rows}),
    );
    assert_eq!(
        p.snapshot().tables[1].footer_totals[1].as_deref(),
        Some("17")
    );
    apply(&mut p, json!({"type":"run","id":display}));
    assert_eq!(
        p.snapshot().tables[1].footer_totals[0].as_deref(),
        Some("17")
    );
    assert!(p.snapshot().tables[1].footer_totals[1].is_none());
}
#[test]
fn conversion_conflict_and_malformed_saved_cache_leave_state_unchanged() {
    let mut p = Project::default();
    let cv = add(&mut p, "convert", "table-1");
    let id = p.snapshot().tables[0].column_schema[1].id.clone();
    apply(
        &mut p,
        json!({"type":"setTypeConversion","id":cv,"columns":{id:integer()},"expectedColumns":{}}),
    );
    let before = p.snapshot();
    let command = serde_json::from_value(
        json!({"type":"setTypeConversion","id":cv,"columns":{},"expectedColumns":{}}),
    )
    .unwrap();
    assert!(
        p.apply(Request {
            expected_revision: before.revision,
            command
        })
        .is_err()
    );
    assert_eq!(p.snapshot().revision, before.revision);
    let mut doc: Json = serde_json::from_slice(&p.export().unwrap()).unwrap();
    doc["tables"][1]["rows"][0][1] = json!("different");
    assert!(storage::decode(doc).is_err());
}

#[test]
fn text_numeric_comparison_keeps_its_rules_next_to_an_integer_column() {
    let mut p = Project::default();
    apply(
        &mut p,
        json!({"type":"paste","id":"table-1","row":0,"col":0,"values":[["2"],["10"],["1.5"],["invalid"],[""],["11x"]]}),
    );
    set(&mut p, 1, integer());
    let s = add(&mut p, "sort", "table-1");
    apply(
        &mut p,
        json!({"type":"setSort","id":s,"keys":[{"column":0,"direction":"desc","mode":"number"}]}),
    );
    assert_eq!(
        p.snapshot().tables[1]
            .rows
            .iter()
            .map(|r| r[0].as_str())
            .collect::<Vec<_>>(),
        vec!["10", "2", "1.5", "invalid", "", "11x"]
    );
    let f = add(&mut p, "filter", "table-1");
    apply(
        &mut p,
        json!({"type":"configure","id":f,"manual":false,"filter":{"column":0,"operator":"greater","value":"1.5"}}),
    );
    assert_eq!(p.snapshot().tables[2].rows.len(), 2);
}

#[test]
fn projected_header_reorder_uses_success_values_instead_of_raw_empty_cells() {
    let mut p = Project::default();
    set(&mut p, 1, integer());
    let display = add(&mut p, "display", "table-1");
    let t = p.snapshot().tables[1].clone();
    let column_id = t.column_schema[1].id.clone();
    apply(
        &mut p,
        json!({"type":"moveColumn","id":display,"from":1,"to":0,"expectedColumns":t.columns,"expectedRows":t.rows}),
    );
    let result = &p.snapshot().tables[1];
    assert_eq!(result.column_schema[0].id, column_id);
    assert_eq!(result.rows[3][0], "0");
    assert_eq!(
        result.output.as_ref().unwrap().rows[0][0],
        Value::Integer(3)
    );
    assert_eq!(p.snapshot().tables[0].rows[3][1], "");
}
