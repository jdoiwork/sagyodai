//! 型付き出力の加工。文字列だけの既存加工は従来の実装を使用する。
use crate::column_types::{Column, Data, DataType, EmptyValue, TypeConfig, Value};
use crate::domain::{Kind, Operator, Table};
use crate::number_text::parse_finite_number;
use std::cmp::Ordering;

fn cmp(a: &Value, b: &Value) -> Ordering {
    match (a, b) {
        (Value::Null, Value::Null) => Ordering::Equal,
        (Value::Null, _) => Ordering::Greater,
        (_, Value::Null) => Ordering::Less,
        (Value::Integer(a), Value::Integer(b)) => a.cmp(b),
        (Value::Boolean(a), Value::Boolean(b)) => a.cmp(b),
        _ => a.text().cmp(&b.text()),
    }
}
fn input(table: &Table) -> Data {
    table
        .output
        .clone()
        .unwrap_or_else(|| crate::column_types::strings(table))
}
pub fn evaluate(node: &Table, inputs: &[Table]) -> Option<Result<Data, String>> {
    let source = inputs.first()?;
    if source.stale || source.error.is_some() {
        return Some(Err(
            "入力が更新待ちです。上流ノードを確認してください。".into()
        ));
    }
    let data = input(source);
    if node.kind == Kind::Convert {
        return Some(convert(node, data));
    }
    // 文字列専用の既存操作でも列IDと型を引き継ぐ。集計等の旧数値解釈は文字列列に限定する。
    match node.kind {
        Kind::Display | Kind::TextDisplay => Some(project(node, data)),
        Kind::Union => Some(union(inputs, node.union_distinct)),
        Kind::Filter
            if data
                .columns
                .iter()
                .any(|c| c.config.data_type != DataType::String || c.config.nullable) =>
        {
            Some(filter(node, data))
        }
        Kind::Sort
            if data
                .columns
                .iter()
                .any(|c| c.config.data_type != DataType::String || c.config.nullable) =>
        {
            Some(sort(node, data))
        }
        Kind::Aggregate
            if data
                .columns
                .iter()
                .any(|c| c.config.data_type != DataType::String || c.config.nullable) =>
        {
            Some(group(node, data))
        }
        Kind::Replace
            if data
                .columns
                .iter()
                .any(|c| c.config.data_type != DataType::String || c.config.nullable) =>
        {
            Some(replace(node, data))
        }
        _ => None,
    }
}
fn convert(node: &Table, mut data: Data) -> Result<Data, String> {
    for (id, config) in &node.type_conversion {
        config.validate()?;
        let col = data
            .columns
            .iter()
            .position(|c| &c.id == id)
            .ok_or("型変換する列が入力にありません。設定し直してください。")?;
        for (r, row) in data.rows.iter_mut().enumerate() {
            row[col] = if row[col] == Value::Null {
                if !config.nullable {
                    return Err(format!(
                        "{}行 {}列: nullは許可されていません。",
                        r + 1,
                        col + 1
                    ));
                }
                Value::Null
            } else {
                config
                    .parse(&row[col].text())
                    .map_err(|e| format!("{}行 {}列: {e}", r + 1, col + 1))?
            };
        }
        data.columns[col].config = config.clone();
    }
    Ok(data)
}
fn project(node: &Table, mut data: Data) -> Result<Data, String> {
    if let Some(config) = &node.projection {
        config.validate()?;
        if config.schema
            != data
                .columns
                .iter()
                .map(|c| c.name.clone())
                .collect::<Vec<_>>()
        {
            return Err("入力列が変わりました。出力列を設定し直してください。".into());
        }
        let visible: Vec<_> = config.columns.iter().filter(|c| c.visible).collect();
        data.columns = visible
            .iter()
            .map(|c| {
                let mut column = data.columns[c.column].clone();
                if !c.name.trim().is_empty() {
                    column.name = c.name.trim().into();
                }
                column
            })
            .collect();
        data.rows = data
            .rows
            .iter()
            .map(|r| visible.iter().map(|c| r[c.column].clone()).collect())
            .collect();
    }
    Ok(data)
}
fn union(inputs: &[Table], distinct: bool) -> Result<Data, String> {
    let mut data = input(&inputs[0]);
    data.rows.clear();
    let mut seen = std::collections::HashSet::new();
    for table in inputs {
        if table.stale || table.error.is_some() {
            return Err("結合の入力が更新待ちまたはエラーです。".into());
        }
        let next = input(table);
        if next.columns.len() != data.columns.len()
            || next.columns.iter().zip(&data.columns).any(|(a, b)| {
                a.name != b.name
                    || a.config.data_type != b.config.data_type
                    || a.config.nullable != b.config.nullable
            })
        {
            return Err("結合には列名・列数・並び・型・null許容の一致が必要です。".into());
        }
        for row in next.rows {
            let key = serde_json::to_string(&row).map_err(|e| e.to_string())?;
            if !distinct || seen.insert(key) {
                data.rows.push(row);
            }
            if data.rows.len() > crate::storage::MAX_ROWS {
                return Err("結合結果が5000行の上限を超えます。".into());
            }
        }
    }
    Ok(data)
}
fn filter(node: &Table, mut data: Data) -> Result<Data, String> {
    let f = node.filter.as_ref().ok_or("フィルタ設定がありません。")?;
    if f.operator == Operator::SearchAll {
        let needle = f.value.trim().to_lowercase();
        data.rows.retain(|r| {
            r.iter()
                .any(|v| *v != Value::Null && v.text().to_lowercase().contains(&needle))
        });
        return Ok(data);
    }
    let col = data
        .columns
        .get(f.column)
        .ok_or("対象列が入力にありません。")?;
    let numeric = f.operator.is_numeric_comparison();
    if numeric && col.config.data_type == DataType::Boolean {
        return Err("真偽値列は数値比較できません。".into());
    }
    if f.operator == Operator::Contains && col.config.data_type != DataType::String {
        return Err("部分一致は文字列列に指定してください。".into());
    }
    if numeric && col.config.data_type == DataType::String {
        let threshold =
            parse_finite_number(&f.value).ok_or("比較値に有限の数値を入力してください。")?;
        data.rows.retain(|r| {
            r[f.column] != Value::Null
                && parse_finite_number(&r[f.column].text()).is_some_and(|v| match f.operator {
                    Operator::NumberEquals => v == threshold,
                    Operator::NumberNotEquals => v != threshold,
                    Operator::Greater => v > threshold,
                    Operator::Less => v < threshold,
                    Operator::AtLeast => v >= threshold,
                    Operator::AtMost => v <= threshold,
                    _ => false,
                })
        });
        return Ok(data);
    }
    let cfg = &col.config;
    let values: Vec<Value> = if matches!(f.operator, Operator::In | Operator::NotIn) {
        f.values
            .iter()
            .map(|s| cfg.parse(s))
            .collect::<Result<_, _>>()?
    } else {
        vec![cfg.parse(&f.value)?]
    };
    data.rows.retain(|r| {
        let v = &r[f.column];
        if *v == Value::Null {
            return false;
        }
        let value = v.clone();
        match f.operator {
            Operator::In => values.contains(&value),
            Operator::NotIn => !values.contains(&value),
            Operator::Equals | Operator::NumberEquals => value == values[0],
            Operator::NotEquals | Operator::NumberNotEquals => value != values[0],
            Operator::Contains => value.text().contains(&f.value),
            Operator::Greater => cmp(&value, &values[0]) == Ordering::Greater,
            Operator::Less => cmp(&value, &values[0]) == Ordering::Less,
            Operator::AtLeast => cmp(&value, &values[0]) != Ordering::Less,
            Operator::AtMost => cmp(&value, &values[0]) != Ordering::Greater,
            _ => false,
        }
    });
    Ok(data)
}
fn sort(node: &Table, mut data: Data) -> Result<Data, String> {
    if node
        .sort_keys
        .iter()
        .any(|k| k.column >= data.columns.len())
    {
        return Err("ソート対象の列が入力にありません。".into());
    }
    data.rows.sort_by(|a, b| {
        for key in &node.sort_keys {
            let (a, b) = (&a[key.column], &b[key.column]);
            let order = if *a == Value::Null || *b == Value::Null {
                cmp(a, b)
            } else if data.columns[key.column].config.data_type == DataType::String {
                key.compare_text_cells(&a.text(), &b.text())
            } else if key.direction == crate::sort::Direction::Desc {
                cmp(a, b).reverse()
            } else {
                cmp(a, b)
            };
            if order != Ordering::Equal {
                return order;
            }
        }
        Ordering::Equal
    });
    Ok(data)
}
fn replace(node: &Table, mut data: Data) -> Result<Data, String> {
    let cfg = node.replacement.as_ref().ok_or("置換設定がありません。")?;
    let col = data.columns.get(cfg.column).ok_or("置換列がありません。")?;
    if col.config.data_type != DataType::String {
        return Err("置換する列を文字列に型変換してください。".into());
    }
    let mut source = node.clone();
    source.columns = data.columns.iter().map(|c| c.name.clone()).collect();
    source.rows = data
        .rows
        .iter()
        .map(|r| {
            r.iter()
                .map(|v| {
                    if *v == Value::Null {
                        String::new()
                    } else {
                        v.text()
                    }
                })
                .collect()
        })
        .collect();
    let (names, rows) = cfg.evaluate(&source)?;
    if cfg.add_column {
        let mut column = data.columns[cfg.column].clone();
        column.id = format!("{}:replacement", node.id);
        column.name = names.last().cloned().unwrap_or_default();
        data.columns.push(column);
    }
    let target = if cfg.add_column {
        data.columns.len() - 1
    } else {
        cfg.column
    };
    for (i, row) in data.rows.iter_mut().enumerate() {
        let value = if row[cfg.column] == Value::Null {
            Value::Null
        } else {
            Value::String(rows[i][target].clone())
        };
        if cfg.add_column {
            row.push(value);
        } else {
            row[target] = value;
        }
    }
    Ok(data)
}
fn group(node: &Table, data: Data) -> Result<Data, String> {
    use crate::group::AggregateFunction as F;
    let cfg = node.group.as_ref().ok_or("集計設定がありません。")?;
    crate::group::validate(cfg)?;
    let outputs = cfg.output_columns();
    if cfg.group_by.iter().any(|c| *c >= data.columns.len()) {
        return Err("グループ列がありません。".into());
    }
    for o in &outputs {
        if o.function != F::Count
            && o.column
                .and_then(|c| data.columns.get(c))
                .is_none_or(|c| c.config.data_type != DataType::Integer)
        {
            return Err(
                "数値集計には整数列を指定してください。型変換ノードで変換できます。".into(),
            );
        }
    }
    let mut columns: Vec<Column> = cfg
        .group_by
        .iter()
        .map(|c| data.columns[*c].clone())
        .collect();
    for (i, o) in outputs.iter().enumerate() {
        let name = if o.name.trim().is_empty() {
            match o.function {
                F::Count => "件数".into(),
                _ => format!(
                    "{}（{}）",
                    match o.function {
                        F::Sum => "合計",
                        F::Average => "平均",
                        F::Min => "最小値",
                        _ => "最大値",
                    },
                    data.columns[o.column.unwrap_or(0)].name
                ),
            }
        } else {
            o.name.trim().into()
        };
        let mut name: String = name.chars().take(240).collect();
        while columns.iter().any(|c| c.name == name) {
            name.push_str(" (2)");
        }
        columns.push(Column {
            id: aggregate_id(node, &data.columns, &outputs, i),
            name,
            config: TypeConfig {
                data_type: DataType::Integer,
                nullable: false,
                empty: EmptyValue::Value("0".into()),
            },
        });
    }
    let mut groups: Vec<(Vec<Value>, Vec<&Vec<Value>>)> = vec![];
    if cfg.group_by.is_empty() {
        groups.push((vec![], vec![]));
    }
    for row in &data.rows {
        let key: Vec<_> = cfg.group_by.iter().map(|c| row[*c].clone()).collect();
        if let Some((_, rows)) = groups.iter_mut().find(|(k, _)| *k == key) {
            rows.push(row);
        } else {
            groups.push((key, vec![row]));
        }
    }
    let mut rows = vec![];
    for (mut key, members) in groups {
        for o in &outputs {
            let nums: Vec<i64> = members
                .iter()
                .filter_map(|r| {
                    o.column
                        .and_then(|c| r.get(c))
                        .and_then(|value| match value {
                            Value::Integer(n) => Some(*n),
                            _ => None,
                        })
                })
                .collect();
            let n = match o.function {
                F::Count => members.len() as i128,
                F::Sum => nums.iter().map(|n| *n as i128).sum(),
                F::Min => *nums
                    .iter()
                    .min()
                    .ok_or("最小値の対象に整数がありません。")? as i128,
                F::Max => *nums
                    .iter()
                    .max()
                    .ok_or("最大値の対象に整数がありません。")? as i128,
                F::Average => {
                    if nums.is_empty() {
                        return Err("平均の対象に整数がありません。".into());
                    }
                    let sum: i128 = nums.iter().map(|n| *n as i128).sum();
                    if sum % nums.len() as i128 != 0 {
                        return Err("平均が整数になりません。小数型は未対応です。".into());
                    }
                    sum / nums.len() as i128
                }
            };
            key.push(Value::Integer(
                i64::try_from(n).map_err(|_| "集計結果が64ビット整数の範囲を超えました。")?,
            ));
        }
        rows.push(key);
    }
    Ok(Data { columns, rows })
}
fn derived_id(node: &Table, key: &str) -> String {
    use sha2::{Digest, Sha256};
    format!(
        "{}:{}",
        node.id,
        Sha256::digest(key.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    )
}
fn aggregate_id(
    node: &Table,
    source: &[Column],
    outputs: &[crate::group::GroupOutput],
    i: usize,
) -> String {
    let item = &outputs[i];
    let col = if item.function == crate::group::AggregateFunction::Count {
        ""
    } else {
        item.column
            .and_then(|c| source.get(c))
            .map(|c| c.id.as_str())
            .unwrap_or("")
    };
    let duplicate = outputs[..i]
        .iter()
        .filter(|o| o.function == item.function && o.column == item.column)
        .count();
    derived_id(
        node,
        &format!("aggregate:{:?}:{col}:{duplicate}", item.function),
    )
}
// 文字列だけの既存加工結果にも列IDを付ける。生成列はノードごとに安定した名前空間に置く。
pub fn legacy_result(
    node: &Table,
    source: Option<&Table>,
    names: Vec<String>,
    rows: Vec<Vec<String>>,
) -> Data {
    let inherited = matches!(node.kind, Kind::Filter | Kind::Sort | Kind::Replace);
    let columns = names
        .into_iter()
        .enumerate()
        .map(|(i, name)| {
            let mut col = if inherited {
                source.and_then(|s| s.column_schema.get(i)).cloned()
            } else {
                None
            }
            .unwrap_or_else(|| Column {
                id: if node.kind == Kind::Aggregate {
                    let config = node.group.as_ref();
                    if let Some(config) = config {
                        if i < config.group_by.len() {
                            source
                                .and_then(|s| s.column_schema.get(config.group_by[i]))
                                .map(|c| c.id.clone())
                                .unwrap_or_else(|| derived_id(node, &name))
                        } else {
                            aggregate_id(
                                node,
                                source.map(|s| s.column_schema.as_slice()).unwrap_or(&[]),
                                &config.output_columns(),
                                i - config.group_by.len(),
                            )
                        }
                    } else {
                        derived_id(node, &name)
                    }
                } else {
                    derived_id(node, &format!("output:{i}:{name}"))
                },
                name: name.clone(),
                config: TypeConfig::default(),
            });
            col.name = name;
            col
        })
        .collect();
    Data {
        columns,
        rows: rows
            .into_iter()
            .map(|r| r.into_iter().map(Value::String).collect())
            .collect(),
    }
}
