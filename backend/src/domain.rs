use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Table {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csv: Option<crate::csv_source::CsvSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub projection: Option<crate::projection::Projection>,
    #[serde(default)]
    pub group: Option<crate::group::GroupConfig>,
    #[serde(default)]
    pub sort_keys: Vec<crate::sort::SortKey>,
    #[serde(default)]
    pub view: crate::table_view::TableView,
    #[serde(default = "crate::sheets::default_sheet_id")]
    pub sheet_id: String,
    #[serde(default)]
    pub edge_color: Option<PaletteColor>,
    #[serde(default)]
    pub input_color: Option<PaletteColor>,
    #[serde(default)]
    pub output_color: Option<PaletteColor>,
    #[serde(default)]
    pub footer: Option<Vec<bool>>,
    #[serde(default, skip_deserializing, skip_serializing_if = "Vec::is_empty")]
    pub footer_totals: Vec<Option<String>>,
    #[serde(default)]
    pub union_inputs: Vec<UnionInput>,
    #[serde(default)]
    pub union_distinct: bool,
    pub kind: Kind,
    pub source: Option<String>,
    pub filter: Option<Filter>,
    pub manual: bool,
    #[serde(default)]
    pub compact: bool,
    pub stale: bool,
    pub error: Option<String>,
    pub id: String,
    pub title: String,
    pub columns: Vec<String>,
    #[serde(default)]
    pub column_widths: Vec<f64>,
    pub rows: Vec<Vec<String>>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnionInput {
    pub source: String,
    pub color: Option<PaletteColor>,
}
impl Table {
    pub fn sources(&self) -> Vec<&String> {
        self.source
            .iter()
            .chain(self.union_inputs.iter().map(|input| &input.source))
            .collect()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PaletteColor {
    Green,
    Blue,
    Purple,
    Pink,
    Red,
    Orange,
    Gray,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColorTarget {
    Edge,
    Input,
    Output,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Input,
    Csv,
    Filter,
    Display,
    Union,
    Sort,
    Aggregate,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Operator {
    In,
    NotIn,
    NumberEquals,
    NumberNotEquals,
    Equals,
    NotEquals,
    Contains,
    Greater,
    Less,
    AtLeast,
    AtMost,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Filter {
    #[serde(default)]
    pub values: Vec<String>,
    pub column: usize,
    pub operator: Operator,
    pub value: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub sheets: Vec<crate::sheets::Sheet>,
    pub revision: u64,
    pub tables: Vec<Table>,
    pub can_undo: bool,
    pub can_redo: bool,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Command {
    SetCsvOptions {
        id: String,
        has_headers: bool,
        skip_empty_rows: bool,
        skip_empty_columns: bool,
    },
    ImportCsv {
        id: String,
        file_name: String,
        text: String,
        has_headers: bool,
        #[serde(default)]
        skip_empty_rows: bool,
        #[serde(default)]
        skip_empty_columns: bool,
    },
    HideOutputColumn {
        id: String,
        col: usize,
        expected_columns: Vec<String>,
    },
    SetProjection {
        id: String,
        config: Option<crate::projection::Projection>,
    },
    SetGroup {
        id: String,
        config: crate::group::GroupConfig,
    },
    SetSort {
        id: String,
        keys: Vec<crate::sort::SortKey>,
    },
    SetViewQuery {
        id: String,
        query: String,
        expected_query: String,
    },
    SetViewColumns {
        id: String,
        columns: crate::table_view::ColumnView,
        expected_columns: crate::table_view::ColumnView,
    },
    MoveNodeToSheet {
        id: String,
        sheet_id: String,
        expected_sheet_id: String,
    },
    AddSheet,
    RenameSheet {
        id: String,
        title: String,
        expected_title: String,
    },
    AddTable,
    AddNode {
        kind: Kind,
        sheet_id: Option<String>,
        position: Option<Position>,
    },
    ConnectFromPort {
        id: String,
        source: String,
        from_input: bool,
    },
    Connect {
        id: String,
        source: Option<String>,
    },
    Configure {
        id: String,
        filter: Option<Filter>,
        manual: bool,
    },
    SetColor {
        id: String,
        target: ColorTarget,
        color: Option<PaletteColor>,
    },
    SetUnion {
        id: String,
        sources: Vec<String>,
        distinct: bool,
        expected_sources: Vec<String>,
    },
    SetUnionEdgeColor {
        id: String,
        source: String,
        color: Option<PaletteColor>,
    },
    SetFooter {
        id: String,
        columns: Option<Vec<bool>>,
        expected_columns: Vec<String>,
    },
    SetCompact {
        id: String,
        compact: bool,
    },
    Run {
        id: String,
    },
    Rename {
        id: String,
        title: String,
        expected_title: String,
    },
    RemoveNode {
        id: String,
    },
    OpenProject {
        document: serde_json::Value,
    },
    Paste {
        id: String,
        row: usize,
        col: usize,
        values: Vec<Vec<String>>,
        #[serde(default)]
        expected_values: Option<Vec<Vec<Option<String>>>>,
    },
    AddRows {
        id: String,
        count: usize,
    },
    RemoveRows {
        id: String,
        indices: Vec<usize>,
        expected_rows: Vec<Vec<String>>,
    },
    RemoveColumns {
        id: String,
        indices: Vec<usize>,
        expected_columns: Vec<String>,
        expected_rows: Vec<Vec<String>>,
    },
    RemoveRow {
        id: String,
        row: usize,
        expected_rows: Vec<Vec<String>>,
    },
    RenameColumn {
        id: String,
        col: usize,
        name: String,
        expected_columns: Vec<String>,
    },
    RemoveColumn {
        id: String,
        col: usize,
        expected_columns: Vec<String>,
        expected_rows: Vec<Vec<String>>,
    },
    InsertRows {
        id: String,
        at: usize,
        count: usize,
        expected_columns: Vec<String>,
        expected_rows: Vec<Vec<String>>,
    },
    InsertColumns {
        id: String,
        at: usize,
        count: usize,
        expected_columns: Vec<String>,
        expected_rows: Vec<Vec<String>>,
    },
    MoveRows {
        id: String,
        indices: Vec<usize>,
        to: usize,
        expected_columns: Vec<String>,
        expected_rows: Vec<Vec<String>>,
    },
    MoveColumns {
        id: String,
        indices: Vec<usize>,
        to: usize,
        expected_columns: Vec<String>,
        expected_rows: Vec<Vec<String>>,
    },
    MoveColumn {
        id: String,
        from: usize,
        to: usize,
        expected_columns: Vec<String>,
        expected_rows: Vec<Vec<String>>,
    },
    ResizeColumn {
        id: String,
        col: usize,
        width: f64,
        expected_width: f64,
        expected_columns: Vec<String>,
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

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub expected_revision: u64,
    pub command: Command,
}

pub fn sample_table(id: String, index: usize) -> Table {
    Table {
        csv: None,
        sheet_id: crate::sheets::default_sheet_id(),
        edge_color: None,
        input_color: None,
        output_color: None,
        union_inputs: vec![],
        union_distinct: false,
        sort_keys: vec![],
        group: None,
        projection: None,
        footer: None,
        footer_totals: vec![],
        kind: Kind::Input,
        source: None,
        filter: None,
        manual: false,
        compact: false,
        view: Default::default(),
        stale: false,
        error: None,
        id,
        title: format!("手入力の表 {:02}", index + 1),
        column_widths: vec![],
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
