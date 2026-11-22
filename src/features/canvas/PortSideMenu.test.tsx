// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PortSideMenu } from "./PortSideMenu";
import type { TableData } from "../../api/project";
const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({ dispatch, pending: 0 }),
}));
afterEach(() => {
  cleanup();
  dispatch.mockReset();
});
it("入力と出力を個別に設定し、現在の辺を示す", () => {
  const ui = render(
    <PortSideMenu
      table={
        {
          id: "node",
          kind: "union",
          inputSide: "top",
          outputSide: "bottom",
        } as TableData
      }
      onBack={() => {}}
    />,
  );
  expect(
    ui
      .getByRole("menuitemradio", { name: "入力端子を上に配置" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  fireEvent.click(
    ui.getByRole("menuitemradio", { name: "出力端子を左に配置" }),
  );
  expect(dispatch).toHaveBeenCalledWith({
    type: "setPortSide",
    id: "node",
    input: false,
    side: "left",
  });
});
it("入力ソースには出力端子だけを表示する", () => {
  const ui = render(
    <PortSideMenu
      table={{ id: "node", kind: "csv" } as TableData}
      onBack={() => {}}
    />,
  );
  expect(
    ui.queryByRole("menuitemradio", { name: "入力端子を上に配置" }),
  ).toBeNull();
  expect(ui.getAllByRole("menuitemradio")).toHaveLength(4);
});
