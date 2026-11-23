import { useState } from "react";
import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Icon } from "../../components/Icon";

export function HttpSettings({ table }: { table: TableData }) {
  const { importSource, dispatch, pending, project } = useProject();
  const saved = table.http?.config ?? {
    url: "",
    method: "GET",
    headers: "",
    body: "",
  };
  const [draft, setDraft] = useState(saved);
  const [original, setOriginal] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 未編集なら他タブ・Undoの設定変更も表示する。編集中の入力は残す。
  if (JSON.stringify(saved) !== JSON.stringify(original)) {
    if (JSON.stringify(draft) === JSON.stringify(original)) setDraft(saved);
    setOriginal(saved);
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const update = (key: keyof typeof draft, value: string) => {
    setDraft({ ...draft, [key]: value });
    setError("");
  };
  async function request() {
    setError("");
    try {
      const url = new URL(draft.url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error();
    } catch {
      setError(
        "http:// または https:// で始まるURLを入力してください。認証情報は送信ヘッダーに指定します。",
      );
      return;
    }
    setBusy(true);
    try {
      await importSource({ type: "fetchHttp", id: table.id, config: draft });
    } catch (e) {
      setError(e instanceof Error ? e.message : "リクエストに失敗しました。");
    } finally {
      setBusy(false);
    }
  }
  if (table.compact)
    return (
      <div
        className="http-summary nodrag nopan"
        title={table.error ?? table.http?.response?.statusLine}
      >
        {table.http?.output ?? "body"} ·{" "}
        {table.error
          ? "取得エラー（前回の結果を保持）"
          : (table.http?.response?.statusLine ?? "未取得")}
      </div>
    );
  return (
    <div className="http-settings nodrag nopan nowheel">
      {!table.compact && (
        <>
          <div className="http-url">
            <select
              aria-label={`${table.title} メソッド`}
              value={draft.method}
              disabled={busy || pending > 0}
              onChange={(e) => update("method", e.target.value)}
            >
              {["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].map(
                (m) => (
                  <option key={m}>{m}</option>
                ),
              )}
            </select>
            <input
              aria-label={`${table.title} URL`}
              aria-invalid={!!error}
              placeholder="https://example.com/data.json"
              value={draft.url}
              onChange={(e) => update("url", e.target.value)}
              disabled={busy || pending > 0}
            />
          </div>
          <details>
            <summary>送信ヘッダー・本文</summary>
            <label>
              送信ヘッダー
              <textarea
                aria-label={`${table.title} 送信ヘッダー`}
                placeholder="Accept: application/json"
                value={draft.headers}
                onChange={(e) => update("headers", e.target.value)}
                disabled={busy || pending > 0}
              />
            </label>
            <label>
              送信本文
              <textarea
                aria-label={`${table.title} 送信本文`}
                value={draft.body}
                onChange={(e) => update("body", e.target.value)}
                disabled={busy || pending > 0}
              />
            </label>
            <small>設定・レスポンスはプロジェクトに保存されます。</small>
          </details>
          {dirty && (
            <span className="condition-dirty">未取得の設定変更があります</span>
          )}
        </>
      )}
      <div className="condition-actions">
        <label>
          出力{" "}
          <select
            aria-label={`${table.title} 出力`}
            value={table.http?.output ?? "body"}
            disabled={busy || pending > 0}
            onChange={(e) => {
              setError("");
              void importSource({
                type: "setHttpOutput",
                id: table.id,
                output: e.target.value as "raw" | "headers" | "body",
              }).catch((e) =>
                setError(
                  e instanceof Error ? e.message : "出力を変更できません。",
                ),
              );
            }}
          >
            <option value="raw">raw</option>
            <option value="headers">headers</option>
            <option value="body">body</option>
          </select>
        </label>
        <button disabled={busy || pending > 0} onClick={() => void request()}>
          <Icon name="refresh" />
          {busy ? "取得中…" : "リクエスト"}
        </button>
        <button
          className="action-danger"
          disabled={busy || pending > 0 || project?.tables.length === 1}
          onClick={() => dispatch({ type: "removeNode", id: table.id })}
        >
          <Icon name="trash" />
          削除
        </button>
      </div>
      {table.http?.response && (
        <div role="status">
          {table.http.response.statusLine} · {table.rows.length} 行
        </div>
      )}
      {(error || table.error) && (
        <div className="inline-error" role="alert">
          {error || table.error}
        </div>
      )}
    </div>
  );
}
