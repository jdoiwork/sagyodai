//! 表を入出力とする小規模な非循環グラフ。評価は操作と同じトランザクションで完了する。
use crate::domain::{Filter, Kind, Operator, Table};
use std::collections::HashSet;

pub fn order(tables: &[Table]) -> Result<Vec<usize>, String> {
    let mut done = HashSet::new();
    let mut result = vec![];
    for t in tables {
        if t.kind == Kind::Input && (t.source.is_some() || t.filter.is_some() || t.manual) {
            return Err("手入力の表には入力接続や加工設定を指定できません。".into());
        }
        if (t.kind == Kind::Filter) != t.filter.is_some() {
            return Err("フィルタ設定とノードの種類が一致しません。".into());
        }
        if let Some(source) = &t.source {
            let source = tables
                .iter()
                .find(|n| &n.id == source)
                .ok_or("接続元が見つかりません。")?;
            if source.kind == Kind::Display {
                return Err("結果表は出力に接続できません。".into());
            }
        }
        if let Some(f) = &t.filter
            && (f.column >= crate::storage::MAX_COLS
                || f.value.len() > crate::storage::MAX_CELL_BYTES)
        {
            return Err("フィルタ条件が上限を超えています。".into());
        }
    }
    while result.len() < tables.len() {
        let before = result.len();
        for (i, t) in tables.iter().enumerate() {
            if !done.contains(&t.id) && t.source.as_ref().is_none_or(|s| done.contains(s)) {
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
        Operator::Greater | Operator::Less | Operator::AtLeast | Operator::AtMost
    );
    let threshold = if numeric {
        Some(number(&filter.value).ok_or("比較値に有限の数値を入力してください。")?)
    } else {
        None
    };
    Ok(source
        .rows
        .iter()
        .filter(|row| {
            let value = &row[filter.column];
            match filter.operator {
                Operator::Equals => value == &filter.value,
                Operator::NotEquals => value != &filter.value,
                Operator::Contains => value.contains(&filter.value),
                op => number(value).zip(threshold).is_some_and(|(a, b)| match op {
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
        if tables[i].kind == Kind::Input {
            continue;
        }
        let old = previous.iter().find(|n| n.id == tables[i].id);
        let source = tables[i]
            .source
            .as_ref()
            .and_then(|id| tables.iter().find(|n| &n.id == id))
            .cloned();
        let old_source = old
            .and_then(|n| n.source.as_ref())
            .and_then(|id| previous.iter().find(|n| &n.id == id));
        let changed = old
            .is_none_or(|n| n.source != tables[i].source || n.filter != tables[i].filter)
            || match (&source, old_source) {
                (Some(a), Some(b)) => {
                    a.rows != b.rows
                        || a.columns != b.columns
                        || a.stale != b.stale
                        || a.error != b.error
                }
                (None, None) => false,
                _ => true,
            };
        let node = &mut tables[i];
        if node.manual && run != Some(node.id.as_str()) {
            node.stale |= changed;
            continue;
        }
        let result = match source {
            None => Err("入力が未接続です。".to_string()),
            Some(s) if s.stale || s.error.is_some() => {
                Err("入力が更新待ちです。上流ノードを確認してください。".to_string())
            }
            Some(s) => {
                let rows = match &node.filter {
                    Some(f) => filter_rows(&s, f),
                    None => Ok(s.rows.clone()),
                };
                rows.map(|rows| (s.columns, rows))
            }
        };
        match result {
            Ok((columns, rows)) => {
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
