import { Icon } from "../../components/Icon";
import { useRef, useState } from "react";
import { useProject } from "../../app/ProjectContext";
const MAX_FILE_BYTES = 128 * 1024 * 1024;
export function ProjectFiles() {
  const { project, openProject, prepareExport, markExported, dirty, pending } =
    useProject();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("project.sagyodai.json");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  function report(error: unknown) {
    setFailed(true);
    setMessage(
      error instanceof Error ? error.message : "ファイル操作に失敗しました。",
    );
  }
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const { blob, revision } = await prepareExport();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      markExported(revision);
      setFailed(false);
      setMessage("ダウンロードを開始しました。保存先を確認してください。");
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function open(file: File) {
    setBusy(true);
    setMessage("");
    try {
      if (file.size > MAX_FILE_BYTES)
        throw new Error("プロジェクトファイルの上限は128 MiBです。");
      let document: unknown;
      try {
        document = JSON.parse(await file.text());
      } catch {
        throw new Error(
          "JSON として読み込めませんでした。現在の表は変更していません。",
        );
      }
      if (
        !window.confirm(
          "ファイルの内容で現在の表を置き換えます。よろしいですか？\n置き換え後も「元に戻す」で直前の状態に戻せます。",
        )
      )
        return;
      await openProject(document);
      setName(
        file.name.endsWith(".sagyodai.json")
          ? file.name
          : "project.sagyodai.json",
      );
      setFailed(false);
      setMessage(`${file.name} を開きました。`);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="project-files">
      <span className="session-note">
        {dirty ? "未書き出しの変更あり" : "読み込み・書き出し済み"}
      </span>
      <input
        ref={input}
        type="file"
        accept=".json,.sagyodai.json,application/json"
        aria-label="プロジェクトファイル"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void open(file);
        }}
      />
      <button
        disabled={!project || busy || pending > 0}
        onClick={() => input.current?.click()}
      >
        <Icon name="folder" />
        開く
      </button>
      <button
        className="save-button"
        disabled={!project || busy}
        onClick={() => void save()}
      >
        <Icon name="save" />
        {busy ? "処理中…" : "保存"}
      </button>
      {message && (
        <div
          className={failed ? "file-message failure" : "file-message"}
          role={failed ? "alert" : "status"}
        >
          {message}
          <button
            aria-label="ファイル通知を閉じる"
            onClick={() => setMessage("")}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
    </div>
  );
}
