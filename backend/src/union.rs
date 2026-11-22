//! 入力順を保ち、UNIONでは最初に現れた行を残す。
use crate::{domain::Table, storage::MAX_ROWS};
use std::collections::HashSet;

pub fn merge(inputs: &[Table], distinct: bool) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let first = inputs.first().ok_or("入力が未接続です。")?;
    let mut seen = HashSet::new();
    let mut rows = vec![];
    for input in inputs {
        if input.stale || input.error.is_some() {
            return Err(format!("「{}」が更新待ちまたはエラーです。", input.title));
        }
        if input.columns != first.columns {
            return Err(format!(
                "「{}」の列名・列数・並びが最初の入力と一致しません。",
                input.title
            ));
        }
        for row in &input.rows {
            if !distinct || seen.insert(row) {
                if rows.len() == MAX_ROWS {
                    return Err("結合結果が5000行の上限を超えます。".into());
                }
                rows.push(row.clone());
            }
        }
    }
    Ok((first.columns.clone(), rows))
}
