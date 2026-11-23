// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SheetBar } from "./SheetBar";
const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({
    project: {
      sheets: [
        { id: "sheet-1", title: "入力" },
        { id: "sheet-2", title: "結果" },
      ],
    },
    pending: 0,
    dispatch,
  }),
}));
afterEach(() => {
  cleanup();
  dispatch.mockReset();
});
it("閲覧シートは共有操作にせず、新規シートは追加成功後に選ぶ", () => {
  const select = vi.fn();
  const ui = render(<SheetBar active="sheet-1" onSelect={select} />);
  fireEvent.click(ui.getByRole("tab", { name: "結果" }));
  expect(select).toHaveBeenCalledWith("sheet-2");
  expect(dispatch).not.toHaveBeenCalled();
  select.mockClear();
  fireEvent.click(ui.getByRole("button", { name: "シートを追加" }));
  expect(select).not.toHaveBeenCalled();
  const [command, settled] = dispatch.mock.calls[0];
  expect(command).toEqual({ type: "addSheet" });
  settled(true, {
    sheets: [{ id: "sheet-1" }, { id: "sheet-2" }, { id: "sheet-3" }],
  });
  expect(select).toHaveBeenCalledWith("sheet-3");
});
it("空のシート名を送信せず、修正した日本語名を確定する", () => {
  const ui = render(<SheetBar active="sheet-1" onSelect={() => {}} />);
  fireEvent.doubleClick(ui.getByRole("tab", { name: "入力" }));
  const input = ui.getByLabelText("シート名");
  fireEvent.change(input, { target: { value: " " } });
  expect(ui.getByRole("alert").textContent).toContain("シート名");
  fireEvent.submit(input.closest("form")!);
  expect(dispatch).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: " 売上入力 " } });
  fireEvent.submit(input.closest("form")!);
  expect(dispatch.mock.calls[0][0]).toEqual({
    type: "renameSheet",
    id: "sheet-1",
    title: "売上入力",
    expectedTitle: "入力",
  });
});

it("ドラッグの挿入位置を送り、選択シートは維持する", () => {
  const select = vi.fn();
  const ui = render(<SheetBar active="sheet-1" onSelect={select} />);
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(ui.getByRole("tab", { name: "結果" }), { dataTransfer });
  fireEvent.dragOver(ui.getByRole("tab", { name: "入力" }), {
    dataTransfer,
    clientX: 0,
  });
  fireEvent.drop(ui.getByRole("tab", { name: "入力" }), { dataTransfer });
  expect(dispatch.mock.calls[0][0]).toEqual({
    type: "moveSheet",
    id: "sheet-2",
    target: "sheet-1",
    after: false,
  });
  expect(select).not.toHaveBeenCalled();
});
it("右クリックで対象を確認し、削除成功後に隣のシートを選ぶ", () => {
  const select = vi.fn();
  const ui = render(<SheetBar active="sheet-1" onSelect={select} />);
  fireEvent.contextMenu(ui.getByRole("tab", { name: "入力" }));
  expect(ui.getByRole("dialog").textContent).toContain("入力");
  fireEvent.click(ui.getByRole("button", { name: "シートを削除" }));
  const [command, settled] = dispatch.mock.calls[0];
  expect(command).toEqual({
    type: "removeSheet",
    id: "sheet-1",
    expectedNodes: [],
  });
  expect(select).not.toHaveBeenCalled();
  settled(true);
  expect(select).toHaveBeenCalledWith("sheet-2");
});
