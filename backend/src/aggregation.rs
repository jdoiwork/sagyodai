//! 表示中の行（結果表ではキャッシュ）だけを集計し、データ行には混ぜない。
use crate::domain::Table;

pub fn totals(table: &Table) -> Vec<Option<String>> {
    let Some(footer) = &table.footer else {
        return vec![];
    };
    table
        .columns
        .iter()
        .enumerate()
        .map(|(col, _)| {
            if !footer.get(col).copied().unwrap_or(false) {
                return None;
            }
            let sum = table
                .rows
                .iter()
                .filter_map(|row| row.get(col))
                .filter_map(|cell| cell.trim().parse::<f64>().ok())
                .filter(|value| value.is_finite())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::sample_table;
    #[test]
    fn sums_only_finite_numeric_cells_and_handles_empty_and_overflow() {
        let mut table = sample_table("test".into(), 0);
        table.footer = Some(vec![true, false, false, false]);
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
