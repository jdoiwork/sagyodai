import { useEffect, useRef, useState } from "react";
import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Icon } from "../../components/Icon";

export function CsvSettings({ table }: { table: TableData }) {
  const { importCsv, dispatch, project, pending } = useProject();
  const fileInput = useRef<HTMLInputElement>(null);
  const [hasHeaders, setHasHeaders] = useState(table.csv?.hasHeaders ?? true);
  const [skipEmptyRows, setSkipEmptyRows] = useState(
    table.csv?.skipEmptyRows ?? false,
  );
  const [skipEmptyColumns, setSkipEmptyColumns] = useState(
    table.csv?.skipEmptyColumns ?? false,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(
    () => setHasHeaders(table.csv?.hasHeaders ?? true),
    [table.csv?.hasHeaders],
  );
  useEffect(() => {
    setSkipEmptyRows(table.csv?.skipEmptyRows ?? false);
    setSkipEmptyColumns(table.csv?.skipEmptyColumns ?? false);
  }, [table.csv?.skipEmptyRows, table.csv?.skipEmptyColumns]);
  async function read(file: File) {
    setBusy(true);
    setError("");
    try {
      if (file.size > 1024 * 1024)
        throw new Error("CSVファイルは1 MiB以内にしてください。");
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(
          await file.arrayBuffer(),
        );
      } catch {
        throw new Error(
          "UTF-8のCSVファイルを選んでください。文字コードを確認してください。",
        );
      }
      await importCsv({
        type: "importCsv",
        id: table.id,
        fileName: file.name,
        text,
        hasHeaders,
        skipEmptyRows,
        skipEmptyColumns,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "CSVを読み込めませんでした。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={`node-settings nodrag nopan nowheel${table.compact ? " node-settings-compact" : " display-settings"}`}
    >
      <span className="csv-file-name" title={table.csv?.fileName}>
        {table.csv?.fileName ?? "CSVファイル未選択"}
      </span>
      <div hidden={table.compact}>
        <div className="csv-import-options">
          <label>
            <input
              type="checkbox"
              checked={hasHeaders}
              disabled={busy}
              onChange={(e) => setHasHeaders(e.target.checked)}
            />
            1行目を列名として使う
          </label>
          <label>
            <input
              type="checkbox"
              checked={skipEmptyRows}
              disabled={busy}
              onChange={(e) => setSkipEmptyRows(e.target.checked)}
            />
            空行をスキップ
          </label>
          <label>
            <input
              type="checkbox"
              checked={skipEmptyColumns}
              disabled={busy}
              onChange={(e) => setSkipEmptyColumns(e.target.checked)}
            />
            空列をスキップ
          </label>
        </div>
        <p className="sort-hint">
          設定は次の読込に適用。空列はデータがすべて空の列です。
        </p>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          hidden
          aria-label={`${table.title} CSVファイル`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void read(file);
          }}
        />
        <div className="condition-actions">
          <button
            disabled={busy || pending > 0}
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="folder" />
            {busy ? "読み込み中…" : table.csv ? "CSVを選び直す" : "CSVを選択"}
          </button>
          <button
            className="action-danger"
            disabled={busy || project?.tables.length === 1}
            onClick={() => dispatch({ type: "removeNode", id: table.id })}
          >
            <Icon name="trash" />
            削除
          </button>
        </div>
        <p className="sort-hint">
          UTF-8・カンマ区切り／最大1 MiB・5000行・50列
        </p>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <span className="node-status">
        {table.csv
          ? `${table.rows.length} 行 × ${table.columns.length} 列`
          : "ファイルを選択してください"}
      </span>
    </div>
  );
}
