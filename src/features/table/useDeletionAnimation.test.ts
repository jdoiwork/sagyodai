import { expect, it } from "vitest";
import type { TableData } from "../../api/project";
import { findDeletion } from "./useDeletionAnimation";
const before: TableData = {
  id: "table",
  kind: "input",
  source: null,
  filter: null,
  manual: false,
  compact: false,
  stale: false,
  error: null,
  title: "表",
  x: 0,
  y: 0,
  width: 700,
  height: 400,
  columnWidths: [],
  columns: ["品名", "数量", "メモ"],
  rows: [
    ["ノート", "3", "青"],
    ["鉛筆", "2", "赤"],
    ["ペン", "1", "黒"],
  ],
};
it("確定した行・列の削除位置を判定する", () => {
  expect(
    findDeletion(before, { ...before, rows: [before.rows[0], before.rows[2]] }),
  ).toEqual({ kind: "row", index: 1 });
  expect(
    findDeletion(before, {
      ...before,
      columns: ["品名", "メモ"],
      rows: before.rows.map((row) => [row[0], row[2]]),
    }),
  ).toEqual({ kind: "column", index: 1 });
});
it("失敗による同一状態・Undoによる追加・同時編集を削除として動かさない", () => {
  expect(findDeletion(before, { ...before })).toBeNull();
  const removed = { ...before, rows: before.rows.slice(1) };
  expect(findDeletion(removed, before)).toBeNull();
  expect(
    findDeletion(before, {
      ...removed,
      rows: [["変更", "2", "赤"], before.rows[2]],
    }),
  ).toBeNull();
  expect(
    findDeletion(before, {
      ...before,
      id: "別の表",
      rows: before.rows.slice(1),
    }),
  ).toBeNull();
});
it("同名の列でもセルの内容から削除位置を区別する", () => {
  const duplicate = { ...before, columns: ["列", "列", "列"] };
  expect(
    findDeletion(duplicate, {
      ...duplicate,
      columns: ["列", "列"],
      rows: before.rows.map((row) => [row[0], row[2]]),
    }),
  ).toEqual({ kind: "column", index: 1 });
});
