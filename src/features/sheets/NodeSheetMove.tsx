import { useState } from "react";
import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Icon } from "../../components/Icon";
import { sheetOf, sheetsOf } from "./model";

export function NodeSheetMove({
  table,
  onMoved,
}: {
  table: TableData;
  onMoved: (table: TableData) => void;
}) {
  const { project, dispatch, pending } = useProject();
  const [destination, setDestination] = useState("");
  const candidates = sheetsOf(project).filter((s) => s.id !== sheetOf(table));
  const target = candidates.some((s) => s.id === destination)
    ? destination
    : "";
  return (
    <form
      className="node-sheet-move"
      aria-label="選択ノードのシート移動"
      onSubmit={(e) => {
        e.preventDefault();
        if (!target || pending) return;
        dispatch(
          {
            type: "moveNodeToSheet",
            id: table.id,
            sheetId: target,
            expectedSheetId: sheetOf(table),
          },
          (ok, next) => {
            const moved = next?.tables.find((t) => t.id === table.id);
            if (ok && moved) {
              setDestination("");
              onMoved(moved);
            }
          },
        );
      }}
    >
      <span title={table.title}>{table.title}</span>
      <select
        aria-label={`${table.title} の移動先シート`}
        value={target}
        disabled={pending > 0 || !candidates.length}
        onChange={(e) => setDestination(e.target.value)}
      >
        <option value="">
          {candidates.length ? "移動先シート…" : "先にシートを追加"}
        </option>
        {candidates.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>
      <button
        disabled={!target || pending > 0}
        title="接続を維持して移動し、移動先を表示"
      >
        <Icon name="moveSheet" />
        移動
      </button>
    </form>
  );
}
