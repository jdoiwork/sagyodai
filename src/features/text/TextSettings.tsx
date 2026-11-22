import { useRef, useState } from "react";
import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Icon } from "../../components/Icon";

export function TextSettings({ table }: { table: TableData }) {
  const { importSource, dispatch, project, pending } = useProject();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function read(file: File) {
    if (busy || pending > 0) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 1024 * 1024)
        throw new Error("テキストファイルは1 MiB以内にしてください。");
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(
          await file.arrayBuffer(),
        );
      } catch {
        throw new Error(
          "UTF-8のテキストファイルを選んでください。文字コードを確認してください。",
        );
      }
      await importSource({
        type: "importText",
        id: table.id,
        fileName: file.name,
        text,
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "テキストを読み込めませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="text-file-actions nodrag nopan">
      <span className="csv-file-name" title={table.textSource?.fileName}>
        {table.textSource?.fileName ?? "テキストファイル未選択"}
      </span>
      <div hidden={table.compact}>
        <input
          ref={input}
          type="file"
          hidden
          aria-label={`${table.title} テキストファイル`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void read(file);
          }}
        />
        <div className="condition-actions">
          <button
            disabled={busy || pending > 0}
            onClick={() => input.current?.click()}
          >
            <Icon name="folder" />
            {busy
              ? "読み込み中…"
              : table.textSource
                ? "ファイルを選び直す"
                : "ファイルを選択"}
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
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
