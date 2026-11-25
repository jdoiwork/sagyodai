//! MCP向けの小さな応答。データは明示した範囲だけ返し、巨大セルで文脈を埋めない。
use super::params::{Edit, ReadNode};
use crate::{ApiError, SharedProject, domain::Snapshot, error};
use axum::{Json, extract::State};
use serde_json::{Value, json};

pub fn summary(snapshot: &Snapshot) -> Value {
    json!({
        "revision": snapshot.revision,
        "sheets": snapshot.sheets,
        "canUndo": snapshot.can_undo, "canRedo": snapshot.can_redo,
        "nodes": snapshot.tables.iter().map(|t| json!({
            "id": t.id, "title": t.title, "kind": t.kind, "sheetId": t.sheet_id,
            "source": t.source, "sources": t.sources(), "rowCount": t.rows.len(),
            "columnCount": t.columns.len(), "manual": t.manual, "stale": t.stale,
            "error": t.error, "x": t.x, "y": t.y,
        })).collect::<Vec<_>>()
    })
}

pub async fn overview(State(shared): State<SharedProject>) -> Result<Json<Value>, ApiError> {
    let state = shared
        .project
        .lock()
        .map_err(|_| error("内部状態にアクセスできません。"))?;
    Ok(Json(summary(&state.snapshot())))
}

pub async fn apply(
    State(shared): State<SharedProject>,
    Json(edit): Json<Edit>,
) -> Result<Json<Value>, ApiError> {
    // GUIと同じ確定経路。revision確認・Undo・原子的保存・SSE通知を共有する。
    let Json(snapshot) = crate::command(State(shared), Json(edit.into())).await?;
    Ok(Json(summary(&snapshot)))
}

pub async fn node(
    State(shared): State<SharedProject>,
    Json(read): Json<ReadNode>,
) -> Result<Json<Value>, ApiError> {
    if read.limit > 100 {
        return Err(error("limitは0〜100を指定してください。"));
    }
    let state = shared
        .project
        .lock()
        .map_err(|_| error("内部状態にアクセスできません。"))?;
    let snapshot = state.snapshot();
    let table = snapshot
        .tables
        .iter()
        .find(|t| t.id == read.id)
        .ok_or_else(|| error("ノードが見つかりません。"))?;
    if read.offset > table.rows.len() {
        return Err(error("offsetが行数を超えています。"));
    }
    let mut rows = Vec::new();
    let mut truncated_cells = Vec::new();
    let mut budget = 32_768;
    for (row_index, row) in table
        .rows
        .iter()
        .enumerate()
        .skip(read.offset)
        .take(read.limit)
    {
        let mut output = Vec::new();
        for (col, value) in row.iter().enumerate() {
            let max_bytes = budget.min(2048);
            let mut end = value.len().min(max_bytes);
            while !value.is_char_boundary(end) {
                end -= 1;
            }
            output.push(&value[..end]);
            budget -= end;
            if end < value.len() {
                truncated_cells
                    .push(json!({"row": row_index, "col": col, "originalBytes": value.len()}));
            }
        }
        rows.push(output);
        if budget == 0 {
            break;
        }
    }
    let next = read.offset + rows.len();
    Ok(Json(json!({
        "revision": snapshot.revision, "id": table.id, "kind": table.kind,
        "title": table.title, "sheetId": table.sheet_id, "columns": table.columns,
        "source": table.source, "sources": table.sources(), "filter": table.filter,
        "script": table.script,
        "columnSchema": table.column_schema, "typeConversion": table.type_conversion,
        "cellErrors": table.cell_errors.iter().filter(|e| e.row >= read.offset && e.row < next).take(100).collect::<Vec<_>>(),
        "typedRows": table.output.as_ref().filter(|d| d.rows.len() == table.rows.len() && !table.stale).map(|d| d.rows.iter().skip(read.offset).take(rows.len()).map(|r| r.iter().map(|v| match v { crate::column_types::Value::String(_) => serde_json::json!({"type":"string"}), _ => serde_json::to_value(v).unwrap_or_default() }).collect::<Vec<_>>()).collect::<Vec<_>>()),
        "manual": table.manual, "stale": table.stale, "error": table.error,
        "x": table.x, "y": table.y, "width": table.width, "height": table.height,
        "rowCount": table.rows.len(), "offset": read.offset, "rows": rows,
        "nextOffset": if next < table.rows.len() && read.limit > 0 { Some(next) } else { None },
        "truncatedCells": truncated_cells,
    })))
}
