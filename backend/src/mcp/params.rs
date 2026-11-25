//! 公開操作を限定するアダプタ。検証・計算・保存の規則は共通Commandに任せる。
use crate::domain::{Command, Filter, Kind, Position, Request};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadNode {
    pub id: String,
    /// 行番号は0始まり。既定値0。
    #[serde(default)]
    pub offset: usize,
    /// 最大100行。0なら設定と列情報だけを取得する。
    #[serde(default = "default_limit")]
    pub limit: usize,
}
fn default_limit() -> usize {
    20
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Edit {
    /// 状態取得で返されたrevision。競合時は最新状態を確認し、操作を再検討する。
    pub expected_revision: u64,
    pub command: Operation,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    Convert,
    Script,
    Input,
    Filter,
    Display,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Location {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Operation {
    SetColumnType {
        id: String,
        column_id: String,
        config: crate::column_types::TypeConfig,
        expected_config: crate::column_types::TypeConfig,
    },
    SetTypeConversion {
        id: String,
        columns: std::collections::BTreeMap<String, crate::column_types::TypeConfig>,
        #[serde(default)]
        expected_columns:
            Option<std::collections::BTreeMap<String, crate::column_types::TypeConfig>>,
    },
    SetScript {
        id: String,
        config: crate::script::Config,
    },
    /// 作成後のIDは応答のnodesで確認する。手入力表はGUIと同じサンプル入り。
    AddNode {
        kind: NodeKind,
        sheet_id: Option<String>,
        position: Option<Location>,
    },
    /// idは接続先、sourceは入力元。nullなら切断する。
    Connect {
        id: String,
        source: Option<String>,
    },
    /// filterはフィルタノードの条件。その他のノードではnullを指定する。
    Configure {
        id: String,
        filter: Option<Filter>,
        manual: bool,
    },
    /// 行・列は0始まり。既存セルを上書きし、必要なら行列を拡張する。値は文字列。
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
    RenameColumn {
        id: String,
        col: usize,
        name: String,
        expected_columns: Vec<String>,
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
    Rename {
        id: String,
        title: String,
        expected_title: String,
    },
    Place {
        id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    RemoveNode {
        id: String,
    },
    /// 取得済みデータの再計算。HTTPの再取得や外部プログラム実行はしない。
    Run {
        id: String,
    },
    /// GUI・他のMCPクライアントを含むプロジェクト共通の直前操作を戻す。
    Undo,
    Redo,
}

impl From<Edit> for Request {
    fn from(edit: Edit) -> Self {
        let command = match edit.command {
            Operation::SetColumnType {
                id,
                column_id,
                config,
                expected_config,
            } => Command::SetColumnType {
                id,
                column_id,
                config,
                expected_config,
            },
            Operation::SetTypeConversion {
                id,
                columns,
                expected_columns,
            } => Command::SetTypeConversion {
                id,
                columns,
                expected_columns,
            },
            Operation::SetScript { id, config } => Command::SetScript { id, config },
            Operation::AddNode {
                kind,
                sheet_id,
                position,
            } => Command::AddNode {
                kind: match kind {
                    NodeKind::Convert => Kind::Convert,
                    NodeKind::Script => Kind::Script,
                    NodeKind::Input => Kind::Input,
                    NodeKind::Filter => Kind::Filter,
                    NodeKind::Display => Kind::Display,
                },
                sheet_id,
                position: position.map(|p| Position { x: p.x, y: p.y }),
            },
            Operation::Connect { id, source } => Command::Connect { id, source },
            Operation::Configure { id, filter, manual } => {
                Command::Configure { id, filter, manual }
            }
            Operation::Paste {
                id,
                row,
                col,
                values,
            } => Command::Paste {
                id,
                row,
                col,
                values,
                expected_values: None,
            },
            Operation::AddRows { id, count } => Command::AddRows { id, count },
            Operation::AddColumn { id } => Command::AddColumn { id },
            Operation::RenameColumn {
                id,
                col,
                name,
                expected_columns,
            } => Command::RenameColumn {
                id,
                col,
                name,
                expected_columns,
            },
            Operation::RemoveRows {
                id,
                indices,
                expected_rows,
            } => Command::RemoveRows {
                id,
                indices,
                expected_rows,
            },
            Operation::RemoveColumns {
                id,
                indices,
                expected_columns,
                expected_rows,
            } => Command::RemoveColumns {
                id,
                indices,
                expected_columns,
                expected_rows,
            },
            Operation::Rename {
                id,
                title,
                expected_title,
            } => Command::Rename {
                id,
                title,
                expected_title,
            },
            Operation::Place {
                id,
                x,
                y,
                width,
                height,
            } => Command::Place {
                id,
                x,
                y,
                width,
                height,
            },
            Operation::RemoveNode { id } => Command::RemoveNode { id },
            Operation::Run { id } => Command::Run { id },
            Operation::Undo => Command::Undo,
            Operation::Redo => Command::Redo,
        };
        Self {
            expected_revision: edit.expected_revision,
            command,
        }
    }
}
