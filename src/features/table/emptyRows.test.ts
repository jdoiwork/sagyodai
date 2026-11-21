import { expect, it } from "vitest";
import { emptyRowIndices } from "./emptyRows";
it("全セルが空の行だけを選び、空白や0がある行は残す", () => {
  expect(
    emptyRowIndices([
      ["", ""],
      [" ", ""],
      ["", "0"],
      ["", ""],
      ["", "値"],
    ]),
  ).toEqual([0, 3]);
});
it("全行が空でも先頭の1行を残す", () => {
  expect(emptyRowIndices([[""], [""], [""]])).toEqual([1, 2]);
  expect(emptyRowIndices([[""]])).toEqual([]);
  expect(emptyRowIndices([["値"]])).toEqual([]);
});
