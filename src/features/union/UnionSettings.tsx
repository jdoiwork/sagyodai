import { sourceLabel } from "../sheets/model";
import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Icon } from "../../components/Icon";
import { createsCycle } from "../../validation/input";

export function UnionSettings({ table }: { table: TableData }) {
  const { project, dispatch, pending } = useProject();
  const sources = (table.unionInputs ?? []).map((input) => input.source);
  function update(next: string[], distinct = !!table.unionDistinct) {
    dispatch({
      type: "setUnion",
      id: table.id,
      sources: next,
      distinct,
      expectedSources: sources,
    });
  }
  function move(index: number, delta: number) {
    const next = [...sources];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    update(next);
  }
  const candidates =
    project?.tables.filter(
      (t) =>
        t.kind !== "display" &&
        !sources.includes(t.id) &&
        !createsCycle(project.tables, table.id, t.id),
    ) ?? [];
  return (
    <div
      className={`node-settings union-settings nodrag nopan${table.compact ? " node-settings-compact" : ""}`}
    >
      {table.compact ? (
        <span className="compact-condition">
          {table.unionDistinct ? "UNION" : "UNION ALL"} · {sources.length} 入力
        </span>
      ) : (
        <>
          <label>
            結合方法
            <select
              aria-label={`${table.title} 結合方法`}
              value={table.unionDistinct ? "union" : "all"}
              disabled={pending > 0}
              onChange={(e) => update(sources, e.target.value === "union")}
            >
              <option value="all">UNION ALL（重複を残す）</option>
              <option value="union">UNION（重複を除く）</option>
            </select>
          </label>
          <div className="union-inputs nowheel">
            {sources.map((source, index) => (
              <div className="union-input-row" key={source}>
                <span
                  title={
                    project?.tables.find((t) => t.id === source)
                      ? sourceLabel(
                          project,
                          project.tables.find((t) => t.id === source)!,
                        )
                      : source
                  }
                >
                  {index + 1}.{" "}
                  {project?.tables.find((t) => t.id === source)
                    ? sourceLabel(
                        project,
                        project.tables.find((t) => t.id === source)!,
                      )
                    : source}
                </span>
                <button
                  disabled={pending > 0 || index === 0}
                  aria-label={`${table.title} 入力${index + 1}を上へ`}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  disabled={pending > 0 || index === sources.length - 1}
                  aria-label={`${table.title} 入力${index + 1}を下へ`}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  disabled={pending > 0}
                  aria-label={`${table.title} 入力${index + 1}を解除`}
                  onClick={() => update(sources.filter((s) => s !== source))}
                >
                  <Icon name="close" />
                </button>
              </div>
            ))}
          </div>
          <label>
            入力を追加
            <select
              aria-label={`${table.title} 入力を追加`}
              value=""
              disabled={pending > 0 || !candidates.length}
              onChange={(e) => {
                if (e.target.value) update([...sources, e.target.value]);
              }}
            >
              <option value="">表を選択（端子への接続でも追加）</option>
              {candidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {sourceLabel(project, t)}
                </option>
              ))}
            </select>
          </label>
          <div className="execution-controls">
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
            <button onClick={() => dispatch({ type: "run", id: table.id })}>
              <Icon name="refresh" />
              今すぐ更新
            </button>
            <button
              className="action-danger"
              onClick={() => dispatch({ type: "removeNode", id: table.id })}
              disabled={project?.tables.length === 1}
            >
              <Icon name="trash" />
              削除
            </button>
          </div>
        </>
      )}
      <div
        className={table.stale ? "node-status stale" : "node-status"}
        role="status"
        title={table.error ?? undefined}
      >
        {table.error ??
          (table.stale
            ? "更新待ち — 前回の結果を保持"
            : `${table.rows.length} 件 · ${table.manual ? "手動" : "自動"}`)}
      </div>
    </div>
  );
}
