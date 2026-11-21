// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
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
  compact: false,
  stale: false,
  error: null,
  title: "表",
  columnWidths: [],
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

it("行削除と列名編集・列削除に表示時の比較条件を添える", () => {
  const editable = {
    ...table,
    columns: ["品名", "数量"],
    rows: [
      ["ノート", "3"],
      ["鉛筆", "2"],
    ],
  };
  const { getByLabelText, getByRole, queryByLabelText } = render(
    <TableGrid table={editable} />,
  );
  expect(queryByLabelText("表 2行を削除")).toBeNull();
  fireEvent.contextMenu(getByLabelText("表 2行 1列"), {
    clientX: 120,
    clientY: 200,
  });
  fireEvent.click(getByRole("menuitem", { name: "行2 を削除" }));
  expect(dispatch).toHaveBeenLastCalledWith({
    type: "removeRow",
    id: "t",
    row: 1,
    expectedRows: editable.rows,
  });
  expect(queryByLabelText("表 2列の名前")).toBeNull();
  fireEvent.doubleClick(getByLabelText("表 2列の名前を編集"));
  const name = getByLabelText("表 2列の名前");
  fireEvent.focus(name);
  fireEvent.change(name, { target: { value: "在庫" } });
  fireEvent.blur(name);
  expect(dispatch).toHaveBeenLastCalledWith({
    type: "renameColumn",
    id: "t",
    col: 1,
    name: "在庫",
    expectedColumns: editable.columns,
  });
  expect(queryByLabelText("表 1列を削除")).toBeNull();
  fireEvent.contextMenu(getByLabelText("表 1列の名前を編集"));
  fireEvent.click(getByRole("menuitem", { name: "「品名」列を削除" }));
  expect(dispatch).toHaveBeenLastCalledWith({
    type: "removeColumn",
    id: "t",
    col: 0,
    expectedColumns: editable.columns,
    expectedRows: editable.rows,
  });
});

it("右クリックメニューを Escape で閉じ、列名の編集も Escape で取り消す", () => {
  const { getByLabelText, queryByRole, queryByLabelText } = render(
    <TableGrid table={table} />,
  );
  fireEvent.contextMenu(getByLabelText("表 1行 1列"));
  expect(queryByRole("menu")).not.toBeNull();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(queryByRole("menu")).toBeNull();
  fireEvent.doubleClick(getByLabelText("表 1列の名前を編集"));
  const input = getByLabelText("表 1列の名前");
  fireEvent.change(input, { target: { value: "取り消す" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(queryByLabelText("表 1列の名前")).toBeNull();
  expect(dispatch).not.toHaveBeenCalled();
});

it("削除項目のホバー中だけ対象の行・列を強調し、操作は送らない", () => {
  const editable = {
    ...table,
    columns: ["品名", "数量"],
    rows: [
      ["ノート", "3"],
      ["鉛筆", "2"],
    ],
  };
  const { getByLabelText, getByRole, container } = render(
    <TableGrid table={editable} />,
  );
  fireEvent.contextMenu(getByLabelText("表 2行 1列"));
  const rowAction = getByRole("menuitem", { name: "行2 を削除" });
  expect(container.querySelectorAll(".delete-preview")).toHaveLength(0);
  fireEvent.mouseEnter(rowAction);
  expect(
    container.querySelectorAll('[data-row="1"] .delete-preview'),
  ).toHaveLength(3);
  expect(
    container.querySelectorAll('[data-row="0"] .delete-preview'),
  ).toHaveLength(0);
  fireEvent.mouseLeave(rowAction);
  expect(container.querySelectorAll(".delete-preview")).toHaveLength(0);
  fireEvent.contextMenu(getByLabelText("表 2列の名前を編集"));
  fireEvent.mouseEnter(getByRole("menuitem", { name: "「数量」列を削除" }));
  expect(container.querySelectorAll("thead .delete-preview")).toHaveLength(1);
  expect(
    container.querySelectorAll('td[data-col="1"].delete-preview'),
  ).toHaveLength(2);
  expect(
    container.querySelectorAll('td[data-col="0"].delete-preview'),
  ).toHaveLength(0);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(container.querySelectorAll(".delete-preview")).toHaveLength(0);
  expect(dispatch).not.toHaveBeenCalled();
});

it("ズーム50%での列幅ドラッグを補正し、離したときだけ確定する", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  try {
    const { getByLabelText, rerender } = render(<TableGrid table={table} />);
    const handle = getByLabelText("表 1列の幅");
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    const header = handle.closest("th")!;
    Object.defineProperty(header, "offsetWidth", { value: 160 });
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({
      width: 80,
    } as DOMRect);
    fireEvent.pointerDown(handle, { button: 0, clientX: 100 });
    fireEvent.pointerMove(handle, { clientX: 150 });
    expect(handle.getAttribute("aria-valuenow")).toBe("260");
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { clientX: 150 });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(
      {
        type: "resizeColumn",
        id: "t",
        col: 0,
        width: 260,
        expectedWidth: 160,
        expectedColumns: table.columns,
      },
      expect.any(Function),
    );
    fireEvent.lostPointerCapture(handle);
    expect(handle.getAttribute("aria-valuenow")).toBe("260");
    // 保存完了が先に届いても、キャンバスのノードはまだ古い幅のことがある。
    act(() => dispatch.mock.calls[0][1](true));
    expect(handle.getAttribute("aria-valuenow")).toBe("260");
    rerender(<TableGrid table={{ ...table, columnWidths: [260] }} />);
    expect(handle.getAttribute("aria-valuenow")).toBe("260");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("列幅の確定待ちを保持し、失敗時は確定済みの幅に戻す", () => {
  const { getByLabelText } = render(<TableGrid table={table} />);
  const handle = getByLabelText("表 1列の幅");
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(handle.getAttribute("aria-valuenow")).toBe("170");
  // コア側の幅が変わらないまま完了するのは、競合・通信失敗の場合。
  act(() => dispatch.mock.calls[0][1](false));
  expect(handle.getAttribute("aria-valuenow")).toBe("160");
});

it("編集中のセルの行・列見出しを強調し、フォーカス移動と終了に追従する", () => {
  const editable = {
    ...table,
    columns: ["品名", "数量"],
    rows: [
      ["ノート", "3"],
      ["鉛筆", "2"],
    ],
  };
  const { getByLabelText, container } = render(<TableGrid table={editable} />);
  const first = getByLabelText("表 1行 1列"),
    second = getByLabelText("表 2行 2列");
  fireEvent.focus(first);
  expect(
    container
      .querySelector('thead [data-column="0"]')
      ?.classList.contains("editing-header"),
  ).toBe(true);
  expect(
    container
      .querySelector('[data-row="0"] th')
      ?.classList.contains("editing-header"),
  ).toBe(true);
  fireEvent.blur(first);
  fireEvent.focus(second);
  expect(container.querySelectorAll(".editing-header")).toHaveLength(2);
  expect(
    container
      .querySelector('thead [data-column="1"]')
      ?.classList.contains("editing-header"),
  ).toBe(true);
  expect(
    container
      .querySelector('[data-row="1"] th')
      ?.classList.contains("editing-header"),
  ).toBe(true);
  fireEvent.blur(second);
  expect(container.querySelectorAll(".editing-header")).toHaveLength(0);
  expect(dispatch).not.toHaveBeenCalled();
});

it("列名をドラッグして挿入先を表示し、ドロップ時に並び替えを送る", () => {
  const editable = {
    ...table,
    columns: ["品名", "数量", "メモ"],
    rows: [["ノート", "3", "青"]],
  };
  const { getByLabelText, container } = render(<TableGrid table={editable} />);
  const source = getByLabelText("表 1列の名前を編集");
  const target = getByLabelText("表 3列の名前を編集").closest("th")!;
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
    left: 300,
    width: 160,
  } as DOMRect);
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(source, { dataTransfer });
  const over = new Event("dragover", { bubbles: true, cancelable: true });
  Object.assign(over, { clientX: 440, dataTransfer });
  fireEvent(target, over);
  expect(target.classList.contains("column-drop-after")).toBe(true);
  expect(dispatch).not.toHaveBeenCalled();
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.assign(drop, { clientX: 440, dataTransfer });
  fireEvent(target, drop);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({
    type: "moveColumn",
    id: "t",
    from: 0,
    to: 2,
    expectedColumns: editable.columns,
    expectedRows: editable.rows,
  });
  expect(container.querySelectorAll(".column-drop-after")).toHaveLength(0);
});
