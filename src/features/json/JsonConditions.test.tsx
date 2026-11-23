// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TableData } from "../../api/project";
import { JsonConditions } from "./JsonConditions";
const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({ dispatch, pending: 0 }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("キー編集の未適用・入力エラーを表示し、修正後に適用できる", () => {
  const ui = render(
    <JsonConditions
      table={
        {
          id: "j",
          title: "JSON",
          kind: "jsonSelect",
          jsonKey: "chapters",
        } as TableData
      }
    />,
  );
  const field = ui.getByLabelText("JSON キー名");
  fireEvent.change(field, { target: { value: "a".repeat(1025) } });
  expect(ui.getByRole("alert").textContent).toContain("1024");
  expect(
    (ui.getByRole("button", { name: "キーを適用" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.change(field, { target: { value: "a.b" } });
  expect(ui.queryByRole("alert")).toBeNull();
  expect(ui.getByText("未適用の変更があります")).toBeTruthy();
  fireEvent.click(ui.getByRole("button", { name: "キーを適用" }));
  expect(dispatch).toHaveBeenCalledWith(
    { type: "setJsonKey", id: "j", key: "a.b" },
    expect.any(Function),
  );
});
