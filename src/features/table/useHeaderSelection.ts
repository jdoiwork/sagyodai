import { useState, type MouseEvent } from "react";
import type { TableData } from "../../api/project";

type Axis = "row" | "column";
export function useHeaderSelection(table: TableData) {
  const [stored, setStored] = useState<{
    kind: Axis;
    indices: number[];
    anchor: number;
    signature: string;
  } | null>(null);
  // 添字で選択する間は、他タブの編集や並べ替えで別のデータを選ばない。
  const signature = JSON.stringify([table.columns, table.rows]);
  const selection = stored?.signature === signature ? stored : null;
  function select(
    kind: Axis,
    index: number,
    event?: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">,
  ) {
    const previous = selection?.kind === kind ? selection : null;
    const anchor = event?.shiftKey && previous ? previous.anchor : index;
    let indices = [index];
    if (event?.shiftKey && previous) {
      indices = Array.from(
        { length: Math.abs(index - anchor) + 1 },
        (_, n) => Math.min(index, anchor) + n,
      );
      if (event.ctrlKey || event.metaKey)
        indices = [...new Set([...previous.indices, ...indices])];
    } else if ((event?.ctrlKey || event?.metaKey) && previous) {
      indices = previous.indices.includes(index)
        ? previous.indices.filter((n) => n !== index)
        : [...previous.indices, index];
    }
    setStored({
      kind,
      indices: indices.sort((a, b) => a - b),
      anchor,
      signature,
    });
  }
  return {
    selection,
    select,
    clear: () => setStored(null),
    contains: (kind: Axis, index: number) =>
      selection?.kind === kind && selection.indices.includes(index),
  };
}
