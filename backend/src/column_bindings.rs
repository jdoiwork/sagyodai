//! 設定UIの列位置を、確定後は安定した列IDに結び付ける。
use crate::domain::{Operator, Table};
fn visit(node: &mut Table, mut f: impl FnMut(String, &mut usize)) {
    if let Some(filter) = &mut node.filter
        && filter.operator != Operator::SearchAll
    {
        f("filter".into(), &mut filter.column);
    }
    for (i, k) in node.sort_keys.iter_mut().enumerate() {
        f(format!("sort:{i}"), &mut k.column);
    }
    if let Some(g) = &mut node.group {
        for (label, cols) in [
            ("group", &mut g.group_by),
            ("sum", &mut g.sums),
            ("average", &mut g.averages),
            ("min", &mut g.minima),
            ("max", &mut g.maxima),
        ] {
            for (i, c) in cols.iter_mut().enumerate() {
                f(format!("{label}:{i}"), c);
            }
        }
        if let Some(outputs) = &mut g.outputs {
            for (i, o) in outputs.iter_mut().enumerate() {
                if let Some(c) = &mut o.column {
                    f(format!("output:{i}"), c);
                }
            }
        }
    }
    if let Some(r) = &mut node.replacement {
        f("replace".into(), &mut r.column);
    }
    if let Some(p) = &mut node.projection {
        for (i, c) in p.columns.iter_mut().enumerate() {
            f(format!("projection:{i}"), &mut c.column);
        }
    }
}
pub fn resolve(node: &mut Table, source: &Table) -> Result<(), String> {
    if node.column_bindings.is_empty()
        && node
            .projection
            .as_ref()
            .is_some_and(|p| p.schema != source.columns)
    {
        return Err("入力の列構成が変わりました。出力列を設定し直してください。".into());
    }
    let mut bindings = std::mem::take(&mut node.column_bindings);
    let mut missing = false;
    visit(node, |key, index| {
        if let Some(id) = bindings.get(&key) {
            if let Some(i) = source.column_schema.iter().position(|c| &c.id == id) {
                *index = i;
            } else {
                missing = true;
            }
        } else if let Some(col) = source.column_schema.get(*index) {
            bindings.insert(key, col.id.clone());
        }
    });
    node.column_bindings = bindings;
    if missing {
        return Err("参照していた列が入力にありません。対象列を設定し直してください。".into());
    }
    if let Some(p) = &mut node.projection
        && p.columns.len() == source.columns.len()
    {
        p.schema = source.columns.clone();
    }
    Ok(())
}
