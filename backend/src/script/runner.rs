//! パイプを並行処理し、停止時にはプロセスグループを終了・回収する。
use super::{Config, Data, MAX_BYTES, decode_output};
use std::{
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    sync::watch,
};
pub const MAX_LOG: usize = 64 * 1024;
#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub log: String,
    pub log_truncated: bool,
}
async fn output(mut pipe: impl AsyncRead + Unpin) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut buffer = [0; 8192];
    loop {
        let n = pipe.read(&mut buffer).await.map_err(|e| e.to_string())?;
        if n == 0 {
            return Ok(bytes);
        }
        if bytes.len() + n > MAX_BYTES {
            return Err("標準出力が10 MiBを超えました。".into());
        }
        bytes.extend_from_slice(&buffer[..n]);
    }
}
async fn logs(
    mut pipe: impl AsyncRead + Unpin,
    progress: Arc<Mutex<Progress>>,
) -> Result<(), String> {
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        let n = pipe.read(&mut buffer).await.map_err(|e| e.to_string())?;
        if n == 0 {
            return Ok(());
        }
        let take = n.min(MAX_LOG - bytes.len());
        bytes.extend_from_slice(&buffer[..take]);
        if let Ok(mut p) = progress.lock() {
            p.log = String::from_utf8_lossy(&bytes).into_owned();
            p.log_truncated |= take < n;
        }
    }
}
struct Group(u32);
impl Group {
    fn signal(&self, signal: i32) {
        // この実行で新設したグループにのみ送信する。子を回収する前に終了処理する。
        #[cfg(unix)]
        unsafe {
            libc::kill(-(self.0 as i32), signal);
        }
    }
}
impl Drop for Group {
    fn drop(&mut self) {
        self.signal(libc::SIGKILL);
    }
}

pub async fn execute(
    config: &Config,
    input: Vec<u8>,
    mut cancel: watch::Receiver<bool>,
    progress: Arc<Mutex<Progress>>,
) -> Result<Data, String> {
    config.validate()?;
    if *cancel.borrow() {
        return Err("キャンセルしました。".into());
    }
    let mut command = tokio::process::Command::new(&config.program);
    command
        .arg(&config.script_path)
        .args(&config.args)
        .current_dir(&config.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // 接続元クライアントの秘密情報を無条件には継承しない。
    command.env_clear();
    for name in ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command
        .spawn()
        .map_err(|e| format!("プロセスを起動できません: {e}"))?;
    let group = Group(child.id().ok_or("プロセスIDを取得できません。")?);
    let mut stdin = child.stdin.take().ok_or("標準入力を取得できません。")?;
    let stdout = child.stdout.take().ok_or("標準出力を取得できません。")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("標準エラー出力を取得できません。")?;
    let work = async {
        let (bytes, (), (), status) = tokio::try_join!(
            output(stdout),
            logs(stderr, progress),
            async {
                stdin
                    .write_all(&input)
                    .await
                    .map_err(|e| format!("標準入力への書き込みに失敗しました: {e}"))?;
                drop(stdin);
                Ok(())
            },
            async { child.wait().await.map_err(|e| e.to_string()) }
        )?;
        if !status.success() {
            return Err(format!("外部プロセスが異常終了しました: {status}"));
        }
        decode_output(&bytes, config.output_mode, config.output_row_format)
    };
    let result = tokio::select! {
        result=work=>result,
        _=cancel.changed()=>Err("キャンセルしました。".into()),
        _=tokio::time::sleep(Duration::from_secs(config.timeout_seconds))=>Err("制限時間を超えました。".into()),
    };
    group.signal(libc::SIGTERM);
    if result.is_err() {
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    group.signal(libc::SIGKILL);
    let _ = child.wait().await;
    // 終了処理後にもう一度シグナルを送らない。
    std::mem::forget(group);
    result
}
