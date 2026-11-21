// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TableGrid } from "./TableGrid";
const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({ dispatch }),
}));
afterEach(() => {
  cleanup();
  dispatch.mockClear();
});
const table = {
  id: "t",
  kind: "input" as const,
  source: null,
  filter: null,
  manual: false,
  stale: false,
  error: null,
  title: "表",
  columns: ["列"],
  rows: Array.from({ length: 1000 }, () => [""]),
  x: 0,
  y: 0,
  width: 700,
  height: 390,
};
it("画面外にスクロールしても編集中のセルを保持する", () => {
  const { getByLabelText, container } = render(<TableGrid table={table} />);
  const cell = getByLabelText("表 1行 1列") as HTMLTextAreaElement;
  fireEvent.focus(cell);
  fireEvent.change(cell, { target: { value: "編集中" } });
  fireEvent.scroll(container.querySelector(".grid-scroll")!, {
    target: { scrollTop: 18000 },
  });
  expect(getByLabelText("表 1行 1列")).toBe(cell);
  expect(cell.value).toBe("編集中");
  expect(container.querySelectorAll("textarea").length).toBeLessThan(40);
  fireEvent.blur(cell);
  expect(dispatch).toHaveBeenCalledWith({
    type: "paste",
    id: "t",
    row: 0,
    col: 0,
    values: [["編集中"]],
    expectedValues: [[""]],
  });
});
it("選んだセルを起点に複数行を一括で貼り付ける", () => {
  const { getByLabelText } = render(<TableGrid table={table} />);
  const cell = getByLabelText("表 3行 1列");
  fireEvent.mouseDown(cell);
  fireEvent.paste(cell, {
    clipboardData: { getData: () => "東京\t3\n大阪\t4" },
  });
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({
    type: "paste",
    id: "t",
    row: 2,
    col: 0,
    expectedValues: [
      ["", null],
      ["", null],
    ],
    values: [
      ["東京", "3"],
      ["大阪", "4"],
    ],
  });
});

it("結果表は編集欄を持たず、貼り付けても操作を送信しない", () => {
  const { container, queryAllByRole, getByText } = render(
    <TableGrid
      table={{ ...table, kind: "display", rows: [["読み取り専用"]] }}
      readOnly
    />,
  );
  expect(queryAllByRole("textbox")).toHaveLength(0);
  fireEvent.paste(getByText("読み取り専用"), {
    clipboardData: { getData: () => "変更\t禁止" },
  });
  expect(dispatch).not.toHaveBeenCalled();
  expect(container.textContent).toContain("読み取り専用");
});
