// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NodeSettings } from "./NodeSettings";
import type { TableData } from "../../api/project";
const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({
    dispatch,
    project: {
      tables: [
        { id: "source", kind: "input", columns: ["値"] },
        { id: "downstream", kind: "filter", source: "f", title: "後続" },
      ],
    },
  }),
}));
afterEach(() => {
  cleanup();
  dispatch.mockClear();
});
const table = {
  id: "f",
  title: "条件",
  kind: "filter",
  source: "source",
  filter: { column: 0, operator: "greater", value: "3" },
  rows: [],
  columns: ["値"],
  manual: false,
  compact: false,
  stale: false,
  error: null,
  columnWidths: [],
  x: 0,
  y: 0,
  width: 400,
  height: 390,
} satisfies TableData;
it("不正な比較値は適用せず、修正後だけ送信する", () => {
  const ui = render(<NodeSettings table={table} />);
  const input = ui.getByLabelText("条件 比較値");
  fireEvent.change(input, { target: { value: "abc" } });
  expect(ui.getByRole("alert").textContent).toMatch(/有限の数値/);
  expect(
    (ui.getByRole("button", { name: "条件を適用" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.submit(input.closest("form")!);
  expect(dispatch).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "12" } });
  fireEvent.click(ui.getByRole("button", { name: "条件を適用" }));
  expect(dispatch).toHaveBeenCalledWith({
    type: "configure",
    id: "f",
    filter: { column: 0, operator: "greater", value: "12" },
    manual: false,
  });
  expect(
    (ui.getByRole("option", { name: /後続/ }) as HTMLOptionElement).disabled,
  ).toBe(true);
});
