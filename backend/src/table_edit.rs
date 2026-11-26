//! 添字で行列を指定する間は、表示時の原本を照合して別タブの変更を保護する。
use crate::domain::{Kind, Table};
use crate::storage::{MAX_CELL_BYTES, MAX_COLS, MAX_ROWS};

fn input_index(tables: &[Table], id: &str) -> Result<usize, String> {
    let i = tables
        .iter()
        .position(|t| t.id == id)
        .ok_or("対象の表が見つかりません。")?;
    if tables[i].kind != Kind::Input {
        return Err("加工結果は読み取り専用です。".into());
    }
    Ok(i)
}

pub fn remove_row(
    tables: &mut [Table],
    id: &str,
    row: usize,
    expected: &[Vec<String>],
) -> Result<(), String> {
    let t = &mut tables[input_index(tables, id)?];
    if t.rows != expected {
        return Err(
            "表の内容が変更されています。表示を確認して行削除をやり直してください。".into(),
        );
    }
    if t.rows.len() <= 1 || row >= t.rows.len() {
        return Err("最後の1行または存在しない行は削除できません。".into());
    }
    t.rows.remove(row);
    Ok(())
}

pub fn rename_column(
    tables: &mut [Table],
    id: &str,
    col: usize,
    name: String,
    expected: &[String],
) -> Result<(), String> {
    if tables.iter().any(|t| t.id == id && t.kind == Kind::Display) {
        return crate::projection::rename_column(tables, id, col, name, expected);
    }
    let t = &mut tables[input_index(tables, id)?];
    if t.columns != expected || col >= t.columns.len() {
        return Err(
            "列の構成が変更されています。表示を確認して列名の編集をやり直してください。".into(),
        );
    }
    if name.trim().is_empty() || name.len() > 1024 {
        return Err("列名は空欄にせず、1024バイト以内で入力してください。".into());
    }
    t.columns[col] = name;
    Ok(())
}

pub fn remove_column(
    tables: &mut [Table],
    id: &str,
    col: usize,
    columns: &[String],
    rows: &[Vec<String>],
) -> Result<(), String> {
    let i = input_index(tables, id)?;
    if tables[i].columns != columns || tables[i].rows != rows {
        return Err(
            "表の内容が変更されています。表示を確認して列削除をやり直してください。".into(),
        );
    }
    if columns.len() <= 1 || col >= columns.len() {
        return Err("最後の1列または存在しない列は削除できません。".into());
    }
    let mut affected = vec![id.to_string()];
    for n in crate::graph::order(tables)? {
        if (matches!(tables[n].kind, Kind::Aggregate | Kind::Script)
            || tables[n].projection.is_some())
            && tables[n]
                .source
                .as_ref()
                .is_some_and(|s| affected.contains(s))
        {
            return Err("列構成を変更するノードへ接続中の列挿入・削除・並べ替えはできません。対象ノードの入力接続を外してから列構成を変更してください。".into());
        }
        if tables[n].kind == Kind::Union
            && tables[n]
                .union_inputs
                .iter()
                .any(|input| affected.contains(&input.source))
        {
            return Err("結合ノードへ接続中の列挿入・削除・並べ替えはできません。結合の入力接続を外してから列構成を変更してください。".into());
        }
        if tables[n]
            .source
            .as_ref()
            .is_some_and(|s| affected.contains(s))
        {
            // 手動キャッシュの列構成が旧状態のまま残る間は添字を変更できない。
            if tables[n].stale || tables[n].error.is_some() {
                return Err(
                    "接続先に更新待ちまたはエラーがあります。解消してから列を削除してください。"
                        .into(),
                );
            }
            if tables[n].manual {
                return Err("接続先に手動更新のノードがあります。自動更新に切り替えてから列を削除してください。".into());
            }
            if tables[n].filter.as_ref().is_some_and(|f| f.column == col)
                || tables[n].sort_keys.iter().any(|k| k.column == col)
            {
                return Err(format!(
                    "「{}」がこの列を参照しています。フィルタ・ソートの対象列を変更するか接続を外してください。",
                    tables[n].title
                ));
            }
            affected.push(tables[n].id.clone());
        }
    }
    for t in tables.iter_mut().filter(|t| affected.contains(&t.id)) {
        if t.id == id
            && let Some(footer) = &mut t.footer
            && col < footer.len()
        {
            footer.remove(col);
        }
        if t.id == id && col < t.column_widths.len() {
            t.column_widths.remove(col);
        }
        if let Some(f) = &mut t.filter
            && f.column > col
        {
            f.column -= 1;
        }
        for key in &mut t.sort_keys {
            if key.column > col {
                key.column -= 1;
            }
        }
    }
    tables[i].column_schema.remove(col);
    tables[i].columns.remove(col);
    for row in &mut tables[i].rows {
        row.remove(col);
    }
    Ok(())
}

pub fn move_column(
    tables: &mut [Table],
    id: &str,
    from: usize,
    to: usize,
    columns: &[String],
    rows: &[Vec<String>],
) -> Result<(), String> {
    move_columns(tables, id, &[from], to, columns, rows)
}

pub fn move_columns(
    tables: &mut [Table],
    id: &str,
    indices: &[usize],
    to: usize,
    columns: &[String],
    rows: &[Vec<String>],
) -> Result<(), String> {
    if tables.iter().any(|t| t.id == id && t.kind == Kind::Display) {
        return crate::projection::move_columns(tables, id, indices, to, columns, rows);
    }
    let i = input_index(tables, id)?;
    if tables[i].columns != columns || tables[i].rows != rows {
        return Err(
            "表の内容が変更されています。表示を確認して列を並べ替え直してください。".into(),
        );
    }
    let mut selected = indices.to_vec();
    selected.sort_unstable();
    selected.dedup();
    if selected.is_empty()
        || selected.len() != indices.len()
        || selected.iter().any(|n| *n >= columns.len())
        || to > columns.len() - selected.len()
    {
        return Err("移動する列または移動先が不正です。".into());
    }
    // to は選択列を取り除いた後の挿入位置。離れた列も元の順序でまとめる。
    let mut order: Vec<usize> = (0..columns.len())
        .filter(|n| !selected.contains(n))
        .collect();
    order.splice(to..to, selected);
    if order.iter().copied().eq(0..columns.len()) {
        return Ok(());
    }
    let mut affected = vec![id.to_string()];
    for n in crate::graph::order(tables)? {
        if tables[n]
            .source
            .as_ref()
            .is_some_and(|s| affected.contains(s))
            && !matches!(tables[n].kind, Kind::Aggregate | Kind::Script)
            && tables[n].projection.is_none()
        {
            affected.push(tables[n].id.clone());
        }
    }
    let mut new_index = vec![0; columns.len()];
    for (new, old) in order.iter().enumerate() {
        new_index[*old] = new;
    }
    for t in tables.iter_mut().filter(|t| affected.contains(&t.id)) {
        if t.id == id
            && let Some(footer) = &mut t.footer
        {
            *footer = order
                .iter()
                .map(|old| footer.get(*old).copied().unwrap_or_default())
                .collect();
        }
        if t.id == id {
            t.column_widths = order
                .iter()
                .map(|old| t.column_widths.get(*old).copied().unwrap_or(160.0))
                .collect();
        }
        if let Some(f) = &mut t.filter
            && let Some(i) = new_index.get(f.column)
        {
            f.column = *i;
        }
        for key in &mut t.sort_keys {
            if let Some(i) = new_index.get(key.column) {
                key.column = *i;
            }
        }
    }
    tables[i].column_schema = order
        .iter()
        .map(|old| tables[i].column_schema[*old].clone())
        .collect();
    tables[i].columns = order.iter().map(|old| columns[*old].clone()).collect();
    tables[i].rows = rows
        .iter()
        .map(|row| order.iter().map(|old| row[*old].clone()).collect())
        .collect();
    Ok(())
}

// 一括操作は application の作業コピー上で実行し、途中の失敗も全体を破棄する。
pub fn remove_selection(
    tables: &mut [Table],
    id: &str,
    indices: &[usize],
    columns: Option<&[String]>,
    rows: &[Vec<String>],
) -> Result<(), String> {
    let i = input_index(tables, id)?;
    if tables[i].rows != rows || columns.is_some_and(|c| tables[i].columns != c) {
        return Err("表の内容が変更されています。選択し直してください。".into());
    }
    let mut sorted = indices.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    let len = if columns.is_some() {
        tables[i].columns.len()
    } else {
        tables[i].rows.len()
    };
    if sorted.is_empty()
        || sorted.len() != indices.len()
        || sorted.len() >= len
        || sorted.iter().any(|n| *n >= len)
    {
        return Err("削除対象が不正です。行と列は少なくとも1つ残してください。".into());
    }
    for index in sorted.into_iter().rev() {
        let current = tables[i].clone();
        if columns.is_some() {
            remove_column(tables, id, index, &current.columns, &current.rows)?;
        } else {
            remove_row(tables, id, index, &current.rows)?;
        }
    }
    Ok(())
}

pub fn move_rows(
    tables: &mut [Table],
    id: &str,
    indices: &[usize],
    to: usize,
    columns: &[String],
    rows: &[Vec<String>],
) -> Result<(), String> {
    let i = input_index(tables, id)?;
    if tables[i].columns != columns || tables[i].rows != rows {
        return Err(
            "表の内容が変更されています。表示を確認して行を並べ替え直してください。".into(),
        );
    }
    let mut selected = indices.to_vec();
    selected.sort_unstable();
    selected.dedup();
    if selected.is_empty()
        || selected.len() != indices.len()
        || selected.iter().any(|n| *n >= rows.len())
        || to > rows.len() - selected.len()
    {
        return Err("移動する行または移動先が不正です。".into());
    }
    let mut order: Vec<usize> = (0..rows.len()).filter(|n| !selected.contains(n)).collect();
    order.splice(to..to, selected);
    tables[i].rows = order.iter().map(|old| rows[*old].clone()).collect();
    Ok(())
}

pub fn insert(
    tables: &mut [Table],
    id: &str,
    at: usize,
    count: usize,
    is_column: bool,
    columns: &[String],
    rows: &[Vec<String>],
) -> Result<(), String> {
    let i = input_index(tables, id)?;
    if tables[i].columns != columns || tables[i].rows != rows {
        return Err("表の内容が変更されています。表示を確認して挿入し直してください。".into());
    }
    let (len, limit) = if is_column {
        (columns.len(), crate::storage::MAX_COLS)
    } else {
        (rows.len(), crate::storage::MAX_ROWS)
    };
    if at > len || count == 0 || count > limit.saturating_sub(len) {
        return Err("挿入位置または件数が不正です。上限は5000行・50列です。".into());
    }
    if !is_column {
        tables[i]
            .rows
            .splice(at..at, vec![vec![String::new(); columns.len()]; count]);
        return Ok(());
    }
    let mut affected = vec![id.to_string()];
    for n in crate::graph::order(tables)? {
        if (matches!(tables[n].kind, Kind::Aggregate | Kind::Script)
            || tables[n].projection.is_some())
            && tables[n]
                .source
                .as_ref()
                .is_some_and(|s| affected.contains(s))
        {
            return Err("列構成を変更するノードへ接続中の列挿入・削除・並べ替えはできません。対象ノードの入力接続を外してから列構成を変更してください。".into());
        }
        if tables[n].kind == Kind::Union
            && tables[n]
                .union_inputs
                .iter()
                .any(|input| affected.contains(&input.source))
        {
            return Err("結合ノードへ接続中の列挿入・削除・並べ替えはできません。結合の入力接続を外してから列構成を変更してください。".into());
        }
        if tables[n]
            .source
            .as_ref()
            .is_some_and(|s| affected.contains(s))
        {
            // 旧スキーマのキャッシュを残したまま後続の列参照をずらさない。
            if tables[n].manual || tables[n].stale || tables[n].error.is_some() {
                return Err("接続先に手動更新・更新待ち・エラーがあります。解消するか接続を外してから列を挿入してください。".into());
            }
            affected.push(tables[n].id.clone());
        }
    }
    for t in tables.iter_mut().filter(|t| affected.contains(&t.id)) {
        if t.id == id
            && let Some(footer) = &mut t.footer
        {
            footer.resize(columns.len(), Default::default());
            footer.splice(at..at, vec![Default::default(); count]);
        }
        if t.id == id {
            t.column_widths.resize(columns.len(), 160.0);
            t.column_widths.splice(at..at, vec![160.0; count]);
        }
        if let Some(f) = &mut t.filter
            && f.column >= at
        {
            f.column += count;
        }
        for key in &mut t.sort_keys {
            if key.column >= at {
                key.column += count;
            }
        }
    }
    let mut names = Vec::new();
    let mut number = 1;
    while names.len() < count {
        let name = format!("列 {number}");
        if !columns.contains(&name) {
            names.push(name);
        }
        number += 1;
    }
    let schema: Vec<_> = names
        .iter()
        .map(|name| crate::column_types::new_column(&tables[i], name.clone()))
        .collect();
    tables[i].column_schema.splice(at..at, schema);
    tables[i].columns.splice(at..at, names);
    for row in &mut tables[i].rows {
        row.splice(at..at, vec![String::new(); count]);
    }
    Ok(())
}

/// 原本の比較とサイズ検証を済ませてから、表を拡張して貼り付ける。
pub fn paste(
    tables: &mut [Table],
    id: &str,
    row: usize,
    col: usize,
    values: Vec<Vec<String>>,
    expected_values: Option<Vec<Vec<Option<String>>>>,
) -> Result<(), String> {
    let width = values.iter().map(Vec::len).max().unwrap_or(0);
    if values.is_empty() || width == 0 {
        return Err("貼り付けるデータがありません。".into());
    }
    let end_row = row
        .checked_add(values.len())
        .ok_or("行数が大きすぎます。")?;
    let end_col = col.checked_add(width).ok_or("列数が大きすぎます。")?;
    if end_row > MAX_ROWS || end_col > MAX_COLS {
        return Err("試作の上限は5000行・50列です。".into());
    }
    if values.iter().flatten().any(|v| v.len() > MAX_CELL_BYTES) {
        return Err("セルの内容が長すぎます。".into());
    }
    let table = tables
        .iter_mut()
        .find(|table| table.id == id)
        .ok_or("対象の表が見つかりません。")?;
    if table.kind != Kind::Input {
        return Err("加工結果は読み取り専用です。".into());
    }
    if let Some(expected) = expected_values {
        if expected.len() != values.len()
            || expected
                .iter()
                .zip(&values)
                .any(|(a, b)| a.len() != b.len())
        {
            return Err("比較対象の範囲が不正です。".into());
        }
        for (r, cells) in expected.iter().enumerate() {
            for (c, value) in cells.iter().enumerate() {
                if table.rows.get(row + r).and_then(|row| row.get(col + c)) != value.as_ref() {
                    return Err(
                        "同じセルが別の操作で変更されました。入力は保持されています。".into(),
                    );
                }
            }
        }
    }
    while table.columns.len() < end_col {
        table
            .columns
            .push(format!("列 {}", table.columns.len() + 1));
    }
    for r in &mut table.rows {
        r.resize(table.columns.len(), String::new());
    }
    table.rows.resize(
        end_row.max(table.rows.len()),
        vec![String::new(); table.columns.len()],
    );
    for (r, cells) in values.into_iter().enumerate() {
        for (c, value) in cells.into_iter().enumerate() {
            table.rows[row + r][col + c] = value;
        }
    }
    Ok(())
}
