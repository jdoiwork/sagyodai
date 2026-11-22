//! 各行の指定列を置換する。途中で失敗した場合は結果を確定しない。
use crate::{
    domain::Table,
    storage::{MAX_CELL_BYTES, MAX_COLS},
};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Replacement {
    pub column: usize,
    pub regex: bool,
    pub pattern: String,
    pub replacement: String,
}
impl Replacement {
    pub fn validate(&self) -> Result<(), String> {
        if self.column >= MAX_COLS || self.pattern.len() > 1000 || self.replacement.len() > 1000 {
            return Err(
                "対象列は50列以内、検索・置換文字列は各1000バイト以内にしてください。".into(),
            );
        }
        Ok(())
    }
    pub fn rows(&self, source: &Table) -> Result<Vec<Vec<String>>, String> {
        self.validate()?;
        if self.column >= source.columns.len() {
            return Err("置換対象の列が入力にありません。".into());
        }
        if self.pattern.is_empty() {
            return Err("検索文字列を入力してください。".into());
        }
        let pattern = if self.regex {
            self.pattern.clone()
        } else {
            regex::escape(&self.pattern)
        };
        let re = regex::Regex::new(&pattern).map_err(|e| format!("正規表現が不正です: {e}"))?;
        let mut rows = source.rows.clone();
        for row in &mut rows {
            let value = &row[self.column];
            let mut output = String::new();
            let mut end = 0;
            for caps in re.captures_iter(value) {
                let matched = caps.get(0).ok_or("置換対象を取得できません。")?;
                append(&mut output, &value[end..matched.start()])?;
                if self.regex {
                    let mut expanded = String::new();
                    caps.expand(&self.replacement, &mut expanded);
                    append(&mut output, &expanded)?;
                } else {
                    append(&mut output, &self.replacement)?;
                }
                end = matched.end();
            }
            append(&mut output, &value[end..])?;
            row[self.column] = output;
        }
        Ok(rows)
    }
}
fn append(output: &mut String, part: &str) -> Result<(), String> {
    if output.len() + part.len() > MAX_CELL_BYTES {
        return Err("置換結果が1セル100000バイトの上限を超えます。".into());
    }
    output.push_str(part);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        application::Project,
        domain::{Command, Kind, Request},
    };
    fn run(p: &mut Project, command: Command) {
        p.apply(Request {
            expected_revision: p.snapshot().revision,
            command,
        })
        .unwrap();
    }
    #[test]
    fn literal_regex_captures_deletion_and_limits() {
        let mut source = crate::domain::sample_table("source".into(), 0);
        source.columns = vec!["文字".into(), "残す列".into()];
        source.rows = vec![vec!["赤.赤.001".into(), "元".into()]];
        let mut config = Replacement {
            column: 0,
            regex: false,
            pattern: ".".into(),
            replacement: "$1".into(),
        };
        assert_eq!(config.rows(&source).unwrap()[0], ["赤$1赤$1001", "元"]);
        config.regex = true;
        config.pattern = r"(?P<color>赤)\.(\w+)".into();
        config.replacement = "${2}-${color}-$$".into();
        assert_eq!(config.rows(&source).unwrap()[0][0], "赤-赤-$.001");
        config.pattern = "[".into();
        assert!(config.rows(&source).is_err());
        config.pattern = "^".into();
        config.replacement = "先頭".into();
        assert_eq!(config.rows(&source).unwrap()[0][0], "先頭赤.赤.001");
        config.pattern = "赤".into();
        config.replacement.clear();
        assert_eq!(config.rows(&source).unwrap()[0][0], "..001");
        source.rows[0][0] = "a".repeat(MAX_CELL_BYTES);
        config.pattern = "a".into();
        config.replacement = "aa".into();
        assert!(config.rows(&source).is_err());
    }
    #[test]
    fn pipeline_manual_error_recovery_save_and_undo() {
        let mut p = Project::default();
        for kind in [Kind::Replace, Kind::Display] {
            run(
                &mut p,
                Command::AddNode {
                    kind,
                    position: None,
                    sheet_id: None,
                },
            );
        }
        run(
            &mut p,
            Command::Connect {
                id: "table-2".into(),
                source: Some("table-1".into()),
            },
        );
        run(
            &mut p,
            Command::Connect {
                id: "table-3".into(),
                source: Some("table-2".into()),
            },
        );
        let config = Replacement {
            column: 0,
            regex: false,
            pattern: "ノート".into(),
            replacement: "手帳".into(),
        };
        run(
            &mut p,
            Command::SetReplacement {
                id: "table-2".into(),
                config: config.clone(),
            },
        );
        assert_eq!(p.snapshot().tables[2].rows[0][0], "手帳");
        assert_eq!(p.snapshot().tables[0].rows[0][0], "ノート");
        let saved = p.export().unwrap();
        let mut p = Project::restore(serde_json::from_slice(&saved).unwrap(), 0).unwrap();
        run(
            &mut p,
            Command::SetReplacement {
                id: "table-2".into(),
                config: Replacement {
                    regex: true,
                    pattern: "[".into(),
                    ..config.clone()
                },
            },
        );
        assert!(p.snapshot().tables[1].error.is_some());
        assert_eq!(p.snapshot().tables[2].rows[0][0], "手帳");
        run(
            &mut p,
            Command::SetReplacement {
                id: "table-2".into(),
                config: config.clone(),
            },
        );
        assert!(p.snapshot().tables[1].error.is_none());
        run(
            &mut p,
            Command::Configure {
                id: "table-2".into(),
                filter: None,
                manual: true,
            },
        );
        run(
            &mut p,
            Command::SetReplacement {
                id: "table-2".into(),
                config: Replacement {
                    replacement: "新しい手帳".into(),
                    ..config
                },
            },
        );
        assert!(p.snapshot().tables[1].stale);
        assert_eq!(p.snapshot().tables[2].rows[0][0], "手帳");
        run(
            &mut p,
            Command::Run {
                id: "table-2".into(),
            },
        );
        assert_eq!(p.snapshot().tables[2].rows[0][0], "新しい手帳");
        run(&mut p, Command::Undo);
        assert_eq!(p.snapshot().tables[2].rows[0][0], "手帳");
        run(&mut p, Command::Redo);
        assert_eq!(p.snapshot().tables[2].rows[0][0], "新しい手帳");
    }
}
