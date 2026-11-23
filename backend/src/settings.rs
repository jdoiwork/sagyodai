//! 実行環境のお気に入りはプロジェクト外に保存し、既存ノードには遡及適用しない。
use crate::{ApiError, error};
use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Favorite {
    id: String,
    name: String,
    program: String,
    cwd: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    version: u32,
    revision: u64,
    favorites: Vec<Favorite>,
}
struct Store {
    path: PathBuf,
    value: Settings,
}
impl Store {
    fn open(path: PathBuf) -> Result<Self, String> {
        let value = match std::fs::File::open(&path) {
            Ok(f) => {
                let mut bytes = Vec::new();
                f.take(262145)
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())?;
                if bytes.len() > 262144 {
                    return Err("設定ファイルが大きすぎます。".into());
                }
                serde_json::from_slice(&bytes).map_err(|e| format!("設定を読めません: {e}"))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Settings {
                version: 1,
                revision: 0,
                favorites: vec![],
            },
            Err(e) => return Err(e.to_string()),
        };
        validate(&value)?;
        Ok(Self { path, value })
    }
    fn save(&mut self, mut next: Settings) -> Result<Settings, String> {
        validate(&next)?;
        if next.revision != self.value.revision {
            return Err("別の画面で設定が変更されました。閉じて開き直してください。".into());
        }
        next.revision = next
            .revision
            .checked_add(1)
            .ok_or("設定の更新回数が上限です。")?;
        let bytes = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
        if bytes.len() > 262144 {
            return Err("設定ファイルの上限は256 KiBです。".into());
        }
        let temp = self.path.with_extension("settings.tmp");
        let mut file = std::fs::File::create(&temp).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .and_then(|_| std::fs::rename(&temp, &self.path))
            .map_err(|e| format!("設定を保存できません: {e}"))?;
        self.value = next.clone();
        Ok(next)
    }
}
fn validate(value: &Settings) -> Result<(), String> {
    if value.version != 1 {
        return Err("未対応の設定形式です。".into());
    }
    if value.favorites.len() > 50 {
        return Err("お気に入りは50個までです。".into());
    }
    let mut ids = std::collections::HashSet::new();
    for f in &value.favorites {
        if f.id.is_empty()
            || f.id.len() > 128
            || !ids.insert(&f.id)
            || f.name.trim().is_empty()
            || f.name.len() > 256
        {
            return Err("お気に入りの名前・IDが不正です。".into());
        }
        for p in [&f.program, &f.cwd] {
            if p.len() > 4096 || p.contains('\0') || (!p.is_empty() && !Path::new(p).is_absolute())
            {
                return Err("パスは絶対パスで指定してください。".into());
            }
        }
        if f.program.is_empty() {
            return Err("実行プログラムを指定してください。".into());
        }
    }
    Ok(())
}
pub fn router(path: PathBuf) -> Result<Router, String> {
    let store = Arc::new(Mutex::new(Store::open(path)?));
    Ok(Router::new()
        .route("/api/settings", get(read).post(save))
        .route("/api/paths", post(paths))
        .with_state(store))
}
async fn read(State(store): State<Arc<Mutex<Store>>>) -> Result<Json<Settings>, ApiError> {
    Ok(Json(
        store
            .lock()
            .map_err(|_| error("設定を取得できません。"))?
            .value
            .clone(),
    ))
}
async fn save(
    State(store): State<Arc<Mutex<Store>>>,
    Json(next): Json<Settings>,
) -> Result<Json<Settings>, ApiError> {
    Ok(Json(
        store
            .lock()
            .map_err(|_| error("設定を更新できません。"))?
            .save(next)
            .map_err(error)?,
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PathRequest {
    path: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    name: String,
    path: String,
    directory: bool,
}
#[derive(Serialize)]
struct Listing {
    path: String,
    parent: Option<String>,
    entries: Vec<Entry>,
    truncated: bool,
}
fn listing(input: String) -> Result<Listing, String> {
    let path = if input.is_empty() {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or(PathBuf::from("/"))
    } else {
        PathBuf::from(input)
    };
    if !path.is_absolute() {
        return Err("絶対パスを指定してください。".into());
    }
    // 仮想環境のpythonはシンボリックリンクでも、そのパスを保持する必要がある。
    let path = if path.is_file() {
        path.parent()
            .ok_or("親フォルダがありません。")?
            .to_path_buf()
    } else {
        path
    };
    let dir = std::fs::read_dir(&path).map_err(|e| format!("フォルダを開けません: {e}"))?;
    let mut entries = Vec::new();
    let mut truncated = false;
    for item in dir {
        let item = item.map_err(|e| e.to_string())?;
        if entries.len() >= 2000 {
            truncated = true;
            break;
        }
        let p = item.path();
        let Some(name) = item.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Some(s) = p.to_str() else { continue };
        if p.is_dir() || p.is_file() {
            entries.push(Entry {
                name,
                path: s.into(),
                directory: p.is_dir(),
            });
        }
    }
    entries.sort_by(|a, b| b.directory.cmp(&a.directory).then(a.name.cmp(&b.name)));
    Ok(Listing {
        path: path.to_string_lossy().into(),
        parent: path.parent().map(|p| p.to_string_lossy().into()),
        entries,
        truncated,
    })
}
async fn paths(Json(request): Json<PathRequest>) -> Result<Json<Listing>, ApiError> {
    if request.path.len() > 4096 {
        return Err(error("パスが長すぎます。"));
    }
    tokio::task::spawn_blocking(move || listing(request.path))
        .await
        .map_err(error)?
        .map(Json)
        .map_err(error)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn save_restore_conflict_and_failure() {
        let dir = std::env::temp_dir().join(format!("sagyodai-settings-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let mut store = Store::open(path.clone()).unwrap();
        let old = store.value.clone();
        let mut next = old.clone();
        next.favorites.push(Favorite {
            id: "python".into(),
            name: "日本語環境".into(),
            program: "/tmp/venv/bin/python".into(),
            cwd: "".into(),
        });
        store.save(next).unwrap();
        assert_eq!(
            Store::open(path.clone()).unwrap().value.favorites[0].name,
            "日本語環境"
        );
        assert!(store.save(old).is_err());
        let bytes = std::fs::read(&path).unwrap();
        std::fs::create_dir(path.with_extension("settings.tmp")).unwrap();
        assert!(store.save(store.value.clone()).is_err());
        assert_eq!(bytes, std::fs::read(path).unwrap());
        assert_eq!(store.value.revision, 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn paths_include_hidden_environments_and_preserve_symlinks() {
        let dir = std::env::temp_dir().join(format!("sagyodai-paths-{}", std::process::id()));
        std::fs::create_dir_all(dir.join(".venv")).unwrap();
        std::fs::write(dir.join("script.py"), "").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(dir.join("script.py"), dir.join("python")).unwrap();
        let result = listing(dir.to_string_lossy().into()).unwrap();
        assert!(
            result
                .entries
                .iter()
                .any(|e| e.name == ".venv" && e.directory)
        );
        assert!(
            result
                .entries
                .iter()
                .any(|e| e.name == "script.py" && !e.directory)
        );
        assert!(listing("relative".into()).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
