//! 検証用の表コピーに編集を適用する。履歴・再計算・確定は親の apply が担当する。
use super::Project;
use crate::domain::{ColorTarget, Command, Kind, Table};
use crate::storage::{self, MAX_COLS, MAX_NODES, MAX_ROWS};

impl Project {
    pub(super) fn edit(&mut self, tables: &mut Vec<Table>, command: Command) -> Result<(), String> {
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
                    if !table.kind.accepts_input() {
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
                if !t.kind.accepts_input() {
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
                if !t.kind.accepts_input() {
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
            Command::AddTable => self.add_node(tables, Kind::Input, None, None)?,
            Command::AddNode {
                kind,
                position,
                sheet_id,
            } => {
                self.add_node(tables, kind, position, sheet_id)?;
            }
            Command::Paste {
                id,
                row,
                col,
                values,
                expected_values,
            } => {
                crate::table_edit::paste(tables, &id, row, col, values, expected_values)?;
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
