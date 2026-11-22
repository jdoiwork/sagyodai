//! 文字列の複合キーでグループ化し、初出順で集計結果を返す。
use crate::domain::Table;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupConfig {
    pub group_by: Vec<usize>,
    pub sums: Vec<usize>,
    pub count: bool,
}
impl Default for GroupConfig {
    fn default() -> Self {
        Self {
            group_by: vec![],
            sums: vec![],
            count: true,
        }
    }
}
pub fn validate(config: &GroupConfig) -> Result<(), String> {
    let unique = |v: &[usize]| {
        v.iter().all(|c| *c < crate::storage::MAX_COLS)
            && v.iter().collect::<HashSet<_>>().len() == v.len()
    };
    if !unique(&config.group_by)
        || !unique(&config.sums)
        || config.group_by.len() + config.sums.len() + usize::from(config.count)
            > crate::storage::MAX_COLS
        || (config.sums.is_empty() && !config.count)
    {
        return Err(
            "集計項目を1つ以上指定し、同じ種類の列を重複させず、出力を50列以内にしてください。"
                .into(),
        );
    }
    Ok(())
}
pub fn evaluate(
    source: &Table,
    config: &GroupConfig,
) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    validate(config)?;
    if config
        .group_by
        .iter()
        .chain(&config.sums)
        .any(|c| *c >= source.columns.len())
    {
        return Err("集計対象の列が入力にありません。".into());
    }
    let mut columns = vec![];
    let mut names = HashSet::new();
    let mut add_name = |name: String| {
        let base: String = name.chars().take(240).collect();
        let mut name = base.clone();
        let mut n = 2;
        while !names.insert(name.clone()) {
            name = format!("{base} ({n})");
            n += 1;
        }
        columns.push(name);
    };
    for c in &config.group_by {
        add_name(source.columns[*c].clone());
    }
    for c in &config.sums {
        add_name(format!("合計（{}）", source.columns[*c]));
    }
    if config.count {
        add_name("件数".into());
    }
    let mut indices = HashMap::<Vec<String>, usize>::new();
    let mut groups = Vec::<(Vec<String>, Vec<f64>, usize)>::new();
    if config.group_by.is_empty() {
        indices.insert(vec![], 0);
        groups.push((vec![], vec![0.0; config.sums.len()], 0));
    }
    for row in &source.rows {
        let key: Vec<_> = config.group_by.iter().map(|c| row[*c].clone()).collect();
        let next = groups.len();
        let i = *indices.entry(key.clone()).or_insert_with(|| {
            groups.push((key, vec![0.0; config.sums.len()], 0));
            next
        });
        let (_, sums, count) = &mut groups[i];
        *count += 1;
        for (i, c) in config.sums.iter().enumerate() {
            if let Some(value) = row[*c].trim().parse::<f64>().ok().filter(|v| v.is_finite()) {
                sums[i] += value;
                if !sums[i].is_finite() {
                    return Err("合計が数値の範囲を超えました。".into());
                }
            }
        }
    }
    let rows = groups
        .into_iter()
        .map(|(mut key, sums, count)| {
            key.extend(
                sums.into_iter()
                    .map(|v| if v == 0.0 { "0".into() } else { v.to_string() }),
            );
            if config.count {
                key.push(count.to_string());
            }
            key
        })
        .collect();
    Ok((columns, rows))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        application::Project,
        domain::{Command, Kind, Request},
        storage,
    };
    #[test]
    fn composite_keys_exact_strings_sums_counts_empty_and_overflow() {
        let mut t = crate::domain::sample_table("t".into(), 0);
        t.columns = vec!["分類".into(), "地域".into(), "数量".into(), "金額".into()];
        t.rows = vec![
            vec!["A", "東", "2", "3.5"],
            vec!["A", "西", "5", "10"],
            vec!["A", "東", "-1", "文字"],
            vec!["", "東", "", "NaN"],
            vec!["A ", "東", "7", "2"],
        ]
        .into_iter()
        .map(|r| r.into_iter().map(String::from).collect())
        .collect();
        let config = GroupConfig {
            group_by: vec![0, 1],
            sums: vec![2, 3],
            count: true,
        };
        let (columns, rows) = evaluate(&t, &config).unwrap();
        assert_eq!(
            columns,
            ["分類", "地域", "合計（数量）", "合計（金額）", "件数"]
        );
        assert_eq!(rows[0], ["A", "東", "1", "3.5", "2"]);
        assert_eq!(rows[1], ["A", "西", "5", "10", "1"]);
        assert_eq!(rows[2], ["", "東", "0", "0", "1"]);
        assert_eq!(rows.len(), 4);
        t.rows.clear();
        assert!(evaluate(&t, &config).unwrap().1.is_empty());
        assert_eq!(
            evaluate(
                &t,
                &GroupConfig {
                    group_by: vec![],
                    sums: vec![2],
                    count: true
                }
            )
            .unwrap()
            .1,
            vec![vec!["0", "0"]]
        );
        t.rows = vec![vec!["A".into(), "東".into(), "1e308".into(), "".into()]; 2];
        assert!(evaluate(&t, &config).is_err());
        assert!(
            validate(&GroupConfig {
                group_by: vec![0, 0],
                sums: vec![],
                count: true
            })
            .is_err()
        );
        assert!(
            validate(&GroupConfig {
                group_by: vec![],
                sums: vec![],
                count: false
            })
            .is_err()
        );
    }
    fn run(p: &mut Project, c: Command) {
        p.apply(Request {
            expected_revision: p.snapshot().revision,
            command: c,
        })
        .unwrap();
    }
    #[test]
    fn pipeline_persistence_manual_cache_undo_and_failed_execution() {
        let mut p = Project::default();
        run(
            &mut p,
            Command::AddNode {
                kind: Kind::Aggregate,
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
        let config = GroupConfig {
            group_by: vec![2],
            sums: vec![1],
            count: true,
        };
        run(
            &mut p,
            Command::SetGroup {
                id: "table-2".into(),
                config: config.clone(),
            },
        );
        let rows = p.snapshot().tables[1].rows.clone();
        assert_eq!(rows[0], ["文房具", "15", "2"]);
        assert_eq!(p.snapshot().tables[2].rows, rows);
        let restored =
            storage::decode(serde_json::from_slice(&p.export().unwrap()).unwrap()).unwrap();
        assert_eq!(restored[1].group, Some(config));
        assert_eq!(restored[2].rows, rows);
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
            Command::SetGroup {
                id: "table-2".into(),
                config: GroupConfig::default(),
            },
        );
        assert!(p.snapshot().tables[1].stale);
        assert_eq!(p.snapshot().tables[1].rows, rows);
        run(
            &mut p,
            Command::Run {
                id: "table-2".into(),
            },
        );
        assert_eq!(p.snapshot().tables[2].rows, vec![vec!["6"]]);
        run(&mut p, Command::Undo);
        assert_eq!(p.snapshot().tables[1].rows, rows);
        run(
            &mut p,
            Command::SetGroup {
                id: "table-2".into(),
                config: GroupConfig {
                    group_by: vec![49],
                    sums: vec![],
                    count: true,
                },
            },
        );
        run(
            &mut p,
            Command::Run {
                id: "table-2".into(),
            },
        );
        assert!(p.snapshot().tables[1].error.is_some());
        assert_eq!(p.snapshot().tables[1].rows, rows);
    }
}
