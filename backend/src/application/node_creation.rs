//! ノード種別ごとの初期値と、一意なID・初期配置の決定。
use super::Project;
use crate::domain::{Filter, Kind, Operator, Position, Table, sample_table};
use crate::storage::MAX_NODES;

impl Project {
    pub(super) fn add_node(
        &mut self,
        tables: &mut Vec<Table>,
        kind: Kind,
        position: Option<Position>,
        sheet_id: Option<String>,
    ) -> Result<(), String> {
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
        let next_x = tables
            .iter()
            .map(|table| table.x + table.width)
            .fold(0.0_f64, f64::max)
            + 120.0;
        let mut table = sample_table(format!("table-{}", self.next_id), tables.len());
        table.sheet_id = sheet_id;
        if kind != Kind::Input {
            table.kind = kind;
            table.title = format!("{} {}", node_label(kind), self.next_id);
            table.column_schema.clear();
            table.output = None;
            table.columns.clear();
            table.rows.clear();
            (table.width, table.height) = node_dimensions(kind);
            table.x = next_x;
            table.y = 100.0;
            table.stale = kind != Kind::Note;
            match kind {
                Kind::TextDisplay | Kind::TreeDisplay => {
                    table.text_display = crate::text_source::TextDisplay::Plain;
                }
                Kind::JsonSelect => table.json_key = Some(String::new()),
                Kind::Script => table.script = Some(Default::default()),
                Kind::Http => table.http = Some(Default::default()),
                Kind::Note => table.note = Some(Default::default()),
                Kind::Replace => table.replacement = Some(Default::default()),
                Kind::Aggregate => table.group = Some(Default::default()),
                Kind::Filter => {
                    table.filter = Some(Filter {
                        values: vec![],
                        column: 0,
                        operator: Operator::Equals,
                        value: String::new(),
                    });
                }
                _ => {}
            }
        }
        if let Some(position) = position {
            table.x = position.x;
            table.y = position.y;
        }
        tables.push(table);
        self.next_id += 1;
        Ok(())
    }
}

fn node_label(kind: Kind) -> &'static str {
    match kind {
        Kind::Input => "表",
        Kind::Convert => "型変換",
        Kind::Script => "スクリプト",
        Kind::Note => "メモ",
        Kind::Replace => "置換",
        Kind::JsonSelect => "JSONキー抽出",
        Kind::JsonTable => "JSONを表に変換",
        Kind::TreeDisplay => "結果ツリー",
        Kind::TextDisplay => "結果テキスト",
        Kind::Http => "HTTP",
        Kind::Text => "テキスト",
        Kind::Csv => "CSV",
        Kind::Filter => "フィルタ",
        Kind::Aggregate => "集計",
        Kind::Sort => "ソート",
        Kind::Union => "結合",
        Kind::Display => "結果表",
    }
}

fn node_dimensions(kind: Kind) -> (f64, f64) {
    match kind {
        Kind::Display | Kind::Csv => (760.0, 390.0),
        Kind::Union => (440.0, 360.0),
        Kind::Sort | Kind::JsonSelect | Kind::JsonTable => (520.0, 360.0),
        Kind::Aggregate | Kind::Replace | Kind::TextDisplay | Kind::TreeDisplay => (520.0, 480.0),
        Kind::Script => (580.0, 700.0),
        Kind::Http => (520.0, 560.0),
        _ => (400.0, 360.0),
    }
}
