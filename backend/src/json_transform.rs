//! 1列のJSONテキストからのキー抽出と、配列の表への変換。
use crate::{
    domain::{Kind, Table},
    storage::{MAX_COLS, MAX_OUTPUT_CELL_BYTES, MAX_ROWS},
};
use serde_json::Value;
use std::collections::BTreeSet;

pub fn validate_key(key: &str) -> Result<(), String> {
    if key.len() > 1024 {
        Err("JSONのパスは1024バイト以内にしてください。".into())
    } else {
        crate::json_path::parse(key).map(|_| ())
    }
}
pub fn validate(node: &Table) -> Result<(), String> {
    if (node.kind == Kind::JsonSelect) != node.json_key.is_some() {
        return Err("JSONキー設定とノードの種類が一致しません。".into());
    }
    if let Some(key) = &node.json_key {
        validate_key(key)?;
    }
    Ok(())
}
fn parse(source: &Table) -> Result<Value, String> {
    if source.columns.len() != 1 {
        return Err("JSONテキストの1列を接続してください。".into());
    }
    let bytes = source
        .rows
        .iter()
        .map(|r| r[0].len())
        .sum::<usize>()
        .saturating_add(source.rows.len().saturating_sub(1));
    if bytes > MAX_OUTPUT_CELL_BYTES {
        return Err("JSONテキストは11 MiB以内にしてください。".into());
    }
    let text = source
        .rows
        .iter()
        .map(|r| r[0].as_str())
        .collect::<Vec<_>>()
        .join("\n");
    serde_json::from_str(&text).map_err(|e| {
        format!(
            "JSONとして読み取れません（{}行 {}列）: {e}",
            e.line(),
            e.column()
        )
    })
}
fn json(value: &Value) -> Result<String, String> {
    serde_json::to_string(value).map_err(|e| format!("JSONを出力できません: {e}"))
}
fn cell(value: &Value) -> Result<String, String> {
    let text = match value {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        v => json(v)?,
    };
    if text.len() > MAX_OUTPUT_CELL_BYTES {
        return Err("変換結果のセルが11 MiBを超えています。".into());
    }
    Ok(text)
}
pub fn evaluate(source: &Table, node: &Table) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let value = parse(source)?;
    if node.kind == Kind::JsonSelect {
        let key = node
            .json_key
            .as_deref()
            .ok_or("キー名を指定してください。")?;
        let selected = crate::json_path::select(&value, key)?;
        let text = json(selected)?;
        if text.len() > MAX_OUTPUT_CELL_BYTES {
            return Err("抽出結果が11 MiBを超えています。".into());
        }
        return Ok((vec!["JSON".into()], vec![vec![text]]));
    }
    let array = value
        .as_array()
        .ok_or("表への変換にはJSON配列を接続してください。")?;
    if array.len() > MAX_ROWS {
        return Err("JSON配列は5000要素以内にしてください。".into());
    }
    if array.is_empty() {
        return Ok((vec![], vec![]));
    }
    if array.iter().any(Value::is_object) {
        if !array.iter().all(Value::is_object) {
            return Err("オブジェクトとそれ以外が混在した配列は表に変換できません。".into());
        }
        // 型のない表でも列対応を一意にするため、キーの和集合を名前順に並べる。
        let mut keys = BTreeSet::new();
        for value in array {
            for key in value
                .as_object()
                .ok_or("オブジェクトではありません。")?
                .keys()
            {
                if key.len() > 1024 {
                    return Err("列になるJSONキー名は1024バイト以内にしてください。".into());
                }
                keys.insert(key.clone());
                if keys.len() > MAX_COLS {
                    return Err("JSONの出力列は50列以内にしてください。".into());
                }
            }
        }
        let columns: Vec<_> = keys.into_iter().collect();
        let rows = array
            .iter()
            .map(|v| {
                columns
                    .iter()
                    .map(|k| cell(v.get(k).unwrap_or(&Value::Null)))
                    .collect()
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok((columns, rows))
    } else {
        Ok((
            vec!["値".into()],
            array
                .iter()
                .map(|v| cell(v).map(|s| vec![s]))
                .collect::<Result<_, _>>()?,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        application::Project,
        domain::{Command, Request, sample_table},
    };
    fn input(text: &str) -> Table {
        let mut t = sample_table("source".into(), 0);
        t.columns = vec!["JSON".into()];
        t.rows = vec![vec![text.into()]];
        t
    }
    fn node(kind: Kind) -> Table {
        let mut t = input("");
        t.kind = kind;
        t.json_key = (kind == Kind::JsonSelect).then(|| "items".into());
        t
    }
    #[test]
    fn extracts_values_and_converts_objects_scalars_empty_and_invalid_arrays() {
        let select = node(Kind::JsonSelect);
        let table = node(Kind::JsonTable);
        let (cols, rows) = evaluate(
            &input(
                r#"{"items":[{"b":2,"a":"日本語","nested":{"x":true}},{"b":null,"extra":false}]}"#,
            ),
            &select,
        )
        .unwrap();
        assert_eq!(cols, ["JSON"]);
        let (cols, rows) = evaluate(&input(&rows[0][0]), &table).unwrap();
        assert_eq!(cols, ["a", "b", "extra", "nested"]);
        assert_eq!(
            rows,
            vec![
                vec!["日本語", "2", "", r#"{"x":true}"#],
                vec!["", "", "false", ""]
            ]
        );
        assert_eq!(
            evaluate(&input(r#"["a",3,true,null,[1,2]]"#), &table)
                .unwrap()
                .1,
            vec![vec!["a"], vec!["3"], vec!["true"], vec![""], vec!["[1,2]"]]
        );
        assert!(evaluate(&input("[]"), &table).unwrap().1.is_empty());
        for text in ["{}", "bad", "[{},1]"] {
            assert!(evaluate(&input(text), &table).is_err());
        }
        assert!(evaluate(&input("{}"), &select).is_err());
        let mut key = node(Kind::JsonSelect);
        key.json_key = Some(r#"["a.b"]"#.into());
        assert_eq!(
            evaluate(&input(r#"{"a.b":null}"#), &key).unwrap().1,
            [vec!["null"]]
        );
        let many = serde_json::json!(vec![0; 5001]);
        assert!(evaluate(&input(&many.to_string()), &table).is_err());
        let many = Value::Array(vec![Value::Object(
            (0..51).map(|n| (n.to_string(), Value::Null)).collect(),
        )]);
        assert!(evaluate(&input(&many.to_string()), &table).is_err());
    }
    fn run(p: &mut Project, c: Command) {
        p.apply(Request {
            expected_revision: p.snapshot().revision,
            command: c,
        })
        .unwrap();
    }
    #[test]
    fn pipeline_propagates_persists_and_keeps_cache_on_errors_and_manual_updates() {
        let mut p = Project::default();
        for kind in [Kind::Note, Kind::JsonSelect, Kind::JsonTable, Kind::Display] {
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
            Command::SetNote {
                id: "table-2".into(),
                text: r#"{"groups":[{"items":[{"name":"ペン","count":3}]}]}"#.into(),
                expected_text: String::new(),
            },
        );
        run(
            &mut p,
            Command::SetJsonKey {
                id: "table-3".into(),
                key: "groups[0].items".into(),
            },
        );
        for (id, source) in [
            ("table-3", "table-2"),
            ("table-4", "table-3"),
            ("table-5", "table-4"),
        ] {
            run(
                &mut p,
                Command::Connect {
                    id: id.into(),
                    source: Some(source.into()),
                },
            );
        }
        let good = p.snapshot().tables[4].rows.clone();
        assert_eq!(good, [vec!["3", "ペン"]]);
        let restored =
            Project::restore(serde_json::from_slice(&p.export().unwrap()).unwrap(), 0).unwrap();
        assert_eq!(restored.snapshot().tables[4].rows, good);
        run(
            &mut p,
            Command::SetJsonKey {
                id: "table-3".into(),
                key: "missing".into(),
            },
        );
        assert!(p.snapshot().tables[2].error.is_some());
        assert_eq!(p.snapshot().tables[4].rows, good);
        run(&mut p, Command::Undo);
        assert!(p.snapshot().tables[2].error.is_none());
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
            Command::SetJsonKey {
                id: "table-3".into(),
                key: "missing".into(),
            },
        );
        assert!(p.snapshot().tables[2].stale);
        assert!(p.snapshot().tables[2].error.is_none());
        run(
            &mut p,
            Command::Run {
                id: "table-3".into(),
            },
        );
        assert!(p.snapshot().tables[2].error.is_some());
        assert_eq!(p.snapshot().tables[4].rows, good);
    }
}
