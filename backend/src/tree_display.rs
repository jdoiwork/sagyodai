//! 1列のJSON原文を検証する。表示形式への変換はUIで行い、出力表は保持する。
use crate::domain::Table;
pub fn evaluate(source: &Table) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    if source.columns.len() != 1 {
        return Err(
            "結果ツリーにはJSONテキストの1列を接続してください。結果表で列を選択できます。".into(),
        );
    }
    let text = source
        .rows
        .iter()
        .map(|row| row[0].as_str())
        .collect::<Vec<_>>()
        .join("\n");
    serde_json::from_str::<serde_json::Value>(&text).map_err(|e| {
        format!(
            "JSONとして読み取れません（{}行 {}列）: {}",
            e.line(),
            e.column(),
            e
        )
    })?;
    Ok((source.columns.clone(), source.rows.clone()))
}

#[cfg(test)]
mod tests {
    use crate::{
        application::Project,
        domain::{Command, Kind, Request},
    };
    fn run(p: &mut Project, command: Command) {
        p.apply(Request {
            expected_revision: p.snapshot().revision,
            command,
        })
        .unwrap();
    }
    #[test]
    fn json_result_keeps_successful_cache_on_parse_failure_and_restores() {
        let mut p = Project::default();
        for kind in [Kind::Text, Kind::TreeDisplay] {
            run(
                &mut p,
                Command::AddNode {
                    kind,
                    position: None,
                    sheet_id: None,
                },
            );
        }
        let import = |text: &str| Command::ImportText {
            id: "table-2".into(),
            file_name: "data.json".into(),
            text: text.into(),
        };
        run(&mut p, import("{\n\"商品\": [1, true, null]\n}"));
        run(
            &mut p,
            Command::Connect {
                id: "table-3".into(),
                source: Some("table-2".into()),
            },
        );
        let good = p.snapshot().tables[2].rows.clone();
        run(&mut p, import("{bad"));
        assert!(
            p.snapshot().tables[2]
                .error
                .as_ref()
                .unwrap()
                .contains("JSON")
        );
        assert_eq!(p.snapshot().tables[2].rows, good);
        let restored =
            Project::restore(serde_json::from_slice(&p.export().unwrap()).unwrap(), 0).unwrap();
        assert_eq!(restored.snapshot().tables[2].rows, good);
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
        run(&mut p, import("null"));
        assert!(p.snapshot().tables[2].stale);
        assert_eq!(p.snapshot().tables[2].rows, good);
        run(
            &mut p,
            Command::Run {
                id: "table-3".into(),
            },
        );
        assert_eq!(p.snapshot().tables[2].rows, [vec!["null"]]);
        run(
            &mut p,
            Command::Connect {
                id: "table-3".into(),
                source: Some("table-1".into()),
            },
        );
        run(
            &mut p,
            Command::Run {
                id: "table-3".into(),
            },
        );
        assert!(
            p.snapshot().tables[2]
                .error
                .as_ref()
                .unwrap()
                .contains("1列")
        );
        assert_eq!(p.snapshot().tables[2].rows, [vec!["null"]]);
    }
}
