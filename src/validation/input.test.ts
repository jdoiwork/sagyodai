import { expect, it } from "vitest";
import {
  cellInputError,
  filterInputError,
  pasteInputError,
  createsCycle,
} from "./input";
import type { TableData } from "../api/project";
it("数値比較は空欄・非数・非有限・16進数を拒否し、文字列比較の空欄を許可する", () => {
  for (const value of ["", "  ", "abc", "NaN", "Infinity", "1e999", "0x10"]) {
    expect(
      filterInputError({ column: 0, operator: "numberEquals", value }),
    ).not.toBe("");
  }
  for (const value of ["0", "-3.5", " .25 ", "1.e2", "1e-3"]) {
    expect(filterInputError({ column: 0, operator: "greater", value })).toBe(
      "",
    );
  }
  expect(filterInputError({ column: 0, operator: "equals", value: "" })).toBe(
    "",
  );
});
it("UTF-8バイト数と貼り付け先を含めて上限を判定する", () => {
  expect(cellInputError("a".repeat(100000))).toBe("");
  expect(cellInputError("あ".repeat(33334))).not.toBe("");
  expect(pasteInputError(4999, 49, [["x"]])).toBe("");
  expect(pasteInputError(4999, 49, [["x", "y"]])).not.toBe("");
  expect(pasteInputError(4999, 0, [["x"], ["y"]])).not.toBe("");
  expect(pasteInputError(0, 0, [["a".repeat(100001)]])).not.toBe("");
});
it("間接的な循環接続も検出する", () => {
  const tables = [
    { id: "a", source: null },
    { id: "b", source: "a" },
    { id: "c", source: "b" },
  ] as TableData[];
  expect(createsCycle(tables, "a", "c")).toBe(true);
  expect(createsCycle(tables, "b", "b")).toBe(true);
  expect(createsCycle(tables, "c", "a")).toBe(false);
});

it("結合の複数入力をたどって循環を検出し、合流を循環扱いしない", () => {
  const tables = [
    { id: "a", source: null },
    { id: "b", source: "a" },
    { id: "c", source: "a" },
    { id: "u", source: null, unionInputs: [{ source: "b" }, { source: "c" }] },
  ] as TableData[];
  expect(createsCycle(tables, "a", "u")).toBe(true);
  expect(createsCycle(tables, "b", "u")).toBe(true);
  expect(createsCycle(tables, "other", "u")).toBe(false);
});
