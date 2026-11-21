//! 添字で行列を指定する間は、表示時の原本を照合して別タブの変更を保護する。
use crate::domain::{Kind, Table};

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
            if tables[n].filter.as_ref().is_some_and(|f| f.column == col) {
                return Err(format!(
                    "「{}」がこの列を参照しています。フィルタの対象列を変更するか接続を外してください。",
                    tables[n].title
                ));
            }
            affected.push(tables[n].id.clone());
        }
    }
    for t in tables.iter_mut().filter(|t| affected.contains(&t.id)) {
        if col < t.column_widths.len() {
            t.column_widths.remove(col);
        }
        if let Some(f) = &mut t.filter
            && f.column > col
        {
            f.column -= 1;
        }
    }
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
    let i = input_index(tables, id)?;
    if tables[i].columns != columns || tables[i].rows != rows {
        return Err(
            "表の内容が変更されています。表示を確認して列を並べ替え直してください。".into(),
        );
    }
    if from >= columns.len() || to >= columns.len() {
        return Err("移動する列が存在しません。".into());
    }
    if from == to {
        return Ok(());
    }
    let mut affected = vec![id.to_string()];
    for n in crate::graph::order(tables)? {
        if tables[n]
            .source
            .as_ref()
            .is_some_and(|s| affected.contains(s))
        {
            // 旧列順のキャッシュを持つノードが残ると、後続の列参照が変わってしまう。
            if tables[n].manual || tables[n].stale || tables[n].error.is_some() {
                return Err("接続先に手動更新・更新待ち・エラーがあります。自動更新に切り替えて問題を解消するか、接続を外してから列を並べ替えてください。".into());
            }
            affected.push(tables[n].id.clone());
        }
    }
    for t in tables.iter_mut().filter(|t| affected.contains(&t.id)) {
        t.column_widths.resize(columns.len(), 160.0);
        let width = t.column_widths.remove(from);
        t.column_widths.insert(to, width);
        if let Some(f) = &mut t.filter {
            f.column = if f.column == from {
                to
            } else if from < to && f.column > from && f.column <= to {
                f.column - 1
            } else if to < from && f.column >= to && f.column < from {
                f.column + 1
            } else {
                f.column
            };
        }
    }
    let name = tables[i].columns.remove(from);
    tables[i].columns.insert(to, name);
    for row in &mut tables[i].rows {
        let value = row.remove(from);
        row.insert(to, value);
    }
    Ok(())
}
