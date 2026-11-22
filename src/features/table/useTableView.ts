import { useRef, useState } from "react";
import {
  emptyTableView,
  type TableData,
  type ColumnView,
} from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import type { ColumnFilterState } from "./ColumnValueFilter";

// 操作キューの応答を待つ間だけ即時表示し、確定後は共有状態（Undo・別タブを含む）に従う。
function usePendingValue<T>(saved: T) {
  const [draft, setDraft] = useState<{ value: T } | null>(null);
  const serial = useRef(0);
  const current = useRef(saved);
  current.current = draft ? draft.value : saved;
  function change(value: T) {
    const expected = current.current;
    current.current = value;
    const version = ++serial.current;
    setDraft({ value });
    return {
      expected,
      settled: () => {
        if (serial.current === version) setDraft(null);
      },
    };
  }
  return { value: draft ? draft.value : saved, change };
}
export function useTableView(table: TableData) {
  const { dispatch, project } = useProject();
  // キャンバス側のノードへの反映は一拍遅れるため、確定状態は共通スナップショットを直接読む。
  const view =
    (project?.tables.find((t) => t.id === table.id) ?? table).view ??
    emptyTableView;
  const query = usePendingValue(view.query);
  const columns = usePendingValue<ColumnView>(view.columns);
  return {
    search: query.value,
    columnFilters: columns.value,
    setSearch(value: string) {
      const pending = query.change(value);
      dispatch(
        {
          type: "setViewQuery",
          id: table.id,
          query: value,
          expectedQuery: pending.expected,
        },
        pending.settled,
      );
    },
    setColumnFilters(value: ColumnFilterState) {
      const next = { ...value, sort: value.sort ?? null };
      const pending = columns.change(next);
      dispatch(
        {
          type: "setViewColumns",
          id: table.id,
          columns: next,
          expectedColumns: pending.expected,
        },
        pending.settled,
      );
    },
  };
}
