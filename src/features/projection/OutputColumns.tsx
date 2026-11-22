import { useEffect, useRef, useState } from "react";
import type { Projection, TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Icon } from "../../components/Icon";
import { useOutputReorderAnimation } from "../group/useOutputReorderAnimation";

export function OutputColumns({
  table,
  source,
}: {
  table: TableData;
  source?: TableData;
}) {
  const { dispatch } = useProject();
  const saved = table.projection ?? null;
  const [draft, setDraft] = useState<Projection | null>(saved);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(saved);
  }, [saved]);
  const schema = source?.columns ?? [];
  const config: Projection = draft ?? {
    schema,
    columns: schema.map((_, column) => ({ column, name: "", visible: true })),
  };
  const reorder = useOutputReorderAnimation(config.columns.length);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const selected = config.columns.filter((c) => c.visible);
  const names = selected.map((c) => c.name.trim() || config.schema[c.column]);
  const error =
    JSON.stringify(config.schema) !== JSON.stringify(schema)
      ? "入力の列構成が変わりました。「入力列に戻す」で設定し直してください。"
      : !selected.length
        ? "出力する列を1つ以上選択してください。"
        : config.columns.some((c) => [...c.name].length > 240)
          ? "出力列名は240文字以内にしてください。"
          : new Set(names).size !== names.length
            ? "出力列名が重複しています。別の名前を指定してください。"
            : "";
  function change(next: Projection | null) {
    editing.current = true;
    setDraft(next);
  }
  function update(
    index: number,
    patch: Partial<Projection["columns"][number]>,
  ) {
    change({
      ...config,
      columns: config.columns.map((c, i) =>
        i === index ? { ...c, ...patch } : c,
      ),
    });
  }
  function move(index: number, delta: -1 | 1) {
    const to = index + delta;
    if (to < 0 || to >= config.columns.length) return;
    reorder.move(index, to);
    const columns = [...config.columns];
    [columns[index], columns[to]] = [columns[to], columns[index]];
    change({ ...config, columns });
  }
  return (
    <>
      {table.compact && dirty && (
        <span className="condition-draft-status">出力列に未適用の変更あり</span>
      )}
      <details className="output-column-settings" hidden={table.compact}>
        <summary>出力列の設定{dirty ? " · 未適用" : ""}</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (error) return;
            editing.current = false;
            dispatch({ type: "setProjection", id: table.id, config: draft });
          }}
        >
          <p className="sort-hint">
            選択・並び順・列名は後続ノードへの出力にも反映します。
          </p>
          <div className="output-column-list nowheel" ref={reorder.list}>
            {config.columns.map((column, i) => (
              <div
                className="output-column-row"
                key={reorder.ids[i]}
                data-output-id={reorder.ids[i]}
              >
                <label>
                  <input
                    type="checkbox"
                    checked={column.visible}
                    aria-label={`${table.title} ${config.schema[column.column]} を出力`}
                    onChange={(e) => update(i, { visible: e.target.checked })}
                  />
                  <span>{config.schema[column.column]}</span>
                </label>
                <input
                  aria-label={`${table.title} ${config.schema[column.column]} の出力列名`}
                  placeholder={config.schema[column.column]}
                  value={column.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      (e.nativeEvent.isComposing || e.keyCode === 229)
                    )
                      e.preventDefault();
                  }}
                />
                <button
                  type="button"
                  aria-label={`${table.title} 出力列${i + 1}を上へ移動`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <Icon name="collapse" />
                </button>
                <button
                  type="button"
                  aria-label={`${table.title} 出力列${i + 1}を下へ移動`}
                  disabled={i === config.columns.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <Icon name="expand" />
                </button>
              </div>
            ))}
          </div>
          <p className="sort-hint">列名が空欄なら入力列名を使用</p>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          <div className="condition-actions">
            <button type="button" onClick={() => change(null)}>
              入力列に戻す
            </button>
            <button
              type="submit"
              disabled={!!error || !source}
              className={dirty ? "action-pending" : "action-accent"}
            >
              <Icon name="check" />
              出力列を適用
            </button>
          </div>
        </form>
      </details>
    </>
  );
}
