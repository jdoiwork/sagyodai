import { useEffect, useRef, useState } from "react";
import type { GroupConfig, TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Icon } from "../../components/Icon";
const metrics = [
  ["sums", "合計"],
  ["averages", "平均"],
  ["minima", "最小値"],
  ["maxima", "最大値"],
] as const;
const initial: GroupConfig = { groupBy: [], sums: [], count: true };
export function GroupConditions({
  table,
  source,
}: {
  table: TableData;
  source?: TableData;
}) {
  const { dispatch } = useProject();
  const saved = table.group ?? initial;
  const [draft, setDraft] = useState(saved);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(saved);
  }, [saved]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const metricColumns = metrics.flatMap(([field]) => draft[field] ?? []);
  const error =
    !draft.count && !metricColumns.length
      ? "集計項目または件数を1つ以上選んでください。"
      : draft.groupBy.length + metricColumns.length + Number(draft.count) > 50
        ? "出力は50列以内にしてください。"
        : source &&
            [...draft.groupBy, ...metricColumns].some(
              (c) => c >= source.columns.length,
            )
          ? "対象列を選び直してください。"
          : "";
  function change(next: GroupConfig) {
    editing.current = true;
    setDraft(next);
  }
  function toggle(
    field: "groupBy" | (typeof metrics)[number][0],
    column: number,
    checked: boolean,
  ) {
    change({
      ...draft,
      [field]: checked
        ? [...(draft[field] ?? []), column]
        : (draft[field] ?? []).filter((c) => c !== column),
    });
  }
  return (
    <>
      {table.compact && (
        <span className="compact-condition">
          {saved.groupBy.length
            ? saved.groupBy
                .map((c) => source?.columns[c] ?? `列${c + 1}`)
                .join("・")
            : "全行"}{" "}
          ·{" "}
          {metrics
            .filter(([field]) => saved[field]?.length)
            .map(([field, label]) => `${label}${saved[field]!.length}列`)
            .join("・")}
          {saved.count ? "・件数" : ""}
          {dirty ? " · 未適用" : ""}
        </span>
      )}
      <form
        hidden={table.compact}
        onSubmit={(e) => {
          e.preventDefault();
          if (error) return;
          editing.current = false;
          dispatch({ type: "setGroup", id: table.id, config: draft });
        }}
      >
        <div className="group-column-list nowheel">
          <div className="group-column-row group-column-heading">
            <span>入力列</span>
            <span>グループ</span>
            {metrics.map(([field, label]) => (
              <span key={field}>{label}</span>
            ))}
          </div>
          {source?.columns.map((name, c) => (
            <div className="group-column-row" key={c}>
              <span>{name}</span>
              <input
                type="checkbox"
                aria-label={`${table.title} ${name} でグループ化`}
                checked={draft.groupBy.includes(c)}
                onChange={(e) => toggle("groupBy", c, e.target.checked)}
              />
              {metrics.map(([field, label]) => (
                <input
                  key={field}
                  type="checkbox"
                  aria-label={`${table.title} ${name} の${label}`}
                  checked={(draft[field] ?? []).includes(c)}
                  onChange={(e) => toggle(field, c, e.target.checked)}
                />
              ))}
            </div>
          ))}
          {!source?.columns.length && <p>入力を接続してください</p>}
        </div>
        <label className="group-count">
          <input
            type="checkbox"
            checked={draft.count}
            onChange={(e) => change({ ...draft, count: e.target.checked })}
          />
          件数（グループ内の行数）
        </label>
        <p className="sort-hint">
          グループ列なしは全行を集計 · 数値集計は空欄・非数値を除く
        </p>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="condition-actions">
          <span className="condition-draft-status" role="status">
            {dirty ? "未適用の変更あり" : ""}
          </span>
          <button
            type="submit"
            disabled={!!error}
            className={dirty ? "action-pending" : "action-accent"}
          >
            <Icon name="check" />
            条件を適用
          </button>
        </div>
      </form>
    </>
  );
}
