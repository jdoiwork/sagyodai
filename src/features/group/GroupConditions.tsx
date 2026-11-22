import { useEffect, useRef, useState } from "react";
import type { GroupConfig, GroupOutput, TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Icon } from "../../components/Icon";
import { functions, outputColumns, outputName } from "./groupOutputs";
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
  const outputs = outputColumns(draft);
  const columns = source?.columns ?? [];
  const error = !outputs.length
    ? "出力する集計列を1つ以上追加してください。"
    : draft.groupBy.length + outputs.length > 50
      ? "出力は50列以内にしてください。"
      : outputs.some((o) => [...o.name].length > 240)
        ? "出力列名は240文字以内にしてください。"
        : outputs.some(
              (o) =>
                o.function !== "count" &&
                (o.column === null || o.column >= columns.length),
            ) || draft.groupBy.some((c) => c >= columns.length)
          ? "対象列を選び直してください。"
          : "";
  function change(next: GroupConfig) {
    editing.current = true;
    setDraft(next);
  }
  function changeOutputs(next: GroupOutput[]) {
    change({ groupBy: draft.groupBy, sums: [], count: false, outputs: next });
  }
  function update(index: number, patch: Partial<GroupOutput>) {
    changeOutputs(
      outputs.map((o, i) => (i === index ? { ...o, ...patch } : o)),
    );
  }
  function move(index: number, delta: -1 | 1) {
    const destination = index + delta;
    if (destination < 0 || destination >= outputs.length) return;
    const next = [...outputs];
    [next[index], next[destination]] = [next[destination], next[index]];
    changeOutputs(next);
  }
  return (
    <>
      {table.compact && (
        <span className="compact-condition">
          {saved.groupBy.length
            ? saved.groupBy.map((c) => columns[c] ?? `列${c + 1}`).join("・")
            : "全行"}{" "}
          · 集計{outputColumns(saved).length}列{dirty ? " · 未適用" : ""}
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
        <div className="group-keys nowheel" aria-label="グループ化する列">
          <span>グループ化</span>
          {columns.map((name, c) => (
            <label key={c}>
              <input
                type="checkbox"
                aria-label={`${table.title} ${name} でグループ化`}
                checked={draft.groupBy.includes(c)}
                onChange={(e) =>
                  change({
                    ...draft,
                    groupBy: e.target.checked
                      ? [...draft.groupBy, c]
                      : draft.groupBy.filter((v) => v !== c),
                  })
                }
              />
              {name}
            </label>
          ))}
          {!columns.length && <span>入力を接続してください</span>}
        </div>
        <div className="group-outputs nowheel">
          {outputs.map((output, i) => (
            <fieldset className="group-output" key={i}>
              <legend>出力列 {i + 1}</legend>
              <div className="group-output-order">
                <button
                  type="button"
                  aria-label={`出力列${i + 1}を上へ移動`}
                  title="上へ移動"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <Icon name="collapse" />
                  上へ
                </button>
                <button
                  type="button"
                  aria-label={`出力列${i + 1}を下へ移動`}
                  title="下へ移動"
                  disabled={i === outputs.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <Icon name="expand" />
                  下へ
                </button>
              </div>
              <div className="group-output-fields">
                <label>
                  集約関数
                  <select
                    aria-label={`出力列${i + 1}の集約関数`}
                    value={output.function}
                    onChange={(e) => {
                      const fn = e.target.value as GroupOutput["function"];
                      update(i, {
                        function: fn,
                        column:
                          fn === "count"
                            ? null
                            : (output.column ?? (columns.length ? 0 : null)),
                      });
                    }}
                  >
                    {functions.map(([fn, label]) => (
                      <option key={fn} value={fn}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  対象列
                  <select
                    aria-label={`出力列${i + 1}の対象列`}
                    disabled={output.function === "count"}
                    value={output.column ?? ""}
                    onChange={(e) =>
                      update(i, { column: Number(e.target.value) })
                    }
                  >
                    <option value="" disabled>
                      {output.function === "count" ? "全行" : "列を選択"}
                    </option>
                    {columns.map((name, c) => (
                      <option key={c} value={c}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  aria-label={`出力列${i + 1}を削除`}
                  onClick={() =>
                    changeOutputs(outputs.filter((_, n) => n !== i))
                  }
                >
                  <Icon name="trash" />
                </button>
              </div>
              <label className="group-output-name">
                列名
                <input
                  aria-label={`出力列${i + 1}の列名`}
                  value={output.name}
                  placeholder={outputName(output, columns)}
                  onChange={(e) => update(i, { name: e.target.value })}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      (e.nativeEvent.isComposing || e.keyCode === 229)
                    )
                      e.preventDefault();
                  }}
                />
              </label>
            </fieldset>
          ))}
        </div>
        <button
          type="button"
          disabled={draft.groupBy.length + outputs.length >= 50}
          onClick={() =>
            changeOutputs([
              ...outputs,
              { function: "sum", column: columns.length ? 0 : null, name: "" },
            ])
          }
        >
          <Icon name="plus" />
          出力列を追加
        </button>
        <p className="sort-hint">
          列名が空欄なら自動命名 · グループ列なしは全行を集計
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
