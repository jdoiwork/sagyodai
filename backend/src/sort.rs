//! 列の優先順に安定ソートする。入力原本は変更しない。
use crate::domain::Table;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SortKey {
    pub column: usize,
    pub direction: Direction,
    pub mode: Mode,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Asc,
    Desc,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Number,
    Text,
}
pub fn validate(keys: &[SortKey]) -> Result<(), String> {
    let mut columns = std::collections::HashSet::new();
    if keys.len() > crate::storage::MAX_COLS
        || keys
            .iter()
            .any(|k| k.column >= crate::storage::MAX_COLS || !columns.insert(k.column))
    {
        return Err("ソート列は重複なしで50列まで指定してください。".into());
    }
    Ok(())
}
pub fn rows(source: &Table, keys: &[SortKey]) -> Result<Vec<Vec<String>>, String> {
    if keys.iter().any(|k| k.column >= source.columns.len()) {
        return Err("ソート対象の列が入力にありません。".into());
    }
    let mut rows = source.rows.clone();
    rows.sort_by(|a, b| {
        for key in keys {
            let left = &a[key.column];
            let right = &b[key.column];
            let (order, valid) = match key.mode {
                Mode::Number => {
                    let parse = |s: &str| s.trim().parse::<f64>().ok().filter(|n| n.is_finite());
                    match (parse(left), parse(right)) {
                        (Some(a), Some(b)) => (a.partial_cmp(&b).unwrap_or(Ordering::Equal), true),
                        (Some(_), None) => (Ordering::Less, false),
                        (None, Some(_)) => (Ordering::Greater, false),
                        _ => (Ordering::Equal, false),
                    }
                }
                Mode::Text => match (left.is_empty(), right.is_empty()) {
                    (false, true) => (Ordering::Less, false),
                    (true, false) => (Ordering::Greater, false),
                    _ => (left.cmp(right), true),
                },
            };
            let order = if valid && key.direction == Direction::Desc {
                order.reverse()
            } else {
                order
            };
            if order != Ordering::Equal {
                return order;
            }
        }
        Ordering::Equal
    });
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        application::Project,
        domain::{Command, Kind, Request},
        storage,
    };
    fn run(p: &mut Project, command: Command) {
        p.apply(Request {
            expected_revision: p.snapshot().revision,
            command,
        })
        .unwrap();
    }
    #[test]
    fn multiple_keys_modes_missing_values_and_stable_ties() {
        let mut table = crate::domain::sample_table("t".into(), 0);
        table.rows = vec![
            vec!["A", "2"],
            vec!["B", "10"],
            vec!["A", "10"],
            vec!["A", "2.0"],
            vec!["A", ""],
            vec!["A", "abc"],
        ]
        .into_iter()
        .map(|r| r.into_iter().map(String::from).collect())
        .collect();
        let keys = vec![
            SortKey {
                column: 0,
                direction: Direction::Asc,
                mode: Mode::Text,
            },
            SortKey {
                column: 1,
                direction: Direction::Desc,
                mode: Mode::Number,
            },
        ];
        let sorted = rows(&table, &keys).unwrap();
        assert_eq!(
            sorted.iter().map(|r| r[1].as_str()).collect::<Vec<_>>(),
            ["10", "2", "2.0", "", "abc", "10"]
        );
        assert_eq!(rows(&table, &[]).unwrap(), table.rows);
        assert!(validate(&[keys[0].clone(), keys[0].clone()]).is_err());
        let text = rows(
            &table,
            &[SortKey {
                column: 1,
                direction: Direction::Asc,
                mode: Mode::Text,
            }],
        )
        .unwrap();
        assert_eq!(
            text.iter().map(|r| r[1].as_str()).collect::<Vec<_>>(),
            ["10", "10", "2", "2.0", "abc", ""]
        );
    }
    #[test]
    fn structural_column_edits_keep_sort_references() {
        let input = crate::domain::sample_table("input".into(), 0);
        let mut node = input.clone();
        node.id = "sort".into();
        node.kind = Kind::Sort;
        node.source = Some("input".into());
        node.sort_keys = vec![SortKey {
            column: 1,
            direction: Direction::Asc,
            mode: Mode::Number,
        }];
        let mut tables = vec![input.clone(), node];
        crate::table_edit::move_column(&mut tables, "input", 1, 0, &input.columns, &input.rows)
            .unwrap();
        assert_eq!(tables[1].sort_keys[0].column, 0);
        let current = tables[0].clone();
        assert!(
            crate::table_edit::remove_column(
                &mut tables,
                "input",
                0,
                &current.columns,
                &current.rows
            )
            .is_err()
        );
    }
    #[test]
    fn pipeline_manual_cache_failure_undo_and_file_roundtrip() {
        let mut p = Project::default();
        run(
            &mut p,
            Command::AddNode {
                kind: Kind::Sort,
                sheet_id: None,
                position: None,
            },
        );
        run(
            &mut p,
            Command::Connect {
                id: "table-2".into(),
                source: Some("table-1".into()),
            },
        );
        run(
            &mut p,
            Command::AddNode {
                kind: Kind::Display,
                sheet_id: None,
                position: None,
            },
        );
        run(
            &mut p,
            Command::Connect {
                id: "table-3".into(),
                source: Some("table-2".into()),
            },
        );
        let original = p.snapshot().tables[0].rows.clone();
        let keys = vec![SortKey {
            column: 1,
            direction: Direction::Desc,
            mode: Mode::Number,
        }];
        run(
            &mut p,
            Command::SetSort {
                id: "table-2".into(),
                keys: keys.clone(),
            },
        );
        let sorted = p.snapshot().tables[1].rows.clone();
        assert_eq!(sorted[0][1], "12");
        assert_eq!(p.snapshot().tables[0].rows, original);
        assert_eq!(p.snapshot().tables[2].rows, sorted);
        let file = p.export().unwrap();
        let restored = storage::decode(serde_json::from_slice(&file).unwrap()).unwrap();
        assert_eq!(restored[1].sort_keys, keys);
        assert_eq!(restored[2].rows, sorted);
        run(
            &mut p,
            Command::Configure {
                id: "table-2".into(),
                filter: None,
                manual: true,
            },
        );
        run(
            &mut p,
            Command::SetSort {
                id: "table-2".into(),
                keys: vec![],
            },
        );
        assert!(p.snapshot().tables[1].stale);
        assert_eq!(p.snapshot().tables[1].rows, sorted);
        run(
            &mut p,
            Command::Run {
                id: "table-2".into(),
            },
        );
        assert_eq!(p.snapshot().tables[2].rows, original);
        run(&mut p, Command::Undo);
        assert_eq!(p.snapshot().tables[1].rows, sorted);
        run(
            &mut p,
            Command::SetSort {
                id: "table-2".into(),
                keys: vec![SortKey {
                    column: 49,
                    direction: Direction::Asc,
                    mode: Mode::Text,
                }],
            },
        );
        run(
            &mut p,
            Command::Run {
                id: "table-2".into(),
            },
        );
        assert!(p.snapshot().tables[1].error.is_some());
        assert_eq!(p.snapshot().tables[1].rows, sorted);
    }
}
