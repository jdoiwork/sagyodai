import { FavoritePicker } from "../settings/AppSettings";
import { PathField } from "../settings/PathField";
import { useEffect, useState } from "react";
import { z } from "zod";
import { type TableData, type ScriptConfig } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { createsCycle } from "../../validation/input";
import { scriptRequest, runSchema, type ScriptRun } from "./api";
export function ScriptSettings({ table }: { table: TableData }) {
  const { project, dispatch, pending } = useProject();
  const saved = table.script?.config ?? {
    program: "",
    scriptPath: "",
    args: [],
    cwd: "",
    timeoutSeconds: 30,
  };
  const [draft, setDraft] = useState(saved);
  const [original, setOriginal] = useState(saved);
  const [args, setArgs] = useState(saved.args.join("\n"));
  const [error, setError] = useState("");
  const [source, setSource] = useState("");
  const [allow, setAllow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<ScriptRun | null>(null);
  const dirty =
    JSON.stringify({ ...draft, args: args ? args.split("\n") : [] }) !==
    JSON.stringify(saved);
  if (JSON.stringify(saved) !== JSON.stringify(original)) {
    if (
      JSON.stringify(draft) === JSON.stringify(original) &&
      args === original.args.join("\n")
    ) {
      setDraft(saved);
      setArgs(saved.args.join("\n"));
    }
    setOriginal(saved);
    setSource("");
    setAllow(false);
  }
  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const next = await scriptRequest("status", { id: table.id }, runSchema);
        if (!stopped) setRun(next);
      } catch (e) {
        if (!stopped)
          setError(e instanceof Error ? e.message : "状態取得に失敗しました。");
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [table.id]);
  const update = <K extends keyof ScriptConfig>(
    key: K,
    value: ScriptConfig[K],
  ) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setError("");
  };
  async function action(name: "start" | "cancel" | "source") {
    if (!project) return;
    setBusy(true);
    setError("");
    try {
      if (name === "source") {
        const result = await scriptRequest(
          "source",
          { id: table.id },
          z.object({ text: z.string() }),
        );
        setSource(result.text);
      } else if (name === "cancel") {
        await scriptRequest(
          "cancel",
          { id: table.id, runId: run?.runId },
          z.object({ cancelRequested: z.boolean() }),
        );
        setAllow(false);
      } else {
        setRun(
          await scriptRequest(
            "start",
            {
              id: table.id,
              expectedRevision: project.revision,
              allowAutomatic: allow,
            },
            runSchema,
          ),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作に失敗しました。");
    } finally {
      setBusy(false);
    }
  }
  const states = {
    idle: "未実行",
    running: "実行中",
    succeeded: "成功",
    failed: "失敗",
    canceled: "キャンセル",
    discarded: "古い結果を破棄",
  };
  return (
    <div className="script-settings nodrag nopan nowheel">
      {!table.compact && (
        <>
          <label>
            入力元
            <select
              aria-label={`${table.title} 入力元`}
              value={table.source ?? ""}
              onChange={(e) =>
                dispatch({
                  type: "connect",
                  id: table.id,
                  source: e.target.value || null,
                })
              }
            >
              <option value="">入力なし（標準入力は空）</option>
              {project?.tables
                .filter((t) => t.id !== table.id)
                .map((t) => (
                  <option
                    key={t.id}
                    value={t.id}
                    disabled={createsCycle(project!.tables, table.id, t.id)}
                  >
                    {t.title}
                  </option>
                ))}
            </select>
          </label>
          <FavoritePicker
            onSelect={(f) => {
              setDraft((d) => ({
                ...d,
                program: f.program,
                ...(f.cwd ? { cwd: f.cwd } : {}),
              }));
              setError("");
            }}
          />
          <PathField
            label="実行プログラム"
            value={draft.program}
            placeholder="/path/to/.venv/bin/python"
            onChange={(v) => update("program", v)}
          />
          <PathField
            label="スクリプトのパス"
            value={draft.scriptPath}
            placeholder="/path/to/transform.py"
            onChange={(v) => update("scriptPath", v)}
          />
          <PathField
            label="作業フォルダ"
            directory
            value={draft.cwd}
            placeholder="/path/to/project"
            onChange={(v) => update("cwd", v)}
          />
          <label>
            追加引数（1行に1個）
            <textarea
              aria-label="追加引数"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </label>
          <label>
            制限時間（秒）
            <input
              aria-label="制限時間"
              type="number"
              min={1}
              max={3600}
              value={draft.timeoutSeconds}
              onChange={(e) => update("timeoutSeconds", Number(e.target.value))}
            />
          </label>
          <div className="condition-actions">
            <button
              disabled={!dirty || pending > 0}
              onClick={() =>
                dispatch({
                  type: "setScript",
                  id: table.id,
                  config: { ...draft, args: args ? args.split("\n") : [] },
                })
              }
            >
              設定を適用
            </button>
            {dirty && <span>未適用の変更あり</span>}
          </div>
          <label>
            <input
              type="checkbox"
              checked={table.manual}
              onChange={(e) =>
                dispatch({
                  type: "configure",
                  id: table.id,
                  filter: null,
                  manual: e.target.checked,
                })
              }
            />
            手動更新
          </label>
          <label>
            <input
              type="checkbox"
              checked={allow}
              onChange={(e) => setAllow(e.target.checked)}
            />
            この設定の自動実行も許可する（コア終了まで）
          </label>
          <small>
            外部プログラムはファイルやネットワークにアクセスできます。外部への変更はUndoできません。
          </small>
          <div className="condition-actions">
            <button
              disabled={
                dirty || busy || pending > 0 || run?.state === "running"
              }
              onClick={() => void action("start")}
            >
              外部スクリプトを実行
            </button>
            <button
              disabled={
                busy ||
                !run?.runId ||
                !(run.state === "running" || run.automaticAllowed)
              }
              onClick={() => void action("cancel")}
            >
              停止・自動実行を解除
            </button>
            <button
              disabled={dirty || busy}
              onClick={() => void action("source")}
            >
              内容を表示
            </button>
            <button
              disabled={project?.tables.length === 1}
              onClick={() => dispatch({ type: "removeNode", id: table.id })}
            >
              削除
            </button>
          </div>
          {source && (
            <details open>
              <summary>スクリプト（読み取り専用）</summary>
              <pre>{source}</pre>
            </details>
          )}
          {run && (
            <details>
              <summary>
                実行ログ{run.logTruncated ? "（上限で省略）" : ""}
              </summary>
              <pre>{run.log || "ログなし"}</pre>
            </details>
          )}
        </>
      )}
      <div role="status">
        {run ? states[run.state] : "状態を取得中"} ·{" "}
        {run?.automaticAllowed ? "自動実行を許可済み" : "実行操作が必要"} ·{" "}
        {table.rows.length}行{table.stale ? " · 更新待ち" : ""}
      </div>
      {(error || run?.message || table.error) && (
        <div role="alert" className="inline-error">
          {error || run?.message || table.error}
        </div>
      )}
    </div>
  );
}
