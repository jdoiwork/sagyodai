//! 表示用の絞り込みを、独立して編集できる処理フィルターに変換する。
use crate::{
    domain::{Filter, Operator, Table},
    table_view::TableView,
};

pub fn conditions(table: &Table, expected: &TableView) -> Result<Vec<Filter>, String> {
    if &table.view != expected {
        return Err("表示の絞り込みが変更されました。現在の設定で作成し直してください。".into());
    }
    let mut filters = Vec::new();
    // 列構成が変わった後の古い表示条件は、表の表示と同様に無視する。
    let schema: Vec<String> = serde_json::from_str(&table.view.columns.schema).unwrap_or_default();
    if schema == table.columns {
        for (column, values) in &table.view.columns.values {
            let column = column
                .parse::<usize>()
                .map_err(|_| "列の指定が不正です。")?;
            filters.push(Filter {
                column,
                operator: Operator::In,
                value: String::new(),
                values: values.clone(),
            });
        }
        filters.sort_by_key(|filter| filter.column);
    }
    if !table.view.query.trim().is_empty() {
        filters.push(Filter {
            column: 0,
            operator: Operator::SearchAll,
            value: table.view.query.clone(),
            values: vec![],
        });
    }
    if filters.is_empty() {
        return Err("適用中のクイックフィルターがありません。".into());
    }
    Ok(filters)
}

#[cfg(test)]
mod tests {
    use crate::{
        application::Project,
        domain::{Command, Request},
        table_view::{ColumnView, TableView},
    };
    fn run(p: &mut Project, command: Command) -> Result<(), String> {
        p.apply(Request {
            expected_revision: p.snapshot().revision,
            command,
        })
        .map(|_| ())
    }
    #[test]
    fn creates_connected_filters_with_search_and_undo_as_one_operation() {
        let mut p = Project::default();
        run(
            &mut p,
            Command::Paste {
                id: "table-1".into(),
                row: 0,
                col: 0,
                values: vec![
                    vec!["Apple".into(), "赤".into()],
                    vec!["apple".into(), "青".into()],
                    vec!["梨".into(), "赤".into()],
                ],
                expected_values: None,
            },
        )
        .unwrap();
        let columns = ColumnView {
            schema: serde_json::to_string(&p.snapshot().tables[0].columns).unwrap(),
            values: [("1".into(), vec!["赤".into()])].into(),
            sort: None,
        };
        run(
            &mut p,
            Command::SetViewColumns {
                id: "table-1".into(),
                columns,
                expected_columns: Default::default(),
            },
        )
        .unwrap();
        run(
            &mut p,
            Command::SetViewQuery {
                id: "table-1".into(),
                query: " APPLE ".into(),
                expected_query: "".into(),
            },
        )
        .unwrap();
        let original = p.export().unwrap();
        let view = p.snapshot().tables[0].view.clone();
        run(
            &mut p,
            Command::CreateViewFilters {
                id: "table-1".into(),
                expected_view: view.clone(),
            },
        )
        .unwrap();
        let snap = p.snapshot();
        assert_eq!(snap.tables.len(), 3);
        assert_eq!(snap.tables[1].source.as_deref(), Some("table-1"));
        assert_eq!(
            snap.tables[2].source.as_deref(),
            Some(snap.tables[1].id.as_str())
        );
        assert_eq!(snap.tables[2].rows.len(), 1);
        assert_eq!(snap.tables[2].rows[0][0], "Apple");
        assert_eq!(snap.tables[0].view, view);
        let saved = p.export().unwrap();
        Project::restore(serde_json::from_slice(&saved).unwrap(), 0).unwrap();
        run(&mut p, Command::Undo).unwrap();
        assert_eq!(p.export().unwrap(), original);
        run(&mut p, Command::Redo).unwrap();
        assert_eq!(p.export().unwrap(), saved);
        assert!(
            run(
                &mut p,
                Command::CreateViewFilters {
                    id: "table-1".into(),
                    expected_view: TableView::default()
                }
            )
            .is_err()
        );
        assert_eq!(p.export().unwrap(), saved);
    }
    #[test]
    fn empty_selection_matches_no_rows_and_capacity_failure_is_atomic() {
        let mut p = Project::default();
        let columns = ColumnView {
            schema: serde_json::to_string(&p.snapshot().tables[0].columns).unwrap(),
            values: [("0".into(), vec![])].into(),
            sort: None,
        };
        run(
            &mut p,
            Command::SetViewColumns {
                id: "table-1".into(),
                columns,
                expected_columns: Default::default(),
            },
        )
        .unwrap();
        let view = p.snapshot().tables[0].view.clone();
        run(
            &mut p,
            Command::CreateViewFilters {
                id: "table-1".into(),
                expected_view: view.clone(),
            },
        )
        .unwrap();
        assert!(p.snapshot().tables[1].rows.is_empty());
        for _ in 2..crate::storage::MAX_NODES {
            run(&mut p, Command::AddTable).unwrap();
        }
        let before = p.export().unwrap();
        let restored = Project::restore(serde_json::from_slice(&before).unwrap(), 0).unwrap();
        assert_eq!(restored.snapshot().tables.len(), crate::storage::MAX_NODES);
        assert!(run(&mut p, Command::AddTable).is_err());
        assert!(
            run(
                &mut p,
                Command::CreateViewFilters {
                    id: "table-1".into(),
                    expected_view: view
                }
            )
            .is_err()
        );
        assert_eq!(p.export().unwrap(), before);
    }
}
