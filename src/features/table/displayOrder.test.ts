import { expect, it } from "vitest";
import { sortDisplayRows } from "./displayOrder";
it("数値は符号・小数を含め数値順にし、空欄を末尾に置く", () => {
  const rows = [["10"], ["2"], ["-3"], ["2.5"], [""], ["2.0"]];
  const order = rows.map((_, i) => i);
  expect(sortDisplayRows(rows, order, { column: 0, direction: "asc" })).toEqual(
    [2, 1, 5, 3, 0, 4],
  );
  expect(
    sortDisplayRows(rows, order, { column: 0, direction: "desc" }),
  ).toEqual([0, 3, 1, 5, 2, 4]);
  expect(order).toEqual([0, 1, 2, 3, 4, 5]);
  expect(rows[0][0]).toBe("10");
});
it("文字列は自然順、同値は元の行順、解除後は元の表示順", () => {
  const rows = [["商品10"], ["商品2"], ["商品2"], ["商品1"]];
  const order = [0, 1, 2, 3];
  expect(sortDisplayRows(rows, order, { column: 0, direction: "asc" })).toEqual(
    [3, 1, 2, 0],
  );
  expect(
    sortDisplayRows(rows, [0, 2], { column: 0, direction: "desc" }),
  ).toEqual([0, 2]);
  expect(sortDisplayRows(rows, order, null)).toEqual(order);
});
