//! evalを使わない限定的なJSONパス。ドットキー、非負インデックス、JSON文字列キー。
use serde_json::Value;
#[derive(Debug, PartialEq)]
pub enum Step {
    Key(String),
    Index(usize),
}
pub fn parse(path: &str) -> Result<Vec<Step>, String> {
    if path.is_empty() {
        return Ok(vec![Step::Key(String::new())]);
    }
    let bytes = path.as_bytes();
    let mut i = 0;
    let mut steps = Vec::new();
    while i < bytes.len() {
        if !steps.is_empty() {
            if bytes[i] == b'.' {
                i += 1;
                if i == bytes.len() || bytes[i] == b'[' {
                    return Err("ドットの後にキー名を指定してください。".into());
                }
            } else if bytes[i] != b'[' {
                return Err("キーの間には . または [ ] を使ってください。".into());
            }
        }
        if bytes[i] == b'[' {
            i += 1;
            if bytes.get(i) == Some(&b'"') {
                let start = i;
                i += 1;
                while i < bytes.len() && bytes[i] != b'"' {
                    if bytes[i] == b'\\' {
                        i += 1;
                    }
                    i += 1;
                }
                if i >= bytes.len() {
                    return Err("引用符を閉じてください。".into());
                }
                i += 1;
                let key: String = serde_json::from_str(&path[start..i])
                    .map_err(|_| "キーの引用符・エスケープが不正です。")?;
                steps.push(Step::Key(key));
            } else {
                let start = i;
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
                let n = path[start..i]
                    .parse::<usize>()
                    .map_err(|_| "配列には0以上の整数インデックスを指定してください。")?;
                if n as u64 > 9_007_199_254_740_991 {
                    return Err("配列インデックスが大きすぎます。".into());
                }
                steps.push(Step::Index(n));
            }
            if bytes.get(i) != Some(&b']') {
                return Err("角括弧を ] で閉じてください。".into());
            }
            i += 1;
        } else {
            let start = i;
            while i < bytes.len() && bytes[i] != b'.' && bytes[i] != b'[' {
                i += 1;
            }
            let key = &path[start..i];
            if key.is_empty()
                || key
                    .chars()
                    .any(|c| c.is_whitespace() || matches!(c, ']' | '"' | '\\'))
            {
                return Err("記号や空白を含むキーは [\"キー名\"] で指定してください。".into());
            }
            steps.push(Step::Key(key.into()));
        }
    }
    Ok(steps)
}
pub fn select<'a>(value: &'a Value, path: &str) -> Result<&'a Value, String> {
    let mut current = value;
    for step in parse(path)? {
        current = match step {
            Step::Key(key) => current
                .as_object()
                .ok_or("指定階層はオブジェクトではありません。")?
                .get(&key)
                .ok_or_else(|| format!("キー「{key}」がありません。"))?,
            Step::Index(index) => current
                .as_array()
                .ok_or("指定階層は配列ではありません。")?
                .get(index)
                .ok_or_else(|| format!("配列のインデックス[{index}]は範囲外です。"))?,
        };
    }
    Ok(current)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nested_paths_and_literal_keys() {
        let v = serde_json::json!({"chapters":[{"title":"日本語","a.b":{"":null,"x\"y":3}}],"a.b":7,"__proto__":true});
        for (p, want) in [
            ("chapters[0].title", serde_json::json!("日本語")),
            (r#"chapters[0]["a.b"][""]"#, Value::Null),
            (r#"chapters[0]["a.b"]["x\"y"]"#, serde_json::json!(3)),
            (r#"["a.b"]"#, serde_json::json!(7)),
            ("__proto__", serde_json::json!(true)),
        ] {
            assert_eq!(select(&v, p).unwrap(), &want);
        }
        assert_eq!(
            select(&serde_json::json!([1]), "[0]").unwrap(),
            &serde_json::json!(1)
        );
        for p in [
            "chapters[1]",
            "chapters.title",
            "chapters[0].title.x",
            "missing",
        ] {
            assert!(select(&v, p).is_err());
        }
        for p in [
            "a.",
            "a..b",
            "a.[0]",
            "a[-1]",
            "a[1.2]",
            "a[]",
            "a[0]b",
            r#"a["bad\q"]"#,
            "a[9007199254740992]",
            "a[",
            "a]",
        ] {
            assert!(parse(p).is_err(), "{p}");
        }
    }
}
