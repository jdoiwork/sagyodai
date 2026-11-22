//! 表を入出力とする小規模な非循環グラフ。評価は操作と同じトランザクションで完了する。
use crate::domain::{Filter, Kind, Operator, Table};
use std::collections::HashSet;

pub fn order(tables: &[Table]) -> Result<Vec<usize>, String> {
    let mut done = HashSet::new();
    let mut result = vec![];
    for t in tables {
        crate::csv_source::validate(t)?;
        if let Some(config) = &t.projection {
            if t.kind != Kind::Display {
                return Err("出力列設定は結果表にのみ指定できます。".into());
            }
            config.validate()?;
        }
        if (t.kind == Kind::Aggregate) != t.group.is_some() {
            return Err("集計設定とノードの種類が一致しません。".into());
        }
        if let Some(config) = &t.group {
            crate::group::validate(config)?;
        }

        crate::sort::validate(&t.sort_keys)?;
        if t.kind != Kind::Sort && !t.sort_keys.is_empty() {
            return Err("ソート設定とノードの種類が一致しません。".into());
        }

        if matches!(t.kind, Kind::Input | Kind::Csv)
            && (t.source.is_some() || t.filter.is_some() || t.manual)
        {
            return Err("入力ソースには入力接続や加工設定を指定できません。".into());
        }
        if (t.kind == Kind::Filter) != t.filter.is_some() {
            return Err("フィルタ設定とノードの種類が一致しません。".into());
        }
        if t.kind == Kind::Union {
            if t.source.is_some()
                || t.union_inputs.len() > 19
                || t.union_inputs
                    .iter()
                    .map(|i| &i.source)
                    .collect::<HashSet<_>>()
                    .len()
                    != t.union_inputs.len()
            {
                return Err("結合の入力は重複なしで19個まで指定してください。".into());
            }
        } else if !t.union_inputs.is_empty() || t.union_distinct {
            return Err("結合設定とノードの種類が一致しません。".into());
        }
        for source in t.sources() {
            tables
                .iter()
                .find(|n| &n.id == source)
                .ok_or("接続元が見つかりません。")?;
        }
        if let Some(f) = &t.filter
            && (f.column >= crate::storage::MAX_COLS
                || f.value.len() > crate::storage::MAX_CELL_BYTES
                || f.values.len() > crate::storage::MAX_ROWS
                || f.values
                    .iter()
                    .any(|v| v.len() > crate::storage::MAX_CELL_BYTES))
        {
            return Err("フィルタ条件が上限を超えています。".into());
        }
    }
    while result.len() < tables.len() {
        let before = result.len();
        for (i, t) in tables.iter().enumerate() {
            if !done.contains(&t.id) && t.sources().iter().all(|s| done.contains(*s)) {
                done.insert(t.id.clone());
                result.push(i);
            }
        }
        if before == result.len() {
            return Err("循環する接続は作れません。".into());
        }
    }
    Ok(result)
}

fn number(value: &str) -> Option<f64> {
    value.trim().parse::<f64>().ok().filter(|n| n.is_finite())
}
fn filter_rows(source: &Table, filter: &Filter) -> Result<Vec<Vec<String>>, String> {
    if filter.column >= source.columns.len() {
        return Err("指定した列が入力にありません。".into());
    }
    let numeric = matches!(
        filter.operator,
        Operator::Greater
            | Operator::Less
            | Operator::AtLeast
            | Operator::AtMost
            | Operator::NumberEquals
            | Operator::NumberNotEquals
    );
    let threshold = if numeric {
        Some(number(&filter.value).ok_or("比較値に有限の数値を入力してください。")?)
    } else {
        None
    };
    let selected: std::collections::HashSet<&str> =
        filter.values.iter().map(String::as_str).collect();
    Ok(source
        .rows
        .iter()
        .filter(|row| {
            let value = &row[filter.column];
            match filter.operator {
                Operator::In => selected.contains(value.as_str()),
                Operator::NotIn => !selected.contains(value.as_str()),
                Operator::Equals => value == &filter.value,
                Operator::NotEquals => value != &filter.value,
                Operator::Contains => value.contains(&filter.value),
                op => number(value).zip(threshold).is_some_and(|(a, b)| match op {
                    Operator::NumberEquals => a == b,
                    Operator::NumberNotEquals => a != b,
                    Operator::Greater => a > b,
                    Operator::Less => a < b,
                    Operator::AtLeast => a >= b,
                    Operator::AtMost => a <= b,
                    _ => false,
                }),
            }
        })
        .cloned()
        .collect())
}

pub fn evaluate(tables: &mut [Table], previous: &[Table], run: Option<&str>) -> Result<(), String> {
    for i in order(tables)? {
        if matches!(tables[i].kind, Kind::Input | Kind::Csv) {
            continue;
        }
        let old = previous.iter().find(|n| n.id == tables[i].id);
        let inputs: Vec<Table> = tables[i]
            .sources()
            .iter()
            .filter_map(|id| tables.iter().find(|t| &t.id == *id).cloned())
            .collect();
        let changed = old.is_none_or(|n| {
            n.sources() != tables[i].sources()
                || n.filter != tables[i].filter
                || n.sort_keys != tables[i].sort_keys
                || n.group != tables[i].group
                || n.projection != tables[i].projection
                || n.union_distinct != tables[i].union_distinct
        }) || inputs.iter().any(|current| {
            previous
                .iter()
                .find(|t| t.id == current.id)
                .is_none_or(|old| {
                    current.rows != old.rows
                        || current.columns != old.columns
                        || current.stale != old.stale
                        || current.error != old.error
                })
        });
        let node = &mut tables[i];
        if node.manual && run != Some(node.id.as_str()) {
            node.stale |= changed;
            continue;
        }
        let result = if node.kind == Kind::Union {
            crate::union::merge(&inputs, node.union_distinct)
        } else {
            match inputs.into_iter().next() {
                None => Err("入力が未接続です。".to_string()),
                Some(s) if s.stale || s.error.is_some() => {
                    Err("入力が更新待ちです。上流ノードを確認してください。".to_string())
                }
                Some(s) if node.kind == Kind::Display && node.projection.is_some() => node
                    .projection
                    .as_ref()
                    .ok_or_else(|| "出力列設定がありません。".into())
                    .and_then(|config| config.evaluate(&s)),
                Some(s) if node.kind == Kind::Aggregate => node
                    .group
                    .as_ref()
                    .ok_or_else(|| "集計設定がありません。".to_string())
                    .and_then(|config| crate::group::evaluate(&s, config)),
                Some(s) => {
                    let rows = if node.kind == Kind::Sort {
                        crate::sort::rows(&s, &node.sort_keys)
                    } else {
                        match &node.filter {
                            Some(f) => filter_rows(&s, f),
                            None => Ok(s.rows.clone()),
                        }
                    };
                    rows.map(|rows| (s.columns, rows))
                }
            }
        };
        match result {
            Ok((columns, rows)) => {
                node.column_widths.truncate(columns.len());
                if let Some(footer) = &mut node.footer {
                    footer.resize(columns.len(), false);
                }
                node.columns = columns;
                node.rows = rows;
                node.stale = false;
                node.error = None;
            }
            Err(message) => {
                node.stale = true;
                node.error = Some(message);
            }
        }
    }
    Ok(())
}
