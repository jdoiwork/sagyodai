use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    pub id: String,
    pub title: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub tables: Vec<Table>,
    pub can_undo: bool,
    pub can_redo: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    AddTable,
    Paste {
        id: String,
        row: usize,
        col: usize,
        values: Vec<Vec<String>>,
    },
    AddRows {
        id: String,
        count: usize,
    },
    AddColumn {
        id: String,
    },
    Place {
        id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    Undo,
    Redo,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub expected_revision: u64,
    pub command: Command,
}

pub fn sample_table(id: String, index: usize) -> Table {
    Table {
        id,
        title: format!("手入力の表 {:02}", index + 1),
        columns: vec!["品名".into(), "数量".into(), "分類".into(), "メモ".into()],
        rows: vec![
            vec!["ノート", "3", "文房具", "日本語を入力してみましょう"],
            vec!["コーヒー", "2", "食品", "ダブルクリック不要で編集できます"],
            vec!["鉛筆", "12", "文房具", "表計算ソフトから貼り付けできます"],
            vec!["", "", "", ""],
            vec!["", "", "", ""],
            vec!["", "", "", ""],
        ]
        .into_iter()
        .map(|r| r.into_iter().map(String::from).collect())
        .collect(),
        x: 60.0 + index as f64 * 80.0,
        y: 100.0 + index as f64 * 80.0,
        width: 760.0,
        height: 390.0,
    }
}
