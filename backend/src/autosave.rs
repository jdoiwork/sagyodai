//! 確定した操作だけを原子的に保存する。ロックはプロセス終了時にOSが解放する。
use crate::{
    application::Project,
    domain::{Request, Snapshot},
    storage,
};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Recovery {
    version: u32,
    revision: u64,
    document: serde_json::Value,
}

fn companion(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    name.into()
}

pub struct Autosave {
    path: PathBuf,
    _lock: File,
}

impl Autosave {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        fs::create_dir_all(parent).map_err(|e| format!("自動保存先を作成できません: {e}"))?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(companion(&path, ".lock"))
            .map_err(|e| e.to_string())?;
        lock.try_lock()
            .map_err(|e| format!("自動保存先は別のサーバーが使用中か、ロックできません: {e}"))?;
        Ok(Self { path, _lock: lock })
    }

    pub fn load(&self) -> Result<Option<Project>, String> {
        let file = match File::open(&self.path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("自動保存を読み込めません: {e}")),
        };
        let mut bytes = Vec::new();
        file.take((storage::MAX_FILE_BYTES + 4097) as u64)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > storage::MAX_FILE_BYTES + 4096 {
            return Err("自動保存ファイルが容量上限を超えています。".into());
        }
        let recovery: Recovery = serde_json::from_slice(&bytes)
            .map_err(|e| format!("自動保存ファイルが不正です。上書きせず起動を中止します: {e}"))?;
        if recovery.version != 1 {
            return Err("未対応の自動保存形式です。".into());
        }
        Project::restore(recovery.document, recovery.revision).map(Some)
    }

    pub fn save(&self, project: &Project) -> Result<(), String> {
        let document = serde_json::from_slice(&project.export()?).map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec(&Recovery {
            version: 1,
            revision: project.snapshot().revision,
            document,
        })
        .map_err(|e| e.to_string())?;
        let temp = companion(&self.path, ".tmp");
        let write = || -> std::io::Result<()> {
            let mut file = File::create(&temp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            // 同じディレクトリ内で置換し、途中のJSONを復元対象にしない。
            fs::rename(&temp, &self.path)?;
            Ok(())
        };
        write().map_err(|e| format!("自動保存に失敗しました。操作は未反映です。保存先の空き容量・権限を確認して再適用してください: {e}"))?;
        // rename 成功後は保存済み。ディレクトリ同期の失敗でメモリだけを巻き戻さない。
        #[cfg(unix)]
        if let Err(e) = File::open(
            self.path
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new(".")),
        )
        .and_then(|f| f.sync_all())
        {
            eprintln!("自動保存先ディレクトリの同期に失敗しました: {e}");
        }
        Ok(())
    }

    pub fn apply(&self, project: &mut Project, request: Request) -> Result<Snapshot, String> {
        // 保存が成功するまで公開状態・Undo履歴を変更しない。
        let mut candidate = project.clone();
        let snapshot = candidate.apply(request)?;
        self.save(&candidate)?;
        *project = candidate;
        Ok(snapshot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Command;
    fn setup() -> (PathBuf, Autosave) {
        static ID: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "sagyodai-autosave-{}-{}",
            std::process::id(),
            ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        let store = Autosave::open(dir.join("project.json")).unwrap();
        (dir, store)
    }
    #[test]
    fn restores_committed_data_revision_and_undo_result() {
        let (dir, store) = setup();
        let mut p = Project::default();
        assert!(store.load().unwrap().is_none());
        store
            .apply(
                &mut p,
                Request {
                    expected_revision: 0,
                    command: Command::AddTable,
                },
            )
            .unwrap();
        let loaded = store.load().unwrap().unwrap();
        assert_eq!(loaded.export().unwrap(), p.export().unwrap());
        assert_eq!(loaded.snapshot().revision, 1);
        assert!(!loaded.snapshot().can_undo);
        store
            .apply(
                &mut p,
                Request {
                    expected_revision: 1,
                    command: Command::Undo,
                },
            )
            .unwrap();
        assert_eq!(store.load().unwrap().unwrap().snapshot().tables.len(), 1);
        assert!(Autosave::open(dir.join("project.json")).is_err());
        drop(store);
        assert!(Autosave::open(dir.join("project.json")).is_ok());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn failed_write_keeps_previous_file_state_and_history() {
        let (dir, store) = setup();
        let mut p = Project::default();
        store.save(&p).unwrap();
        let before = fs::read(&store.path).unwrap();
        fs::create_dir(companion(&store.path, ".tmp")).unwrap();
        assert!(
            store
                .apply(
                    &mut p,
                    Request {
                        expected_revision: 0,
                        command: Command::AddTable
                    }
                )
                .is_err()
        );
        assert_eq!(p.snapshot().revision, 0);
        assert!(!p.snapshot().can_undo);
        assert_eq!(p.snapshot().tables.len(), 1);
        assert_eq!(fs::read(&store.path).unwrap(), before);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn corrupt_recovery_is_not_silently_replaced() {
        let (dir, store) = setup();
        fs::write(&store.path, b"broken").unwrap();
        assert!(store.load().is_err());
        assert_eq!(fs::read(&store.path).unwrap(), b"broken");
        fs::remove_dir_all(dir).unwrap();
    }
}
