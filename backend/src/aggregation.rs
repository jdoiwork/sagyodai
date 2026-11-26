//! 表示中の行（結果表ではキャッシュ）だけを集計し、データ行には混ぜない。
use crate::domain::Table;
use crate::number_text::parse_finite_number;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// SUM の有効・無効は bool、追加の集計方法は名前で指定する。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FooterAggregation {
    Enabled(bool),
    Function(FooterFunction),
}
impl Default for FooterAggregation {
    fn default() -> Self {
        Self::Enabled(false)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FooterFunction {
    Mode,
}

fn mode(table: &Table, col: usize) -> Option<String> {
    let mut counts = HashMap::<&str, usize>::new();
    for value in table.rows.iter().filter_map(|row| row.get(col)) {
        if !value.trim().is_empty() {
            *counts.entry(value).or_default() += 1;
        }
    }
    let highest = counts.values().copied().max()?;
    // 同率の値は元の行順で決め、ハッシュの走査順には依存させない。
    table
        .rows
        .iter()
        .filter_map(|row| row.get(col))
        .find(|value| counts.get(value.as_str()) == Some(&highest))
        .cloned()
}

pub fn totals(table: &Table) -> Vec<Option<String>> {
    let Some(footer) = &table.footer else {
        return vec![];
    };
    table
        .columns
        .iter()
        .enumerate()
        .map(|(col, _)| {
            if table.column_schema.get(col).is_some_and(|c| {
                c.config.data_type != crate::column_types::DataType::String || c.config.nullable
            }) {
                return typed_total(table, col, footer.get(col).copied().unwrap_or_default());
            }
            match footer.get(col).copied().unwrap_or_default() {
                FooterAggregation::Enabled(false) => return None,
                FooterAggregation::Function(FooterFunction::Mode) => return mode(table, col),
                FooterAggregation::Enabled(true) => {}
            }
            let sum = table
                .rows
                .iter()
                .filter_map(|row| row.get(col))
                .filter_map(|cell| parse_finite_number(cell))
                .sum::<f64>();
            Some(if sum == 0.0 {
                "0".into()
            } else if sum.is_finite() {
                sum.to_string()
            } else {
                "集計範囲超過".into()
            })
        })
        .collect()
}

fn typed_total(table: &Table, col: usize, kind: FooterAggregation) -> Option<String> {
    use crate::column_types::Value;
    if matches!(kind, FooterAggregation::Enabled(false)) {
        return None;
    }
    if table.kind == crate::domain::Kind::Input && !table.cell_errors.is_empty() {
        return Some("型エラー".into());
    }
    let data = table.output.as_ref()?;
    let values: Vec<_> = data
        .rows
        .iter()
        .filter_map(|r| r.get(col))
        .filter(|v| **v != Value::Null)
        .collect();
    if matches!(kind, FooterAggregation::Function(FooterFunction::Mode)) {
        let mut best = None;
        let mut max = 0;
        for v in &values {
            let n = values.iter().filter(|x| *x == v).count();
            if n > max {
                max = n;
                best = Some(v.text());
            }
        }
        return best;
    }
    if data.columns.get(col)?.config.data_type != crate::column_types::DataType::Integer {
        return Some("整数列を指定".into());
    }
    let total: i128 = values
        .iter()
        .filter_map(|v| match v {
            Value::Integer(n) => Some(*n as i128),
            _ => None,
        })
        .sum();
    Some(
        i64::try_from(total)
            .map(|n| n.to_string())
            .unwrap_or_else(|_| "集計範囲超過".into()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::sample_table;
    #[test]
    fn mode_counts_exact_text_ignores_blanks_and_resolves_ties_by_row_order() {
        let mut table = sample_table("test".into(), 0);
        table.footer = Some(vec![FooterAggregation::Function(FooterFunction::Mode)]);
        for (values, expected) in [
            (vec!["", "  ", "\t"], None),
            (vec!["赤", "青", "青", "赤"], Some("赤")),
            (vec!["赤", "青", "青"], Some("青")),
            (vec!["01", "1", "1.0", "01"], Some("01")),
            (vec!["a", "A", " a ", "A"], Some("A")),
            (vec![], None),
        ] {
            table.rows = values.into_iter().map(|v| vec![v.into()]).collect();
            assert_eq!(totals(&table)[0].as_deref(), expected);
        }
    }
    #[test]
    fn sums_only_finite_numeric_cells_and_handles_empty_and_overflow() {
        let mut table = sample_table("test".into(), 0);
        table.footer = Some(
            vec![true, false, false, false]
                .into_iter()
                .map(FooterAggregation::Enabled)
                .collect(),
        );
        table.rows = [" 1.5 ", "-2", "3e2", "", "文字", "NaN", "inf"]
            .iter()
            .map(|v| vec![v.to_string(); 4])
            .collect();
        assert_eq!(totals(&table)[0].as_deref(), Some("299.5"));
        assert_eq!(totals(&table)[1], None);
        table.rows.clear();
        assert_eq!(totals(&table)[0].as_deref(), Some("0"));
        table.rows = vec![vec!["1e308".into(); 4]; 2];
        assert_eq!(totals(&table)[0].as_deref(), Some("集計範囲超過"));
    }
}
