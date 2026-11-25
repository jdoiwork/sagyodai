use crate::domain::{
    ColorTarget, Command, Filter, Kind, Operator, Request, Snapshot, Table, sample_table,
};

use crate::storage::{self, MAX_CELL_BYTES, MAX_COLS, MAX_NODES, MAX_ROWS};
const HISTORY_LIMIT: usize = 30;

#[derive(Clone)]
pub struct Project {
    tables: Vec<Table>,
    sheets: Vec<crate::sheets::Sheet>,
    revision: u64,
    next_id: u64,
    undo: Vec<(Vec<Table>, Vec<crate::sheets::Sheet>)>,
    redo: Vec<(Vec<Table>, Vec<crate::sheets::Sheet>)>,
}

impl Default for Project {
    fn default() -> Self {
        Self {
            sheets: crate::sheets::default_sheets(),
            tables: vec![sample_table("table-1".into(), 0)],
            revision: 0,
            next_id: 2,
            undo: vec![],
            redo: vec![],
        }
    }
}

impl Project {
    pub fn restore(document: serde_json::Value, revision: u64) -> Result<Self, String> {
        let mut file = storage::decode_project(document)?;
        let previous = file.tables.clone();
        for table in &mut file.tables {
            crate::note::refresh(table);
        }
        // メモの出力を再構成した場合、自動ノードも更新する。手動ノードは旧結果を保持する。
        if file.tables.iter().zip(&previous).any(|(now, old)| {
            now.note.is_some() && (now.columns != old.columns || now.rows != old.rows)
        }) {
            crate::graph::evaluate(&mut file.tables, &previous, None)?;
        }
        Ok(Self {
            tables: file.tables,
            sheets: file.sheets,
            revision,
            ..Self::default()
        })
    }

    pub fn export(&self) -> Result<Vec<u8>, String> {
        storage::encode_project(&self.tables, &self.sheets)
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            sheets: self.sheets.clone(),
            revision: self.revision,
            tables: self
                .tables
                .iter()
                .cloned()
                .map(|mut table| {
                    table.footer_totals = crate::aggregation::totals(&table);
                    table
                })
                .collect(),
            can_undo: !self.undo.is_empty(),
            can_redo: !self.redo.is_empty(),
        }
    }

    pub fn apply(&mut self, request: Request) -> Result<Snapshot, String> {
        if request.expected_revision != self.revision {
            return Err(
                "状態が更新されています。ページを再読み込みしてからやり直してください。".into(),
            );
        }
        match request.command {
            Command::Undo => {
                if let Some(previous) = self.undo.pop() {
                    self.redo.push((
                        std::mem::replace(&mut self.tables, previous.0),
                        std::mem::replace(&mut self.sheets, previous.1),
                    ));
                }
            }
            Command::Redo => {
                if let Some(next) = self.redo.pop() {
                    self.undo.push((
                        std::mem::replace(&mut self.tables, next.0),
                        std::mem::replace(&mut self.sheets, next.1),
                    ));
                }
            }
            command => {
                // 検証に失敗した場合は一部だけ変更せず、変更前の状態を維持する。
                let mut tables = self.tables.clone();
                let run = if let Command::Run { id } = &command {
                    Some(id.clone())
                } else {
                    None
                };
                let view_only = matches!(
                    &command,
                    Command::SetViewQuery { .. } | Command::SetViewColumns { .. }
                );
                let opening = matches!(command, Command::OpenProject { .. });
                let mut sheets = self.sheets.clone();
                match command {
                    Command::AddSheet => crate::sheets::add(&mut sheets)?,
                    Command::MoveSheet { id, target, after } => {
                        crate::sheets::move_sheet(&mut sheets, &id, &target, after)?
                    }
                    Command::RemoveSheet { id, expected_nodes } => {
                        crate::sheets::remove(&mut sheets, &mut tables, &id, &expected_nodes)?
                    }

                    Command::RenameSheet {
                        id,
                        title,
                        expected_title,
                    } => crate::sheets::rename(&mut sheets, &id, &title, &expected_title)?,
                    Command::OpenProject { document } => {
                        let file = storage::decode_project(document)?;
                        tables = file.tables;
                        sheets = file.sheets;
                    }
                    command => self.edit(&mut tables, command)?,
                }
                crate::sheets::validate(&sheets, &tables)?;
                if !opening && !view_only {
                    crate::graph::evaluate(&mut tables, &self.tables, run.as_deref())?;
                }
                self.undo.push((
                    std::mem::replace(&mut self.tables, tables),
                    std::mem::replace(&mut self.sheets, sheets),
                ));
                if self.undo.len() > HISTORY_LIMIT {
                    self.undo.remove(0);
                }
                self.redo.clear();
            }
        }
        self.revision += 1;
        Ok(self.snapshot())
    }

    fn edit(&mut self, tables: &mut Vec<Table>, command: Command) -> Result<(), String> {
        match command {
            Command::SetColumnType {
                id,
                column_id,
                config,
                expected_config,
            } => {
                crate::column_types::set_column(
                    table_mut(tables, &id)?,
                    &column_id,
                    config,
                    expected_config,
                )?;
            }
            Command::SetTypeConversion {
                id,
                columns,
                expected_columns,
            } => {
                if columns.len() > MAX_COLS {
                    return Err("型変換の列数が上限を超えています。".into());
                }
                for config in columns.values() {
                    config.validate()?;
                }
                let table = table_mut(tables, &id)?;
                if table.kind != Kind::Convert {
                    return Err("型変換ノードではありません。".into());
                }
                if expected_columns.is_some_and(|expected| expected != table.type_conversion) {
                    return Err(
                        "型変換設定が変更されています。最新の設定を確認してください。".into(),
                    );
                }
                table.type_conversion = columns;
            }
            Command::SetJsonKey { id, key } => {
                let table = table_mut(tables, &id)?;
                if table.kind != Kind::JsonSelect {
                    return Err("JSONキー抽出ノードではありません。".into());
                }
                crate::json_transform::validate_key(&key)?;
                table.json_key = Some(key);
            }
            Command::FetchHttp { .. } => {
                return Err("HTTPリクエストは非同期の操作APIから実行してください。".into());
            }
            Command::CompleteHttp { id, config, result } => {
                crate::http_source::complete(table_mut(tables, &id)?, config, result)?
            }
            Command::SetHttpOutput { id, output } => {
                crate::http_source::set_output(table_mut(tables, &id)?, output)?
            }
            Command::SetTextDisplay { id, display } => {
                let table = table_mut(tables, &id)?;
                if !matches!(table.kind, Kind::Text | Kind::TextDisplay) {
                    return Err("テキスト表示に対応したノードではありません。".into());
                }
                table.text_display = display;
            }
            Command::SetNote {
                id,
                text,
                expected_text,
            } => {
                let table = table_mut(tables, &id)?;
                let note = table.note.as_mut().ok_or("メモノードではありません。")?;
                if note.text != expected_text {
                    return Err(
                        "メモが別の操作で変更されています。内容を確認して再適用してください。"
                            .into(),
                    );
                }
                crate::note::validate_text(&text)?;
                note.text = text;
            }
            Command::SetScript { id, config } => {
                config.validate()?;
                let t = table_mut(tables, &id)?;
                let script = t
                    .script
                    .as_mut()
                    .ok_or("スクリプトノードではありません。")?;
                script.config = config;
                t.stale = true;
                t.error = None;
            }
            Command::CompleteScript { id, result } => {
                crate::script::complete(table_mut(tables, &id)?, result)?
            }
            Command::SetReplacement { id, config } => {
                config.validate()?;
                let table = table_mut(tables, &id)?;
                if table.kind != Kind::Replace {
                    return Err("置換ノードではありません。".into());
                }
                table.column_bindings.clear();
                table.replacement = Some(config);
            }
            Command::SetPortSide { id, input, side } => {
                let table = table_mut(tables, &id)?;
                if input {
                    if matches!(
                        table.kind,
                        Kind::Input | Kind::Csv | Kind::Text | Kind::Http | Kind::Note
                    ) {
                        return Err("このノードに入力端子はありません。".into());
                    }
                    table.input_side = Some(side);
                } else {
                    table.output_side = Some(side);
                }
            }

            Command::CreateViewFilters { id, expected_view } => {
                let source = table_mut(tables, &id)?.clone();
                let filters = crate::view_filters::conditions(&source, &expected_view)?;
                if tables.len() + filters.len() > MAX_NODES {
                    return Err(format!(
                        "フィルターを{}個作成するにはノード数の上限（{MAX_NODES}個）を超えます。",
                        filters.len()
                    ));
                }
                let mut previous = id;
                for (index, filter) in filters.into_iter().enumerate() {
                    self.edit(
                        tables,
                        Command::AddNode {
                            kind: Kind::Filter,
                            position: Some(crate::domain::Position {
                                x: source.x + source.width + 80.0 + index as f64 * 440.0,
                                y: source.y,
                            }),
                            sheet_id: Some(source.sheet_id.clone()),
                        },
                    )?;
                    let node = tables.last_mut().ok_or("フィルターを作成できません。")?;
                    node.source = Some(previous);
                    node.edge_color = source.output_color;
                    node.output_color = source.output_color;
                    node.filter = Some(filter);
                    previous = node.id.clone();
                }
            }

            Command::SetCsvOptions {
                id,
                has_headers,
                skip_empty_rows,
                skip_empty_columns,
            } => {
                crate::csv_source::set_options(
                    table_mut(tables, &id)?,
                    has_headers,
                    skip_empty_rows,
                    skip_empty_columns,
                )?;
            }
            Command::ImportText {
                id,
                file_name,
                text,
            } => {
                crate::text_source::import(table_mut(tables, &id)?, file_name, text)?;
            }
            Command::ImportCsv {
                id,
                file_name,
                text,
                has_headers,
                skip_empty_rows,
                skip_empty_columns,
            } => {
                crate::csv_source::import(
                    table_mut(tables, &id)?,
                    file_name,
                    &text,
                    has_headers,
                    skip_empty_rows,
                    skip_empty_columns,
                )?;
            }
            Command::OpenProject { .. }
            | Command::AddSheet
            | Command::MoveSheet { .. }
            | Command::RemoveSheet { .. }
            | Command::RenameSheet { .. } => {
                return Err("プロジェクト操作は共通操作から実行してください。".into());
            }
            Command::Rename {
                id,
                title,
                expected_title,
            } => {
                let t = table_mut(tables, &id)?;
                if t.title != expected_title {
                    return Err(
                        "タイトルが別の操作で変更されました。入力は保持されています。".into(),
                    );
                }
                let title = title.trim();
                if title.is_empty() || title.len() > 1024 {
                    return Err("タイトルは空欄にせず、1024バイト以内で入力してください。".into());
                }
                t.title = title.to_string();
            }
            Command::ConnectFromPort {
                id,
                source,
                from_input,
            } => {
                let color = if from_input {
                    table_mut(tables, &id)?.input_color
                } else {
                    table_mut(tables, &source)?.output_color
                };
                self.edit(
                    tables,
                    Command::Connect {
                        id: id.clone(),
                        source: Some(source.clone()),
                    },
                )?;
                let table = table_mut(tables, &id)?;
                if table.kind == Kind::Union {
                    if let Some(input) = table
                        .union_inputs
                        .iter_mut()
                        .find(|input| input.source == source)
                    {
                        input.color = color;
                    }
                } else {
                    table.edge_color = color;
                }
            }
            Command::Connect { id, source } => {
                let t = table_mut(tables, &id)?;
                if matches!(
                    t.kind,
                    Kind::Input | Kind::Csv | Kind::Text | Kind::Http | Kind::Note
                ) {
                    return Err("入力ソースには接続できません。".into());
                }
                if t.kind == Kind::Union {
                    if let Some(source) = source {
                        if !t.union_inputs.iter().any(|input| input.source == source) {
                            t.union_inputs.push(crate::domain::UnionInput {
                                source,
                                color: None,
                            });
                        }
                    } else {
                        t.union_inputs.clear();
                    }
                } else {
                    if t.source != source {
                        t.column_bindings.clear();
                    }
                    t.source = source;
                }
                crate::graph::order(tables)?;
            }
            Command::HideOutputColumn {
                id,
                col,
                expected_columns,
            } => {
                crate::projection::hide_column(tables, &id, col, &expected_columns)?;
            }
            Command::SetProjection { id, config } => {
                if let Some(config) = &config {
                    config.validate()?;
                }
                let table = table_mut(tables, &id)?;
                if table.kind != Kind::Display {
                    return Err("結果表ではありません。".into());
                }
                table.column_bindings.clear();
                table.projection = config;
                table.view = Default::default();
            }
            Command::SetGroup { id, config } => {
                crate::group::validate(&config)?;
                let table = table_mut(tables, &id)?;
                if table.kind != Kind::Aggregate {
                    return Err("集計ノードではありません。".into());
                }
                table.column_bindings.clear();
                table.group = Some(config);
            }
            Command::SetSort { id, keys } => {
                crate::sort::validate(&keys)?;
                let table = table_mut(tables, &id)?;
                if table.kind != Kind::Sort {
                    return Err("ソートノードではありません。".into());
                }
                table.column_bindings.clear();
                table.sort_keys = keys;
            }
            Command::Configure { id, filter, manual } => {
                let t = table_mut(tables, &id)?;
                if matches!(
                    t.kind,
                    Kind::Input | Kind::Csv | Kind::Text | Kind::Http | Kind::Note
                ) {
                    return Err("入力ソースには加工設定を指定できません。".into());
                }
                if t.filter != filter {
                    t.column_bindings.clear();
                }
                t.filter = filter;
                t.manual = manual;
                crate::graph::order(tables)?;
            }
            Command::SetColor { id, target, color } => {
                let table = table_mut(tables, &id)?;
                match target {
                    ColorTarget::Edge if table.source.is_some() => table.edge_color = color,
                    ColorTarget::Input if table.kind != Kind::Input => table.input_color = color,
                    ColorTarget::Output => table.output_color = color,
                    _ => return Err("色を変更する接続線または端子がありません。".into()),
                }
            }
            Command::SetUnion {
                id,
                sources,
                distinct,
                expected_sources,
            } => {
                let t = table_mut(tables, &id)?;
                if t.kind != Kind::Union {
                    return Err("結合ノードではありません。".into());
                }
                if t.union_inputs
                    .iter()
                    .map(|i| &i.source)
                    .ne(expected_sources.iter())
                {
                    return Err(
                        "入力一覧が変更されています。表示を確認して設定し直してください。".into(),
                    );
                }
                t.union_inputs = sources
                    .into_iter()
                    .map(|source| {
                        let color = t
                            .union_inputs
                            .iter()
                            .find(|i| i.source == source)
                            .and_then(|i| i.color);
                        crate::domain::UnionInput { source, color }
                    })
                    .collect();
                t.union_distinct = distinct;
                crate::graph::order(tables)?;
            }
            Command::SetUnionEdgeColor { id, source, color } => {
                let t = table_mut(tables, &id)?;
                let input = t
                    .union_inputs
                    .iter_mut()
                    .find(|i| i.source == source)
                    .ok_or("接続が見つかりません。")?;
                input.color = color;
            }
            Command::SetFooter {
                id,
                columns,
                expected_columns,
            } => {
                let table = table_mut(tables, &id)?;
                if !matches!(table.kind, Kind::Input | Kind::Display) {
                    return Err("フッターは手入力の表と結果表で使用できます。".into());
                }
                if table.columns != expected_columns
                    || columns
                        .as_ref()
                        .is_some_and(|c| c.len() != table.columns.len())
                {
                    return Err(
                        "列構成が変更されています。表示を確認して集計を設定し直してください。"
                            .into(),
                    );
                }
                table.footer = columns;
            }
            Command::MoveNodeToSheet {
                id,
                sheet_id,
                expected_sheet_id,
            } => {
                if !self.sheets.iter().any(|s| s.id == sheet_id) {
                    return Err("移動先のシートが見つかりません。".into());
                }
                let table = table_mut(tables, &id)?;
                if table.sheet_id != expected_sheet_id {
                    return Err("ノードの所属シートが別の操作で変更されました。".into());
                }
                // 所属だけを変え、入力・出力のID参照や配置、キャッシュは維持する。
                table.sheet_id = sheet_id;
            }
            Command::SetViewQuery {
                id,
                query,
                expected_query,
            } => {
                let table = table_mut(tables, &id)?;
                if table.view.query != expected_query {
                    return Err("検索語が別の操作で変更されています。".into());
                }
                table.view.query = query;
                table.view.validate()?;
            }
            Command::SetViewColumns {
                id,
                columns,
                expected_columns,
            } => {
                let table = table_mut(tables, &id)?;
                if table.view.columns != expected_columns {
                    return Err("表示設定が別の操作で変更されています。".into());
                }
                table.view.columns = columns;
                table.view.validate()?;
            }
            Command::SetCompact { id, compact } => {
                let table = tables
                    .iter_mut()
                    .find(|t| t.id == id)
                    .ok_or("ノードが見つかりません。")?;
                table.compact = compact;
            }
            Command::Run { id } => {
                if table_mut(tables, &id)?.kind == Kind::Script {
                    return Err("スクリプトは専用の実行操作から起動してください。".into());
                }
            }
            Command::RemoveNode { id } => {
                table_mut(tables, &id)?;
                if tables.len() == 1 {
                    return Err("最後のノードは削除できません。".into());
                }
                tables.retain(|t| t.id != id);
                for t in tables.iter_mut() {
                    t.union_inputs.retain(|input| input.source != id);
                    if t.source.as_ref() == Some(&id) {
                        t.source = None;
                    }
                }
            }
            Command::AddTable | Command::AddNode { .. } => {
                let (kind, position, sheet_id) = if let Command::AddNode {
                    kind,
                    position,
                    sheet_id,
                } = command
                {
                    (kind, position, sheet_id)
                } else {
                    (Kind::Input, None, None)
                };
                let sheet_id = sheet_id.unwrap_or_else(|| self.sheets[0].id.clone());
                if !self.sheets.iter().any(|s| s.id == sheet_id) {
                    return Err("シートが見つかりません。".into());
                }
                if position
                    .as_ref()
                    .is_some_and(|p| !p.x.is_finite() || !p.y.is_finite())
                {
                    return Err("ノードの位置が不正です。".into());
                }
                if tables.len() >= MAX_NODES {
                    return Err(format!("ノードは{MAX_NODES}個までです。"));
                }
                while tables
                    .iter()
                    .any(|table| table.id == format!("table-{}", self.next_id))
                {
                    self.next_id += 1;
                }
                let next_x = tables.iter().map(|t| t.x + t.width).fold(0.0_f64, f64::max) + 120.0;
                tables.push(sample_table(
                    format!("table-{}", self.next_id),
                    tables.len(),
                ));
                tables
                    .last_mut()
                    .ok_or("ノードを作成できません。")?
                    .sheet_id = sheet_id;
                if kind != Kind::Input {
                    let t = tables.last_mut().ok_or("ノードを作成できません。")?;
                    t.kind = kind;
                    t.title = format!(
                        "{} {}",
                        if kind == Kind::Convert {
                            "型変換"
                        } else if kind == Kind::Script {
                            "スクリプト"
                        } else if kind == Kind::Note {
                            "メモ"
                        } else if kind == Kind::Replace {
                            "置換"
                        } else if kind == Kind::JsonSelect {
                            "JSONキー抽出"
                        } else if kind == Kind::JsonTable {
                            "JSONを表に変換"
                        } else if kind == Kind::TreeDisplay {
                            "結果ツリー"
                        } else if kind == Kind::TextDisplay {
                            "結果テキスト"
                        } else if kind == Kind::Http {
                            "HTTP"
                        } else if kind == Kind::Text {
                            "テキスト"
                        } else if kind == Kind::Csv {
                            "CSV"
                        } else if kind == Kind::Filter {
                            "フィルタ"
                        } else if kind == Kind::Aggregate {
                            "集計"
                        } else if kind == Kind::Sort {
                            "ソート"
                        } else if kind == Kind::Union {
                            "結合"
                        } else {
                            "結果表"
                        },
                        self.next_id
                    );
                    t.column_schema.clear();
                    t.output = None;
                    t.columns.clear();
                    t.rows.clear();
                    t.width = match kind {
                        Kind::Display | Kind::Csv => 760.0,
                        Kind::Union => 440.0,
                        Kind::Sort | Kind::Aggregate | Kind::Replace => 520.0,
                        _ => 400.0,
                    };
                    t.height = if matches!(kind, Kind::Aggregate | Kind::Replace) {
                        480.0
                    } else if matches!(kind, Kind::Display | Kind::Csv) {
                        390.0
                    } else {
                        360.0
                    };
                    t.x = next_x;
                    t.y = 100.0;
                    t.stale = kind != Kind::Note;
                    if matches!(kind, Kind::TextDisplay | Kind::TreeDisplay) {
                        t.width = 520.0;
                        t.height = 480.0;
                        t.text_display = crate::text_source::TextDisplay::Plain;
                    }
                    if kind == Kind::JsonSelect {
                        t.json_key = Some(String::new());
                    }
                    if matches!(kind, Kind::JsonSelect | Kind::JsonTable) {
                        t.width = 520.0;
                    }
                    if kind == Kind::Script {
                        t.script = Some(Default::default());
                        t.width = 580.0;
                        t.height = 700.0;
                    }
                    if kind == Kind::Http {
                        t.http = Some(Default::default());
                        t.width = 520.0;
                        t.height = 560.0;
                    }
                    if kind == Kind::Note {
                        t.note = Some(Default::default());
                    }
                    if kind == Kind::Replace {
                        t.replacement = Some(Default::default());
                    }
                    if kind == Kind::Aggregate {
                        t.group = Some(Default::default());
                    }
                    if kind == Kind::Filter {
                        t.filter = Some(Filter {
                            values: vec![],
                            column: 0,
                            operator: Operator::Equals,
                            value: String::new(),
                        });
                    }
                }
                if let Some(position) = position {
                    let t = tables.last_mut().ok_or("ノードを作成できません。")?;
                    t.x = position.x;
                    t.y = position.y;
                }
                self.next_id += 1;
            }
            Command::Paste {
                id,
                row,
                col,
                values,
                expected_values,
            } => {
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
                let table = table_mut(tables, &id)?;
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
                            if table.rows.get(row + r).and_then(|row| row.get(col + c))
                                != value.as_ref()
                            {
                                return Err(
                                    "同じセルが別の操作で変更されました。入力は保持されています。"
                                        .into(),
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
            }
            Command::AddRows { id, count } => {
                let table = table_mut(tables, &id)?;
                if table.kind != Kind::Input {
                    return Err("加工結果は読み取り専用です。".into());
                }
                if count == 0 || count > MAX_ROWS.saturating_sub(table.rows.len()) {
                    return Err("試作の上限は5000行です。".into());
                }
                table
                    .rows
                    .extend(vec![vec![String::new(); table.columns.len()]; count]);
            }
            Command::RemoveRows {
                id,
                indices,
                expected_rows,
            } => {
                crate::table_edit::remove_selection(tables, &id, &indices, None, &expected_rows)?;
            }
            Command::RemoveColumns {
                id,
                indices,
                expected_columns,
                expected_rows,
            } => {
                crate::table_edit::remove_selection(
                    tables,
                    &id,
                    &indices,
                    Some(&expected_columns),
                    &expected_rows,
                )?;
            }
            Command::RemoveRow {
                id,
                row,
                expected_rows,
            } => {
                crate::table_edit::remove_row(tables, &id, row, &expected_rows)?;
            }
            Command::RenameColumn {
                id,
                col,
                name,
                expected_columns,
            } => {
                crate::table_edit::rename_column(tables, &id, col, name, &expected_columns)?;
            }
            Command::RemoveColumn {
                id,
                col,
                expected_columns,
                expected_rows,
            } => {
                crate::table_edit::remove_column(
                    tables,
                    &id,
                    col,
                    &expected_columns,
                    &expected_rows,
                )?;
            }
            Command::InsertRows {
                id,
                at,
                count,
                expected_columns,
                expected_rows,
            } => {
                crate::table_edit::insert(
                    tables,
                    &id,
                    at,
                    count,
                    false,
                    &expected_columns,
                    &expected_rows,
                )?;
            }
            Command::InsertColumns {
                id,
                at,
                count,
                expected_columns,
                expected_rows,
            } => {
                crate::table_edit::insert(
                    tables,
                    &id,
                    at,
                    count,
                    true,
                    &expected_columns,
                    &expected_rows,
                )?;
            }
            Command::MoveRows {
                id,
                indices,
                to,
                expected_columns,
                expected_rows,
            } => {
                crate::table_edit::move_rows(
                    tables,
                    &id,
                    &indices,
                    to,
                    &expected_columns,
                    &expected_rows,
                )?;
            }
            Command::MoveColumns {
                id,
                indices,
                to,
                expected_columns,
                expected_rows,
            } => {
                crate::table_edit::move_columns(
                    tables,
                    &id,
                    &indices,
                    to,
                    &expected_columns,
                    &expected_rows,
                )?;
            }
            Command::MoveColumn {
                id,
                from,
                to,
                expected_columns,
                expected_rows,
            } => {
                crate::table_edit::move_column(
                    tables,
                    &id,
                    from,
                    to,
                    &expected_columns,
                    &expected_rows,
                )?;
            }
            Command::ResizeColumn {
                id,
                col,
                width,
                expected_width,
                expected_columns,
            } => {
                let table = table_mut(tables, &id)?;
                if table.columns != expected_columns
                    || col >= table.columns.len()
                    || table.column_widths.get(col).copied().unwrap_or(160.0) != expected_width
                {
                    return Err("列の構成または幅が変更されています。再度操作してください。".into());
                }
                if !width.is_finite() || !(60.0..=1200.0).contains(&width) {
                    return Err("列幅は60〜1200の範囲で指定してください。".into());
                }
                table.column_widths.resize(table.columns.len(), 160.0);
                table.column_widths[col] = width;
            }
            Command::AddColumn { id } => {
                let table = table_mut(tables, &id)?;
                if table.kind != Kind::Input {
                    return Err("加工結果は読み取り専用です。".into());
                }
                if table.columns.len() >= MAX_COLS {
                    return Err("試作の上限は50列です。".into());
                }
                table
                    .columns
                    .push(format!("列 {}", table.columns.len() + 1));
                for row in &mut table.rows {
                    row.push(String::new());
                }
            }
            Command::Place {
                id,
                x,
                y,
                width,
                height,
            } => {
                if !storage::valid_layout(x, y, width, height) {
                    return Err("表の位置またはサイズが不正です。".into());
                }
                let table = table_mut(tables, &id)?;
                table.x = x;
                table.y = y;
                table.width = width;
                table.height = height;
            }
            Command::Undo | Command::Redo => unreachable!("履歴操作は apply で処理する"),
        }
        for table in tables {
            if table.kind == Kind::Input {
                crate::column_types::ensure_schema(table);
            }
        }
        Ok(())
    }
}

fn table_mut<'a>(tables: &'a mut [Table], id: &str) -> Result<&'a mut Table, String> {
    tables
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| "対象の表が見つかりません。".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(project: &mut Project, command: Command) -> Result<Snapshot, String> {
        project.apply(Request {
            expected_revision: project.revision,
            command,
        })
    }
    #[test]
    fn paste_expands_table_atomically_and_is_one_undo() {
        let mut p = Project::default();
        let before = p.snapshot().tables[0].rows.clone();
        run(
            &mut p,
            Command::Paste {
                id: "table-1".into(),
                row: 5,
                col: 3,
                expected_values: None,
                values: vec![
                    vec!["日本語".into(), "列追加".into()],
                    vec!["改行\nあり".into(), "".into()],
                ],
            },
        )
        .unwrap();
        assert_eq!(p.tables[0].rows.len(), 7);
        assert_eq!(p.tables[0].columns.len(), 5);
        assert_eq!(p.tables[0].rows[6][3], "改行\nあり");
        run(&mut p, Command::Undo).unwrap();
        assert_eq!(p.tables[0].rows, before);
        run(&mut p, Command::Redo).unwrap();
        assert_eq!(p.tables[0].rows[5][4], "列追加");
    }
    #[test]
    fn opening_file_is_atomic_undoable_and_preserves_unique_ids() {
        let mut p = Project::default();
        let initial = p.export().unwrap();
        let mut tables = vec![
            sample_table("table-1".into(), 0),
            sample_table("table-2".into(), 1),
        ];
        tables[0].rows[0][0] = "復元したデータ".into();
        crate::column_types::refresh_input(&mut tables[0]);
        let document: serde_json::Value =
            serde_json::from_slice(&storage::encode(&tables).unwrap()).unwrap();
        let mut invalid = document.clone();
        invalid["formatVersion"] = 99.into();
        assert!(run(&mut p, Command::OpenProject { document: invalid }).is_err());
        assert_eq!(p.export().unwrap(), initial);
        assert_eq!(p.revision, 0);
        run(&mut p, Command::OpenProject { document }).unwrap();
        assert_eq!(p.tables[0].rows[0][0], "復元したデータ");
        run(&mut p, Command::Undo).unwrap();
        assert_eq!(p.export().unwrap(), initial);
        run(&mut p, Command::Redo).unwrap();
        run(&mut p, Command::AddTable).unwrap();
        assert_eq!(p.tables[2].id, "table-3");
    }
    #[test]
    fn invalid_paste_and_stale_edit_leave_state_untouched() {
        let mut p = Project::default();
        assert!(
            run(
                &mut p,
                Command::Paste {
                    id: "table-1".into(),
                    row: 4999,
                    col: 0,
                    expected_values: None,
                    values: vec![vec!["x".into()], vec!["y".into()]]
                }
            )
            .is_err()
        );
        assert_eq!(p.revision, 0);
        assert!(!p.snapshot().can_undo);
        run(
            &mut p,
            Command::AddColumn {
                id: "table-1".into(),
            },
        )
        .unwrap();
        assert!(
            p.apply(Request {
                expected_revision: 0,
                command: Command::AddTable
            })
            .is_err()
        );
        assert_eq!(p.tables.len(), 1);
    }
}

#[cfg(test)]
mod sync_tests {
    use super::*;
    #[test]
    fn guarded_paste_preserves_other_edits_and_rejects_same_cell_conflicts() {
        let mut project = Project::default();
        let edit = |revision, col, value: &str, expected: &str| Request {
            expected_revision: revision,
            command: Command::Paste {
                id: "table-1".into(),
                row: 0,
                col,
                values: vec![vec![value.into()]],
                expected_values: Some(vec![vec![Some(expected.into())]]),
            },
        };
        project.apply(edit(0, 0, "別タブ", "ノート")).unwrap();
        assert!(project.apply(edit(1, 0, "自分の入力", "ノート")).is_err());
        assert_eq!(project.snapshot().revision, 1);
        project.apply(edit(1, 1, "4", "3")).unwrap();
        assert_eq!(project.snapshot().tables[0].rows[0][0], "別タブ");
        project
            .apply(Request {
                expected_revision: 2,
                command: Command::Undo,
            })
            .unwrap();
        assert_eq!(project.snapshot().tables[0].rows[0][1], "3");
        assert_eq!(project.snapshot().tables[0].rows[0][0], "別タブ");
    }
}
