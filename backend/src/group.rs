//! 文字列の複合キーでグループ化し、初出順で集計結果を返す。
use crate::domain::Table;
use crate::group_stats::{Metric, Statistic};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupConfig {
    pub group_by: Vec<usize>,
    pub sums: Vec<usize>,
    #[serde(default)]
    pub averages: Vec<usize>,
    #[serde(default)]
    pub minima: Vec<usize>,
    #[serde(default)]
    pub maxima: Vec<usize>,
    pub count: bool,
}
impl Default for GroupConfig {
    fn default() -> Self {
        Self {
            group_by: vec![],
            sums: vec![],
            averages: vec![],
            minima: vec![],
            maxima: vec![],
            count: true,
        }
    }
}
pub fn validate(config: &GroupConfig) -> Result<(), String> {
    let unique = |v: &[usize]| {
        v.iter().all(|c| *c < crate::storage::MAX_COLS)
            && v.iter().collect::<HashSet<_>>().len() == v.len()
    };
    let fields = [
        &config.sums,
        &config.averages,
        &config.minima,
        &config.maxima,
    ];
    let metric_count: usize = fields.iter().map(|v| v.len()).sum();
    if !unique(&config.group_by)
        || fields.iter().any(|v| !unique(v))
        || config.group_by.len() + metric_count + usize::from(config.count)
            > crate::storage::MAX_COLS
        || (metric_count == 0 && !config.count)
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
    let metrics: Vec<(usize, Metric)> = [
        (&config.sums, Metric::Sum),
        (&config.averages, Metric::Average),
        (&config.minima, Metric::Min),
        (&config.maxima, Metric::Max),
    ]
    .into_iter()
    .flat_map(|(columns, kind)| columns.iter().map(move |c| (*c, kind)))
    .collect();
    if config
        .group_by
        .iter()
        .chain(metrics.iter().map(|(c, _)| c))
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
    for (c, kind) in &metrics {
        add_name(format!("{}（{}）", kind.label(), source.columns[*c]));
    }
    if config.count {
        add_name("件数".into());
    }
    let mut indices = HashMap::<Vec<String>, usize>::new();
    let mut groups = Vec::<(Vec<String>, Vec<Statistic>, usize)>::new();
    if config.group_by.is_empty() {
        indices.insert(vec![], 0);
        groups.push((vec![], vec![Statistic::default(); metrics.len()], 0));
    }
    for row in &source.rows {
        let key: Vec<_> = config.group_by.iter().map(|c| row[*c].clone()).collect();
        let next = groups.len();
        let i = *indices.entry(key.clone()).or_insert_with(|| {
            groups.push((key, vec![Statistic::default(); metrics.len()], 0));
            next
        });
        let (_, sums, count) = &mut groups[i];
        *count += 1;
        for (i, (c, kind)) in metrics.iter().enumerate() {
            if let Some(value) = row[*c].trim().parse::<f64>().ok().filter(|v| v.is_finite()) {
                sums[i].add(value, *kind)?;
            }
        }
    }
    let rows = groups
        .into_iter()
        .map(|(mut key, sums, count)| {
            key.extend(
                sums.into_iter()
                    .zip(&metrics)
                    .map(|(stat, (_, kind))| stat.text(*kind)),
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
            ..Default::default()
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
                    count: true,
                    ..Default::default()
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
                count: true,
                ..Default::default()
            })
            .is_err()
        );
        assert!(
            validate(&GroupConfig {
                group_by: vec![],
                sums: vec![],
                count: false,
                ..Default::default()
            })
            .is_err()
        );
    }
    #[test]
    fn grouped_statistics_ignore_invalid_cells_and_empty_groups_are_blank() {
        let mut t = crate::domain::sample_table("t".into(), 0);
        t.columns = vec!["分類".into(), "値".into()];
        t.rows = vec![
            vec!["A", "2"],
            vec!["A", "4"],
            vec!["A", "文字"],
            vec!["A", ""],
            vec!["B", "NaN"],
            vec!["B", "inf"],
        ]
        .into_iter()
        .map(|r| r.into_iter().map(String::from).collect())
        .collect();
        let config = GroupConfig {
            group_by: vec![0],
            sums: vec![1],
            averages: vec![1],
            minima: vec![1],
            maxima: vec![1],
            count: true,
        };
        let (cols, rows) = evaluate(&t, &config).unwrap();
        assert_eq!(
            cols,
            [
                "分類",
                "合計（値）",
                "平均（値）",
                "最小値（値）",
                "最大値（値）",
                "件数"
            ]
        );
        assert_eq!(
            rows,
            vec![
                vec!["A", "6", "3", "2", "4", "4"],
                vec!["B", "0", "", "", "", "2"]
            ]
        );
        t.rows.clear();
        let mut all = config.clone();
        all.group_by.clear();
        assert_eq!(
            evaluate(&t, &all).unwrap().1,
            vec![vec!["0", "", "", "", "0"]]
        );
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
            Command::SetGroup {
                id: "table-2".into(),
                config: config.clone(),
            },
        );
        let restored =
            storage::decode(serde_json::from_slice(&p.export().unwrap()).unwrap()).unwrap();
        assert_eq!(restored[1].group, Some(config));
        assert_eq!(restored[1].rows, p.snapshot().tables[1].rows);
        let mut only_mean = GroupConfig {
            averages: vec![1],
            count: false,
            ..Default::default()
        };
        assert!(validate(&only_mean).is_ok());
        only_mean.averages = vec![1, 1];
        assert!(validate(&only_mean).is_err());
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
            ..Default::default()
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
                    ..Default::default()
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
