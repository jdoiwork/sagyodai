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

it.each(["名前", "記号", "余白"])(
  "列見出しの%sからドラッグして列を並び替える",
  (area) => {
    const editable = {
      ...table,
      columns: ["品名", "数量", "メモ"],
      rows: [["ノート", "3", "青"]],
    };
    const { getByLabelText, container } = render(
      <TableGrid table={editable} />,
    );
    const label = getByLabelText("表 1列の名前を編集");
    const header = label.closest("th")!;
    expect(header.draggable).toBe(true);
    const source =
      area === "名前"
        ? label
        : area === "記号"
          ? header.querySelector(".column-letter")!
          : header;
    const target = getByLabelText("表 3列の名前を編集").closest("th")!;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      left: 300,
      width: 160,
    } as DOMRect);
    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(source, { dataTransfer });
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.assign(over, { clientX: 440, dataTransfer });
    fireEvent(target, over);
    expect(target.classList.contains("column-drop-after")).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.assign(drop, { clientX: 440, dataTransfer });
    fireEvent(target, drop);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(
      {
        type: "moveColumn",
        id: "t",
        from: 0,
        to: 2,
        expectedColumns: editable.columns,
        expectedRows: editable.rows,
      },
      expect.any(Function),
    );
    expect(container.querySelectorAll(".column-drop-after")).toHaveLength(0);
  },
);

it("表でスクロールできない分だけを各軸でキャンバスへ渡す", () => {
  const pan = vi.fn();
  const { container } = render(
    <TableGrid table={table} onCanvasScroll={pan} />,
  );
  const viewport = container.querySelector(".grid-scroll")! as HTMLElement;
  Object.defineProperties(viewport, {
    scrollWidth: { value: 500 },
    clientWidth: { value: 300 },
    scrollHeight: { value: 1000 },
    clientHeight: { value: 400 },
  });
  fireEvent.wheel(viewport, { deltaY: 80 });
  expect(viewport.scrollTop).toBe(80);
  expect(pan).not.toHaveBeenCalled();
  viewport.scrollTop = 580;
  fireEvent.wheel(viewport, { deltaX: 30, deltaY: 60 });
  expect(viewport.scrollTop).toBe(600);
  expect(viewport.scrollLeft).toBe(30);
  expect(pan).toHaveBeenLastCalledWith(0, 40);
  viewport.scrollLeft = 0;
  viewport.scrollTop = 0;
  fireEvent.wheel(viewport, { deltaX: -20, deltaY: -40 });
  expect(pan).toHaveBeenLastCalledWith(-20, -40);
});

it("小さい表のホイールはキャンバスへ渡し、Shift横移動とピンチを区別する", () => {
  const pan = vi.fn();
  const { container } = render(
    <TableGrid table={table} onCanvasScroll={pan} />,
  );
  const viewport = container.querySelector(".grid-scroll")!;
  fireEvent.wheel(viewport, { deltaY: 3, deltaMode: 1, shiftKey: true });
  expect(pan).toHaveBeenLastCalledWith(48, 0);
  pan.mockClear();
  const pinch = new WheelEvent("wheel", {
    deltaY: 30,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  fireEvent(viewport, pinch);
  expect(pinch.defaultPrevented).toBe(false);
  expect(pan).not.toHaveBeenCalled();
});

it("行ヘッダーを範囲・追加選択し、一括削除の対象を強調する", () => {
  const { container, getByRole } = render(<TableGrid table={table} />);
  const header = (n: number) =>
    container.querySelector(`[data-row="${n}"] th`)!;
  fireEvent.click(header(1));
  fireEvent.click(header(3), { shiftKey: true });
  fireEvent.click(header(5), { metaKey: true });
  fireEvent.click(header(2), { ctrlKey: true });
  expect(
    [1, 3, 5].every((n) => header(n).getAttribute("aria-selected") === "true"),
  ).toBe(true);
  expect(header(2).getAttribute("aria-selected")).toBe("false");
  fireEvent.contextMenu(header(3));
  const item = getByRole("menuitem", { name: "選択した3行を削除" });
  fireEvent.mouseEnter(item);
  expect(container.querySelectorAll("th.delete-preview")).toHaveLength(3);
  fireEvent.click(item);
  expect(dispatch).toHaveBeenCalledWith({
    type: "removeRows",
    id: table.id,
    indices: [1, 3, 5],
    expectedRows: table.rows,
  });
});

it("列記号から複数列を選択し、全列削除を防ぐ", () => {
  const t = { ...table, columns: ["甲", "乙", "丙"], rows: [["1", "2", "3"]] };
  const { container, getByRole, rerender } = render(<TableGrid table={t} />);
  const header = (n: number) =>
    container.querySelector(`[data-column="${n}"]`)!;
  fireEvent.click(header(0).querySelector(".column-letter")!);
  fireEvent.click(header(2), { ctrlKey: true });
  fireEvent.contextMenu(header(0));
  fireEvent.click(getByRole("menuitem", { name: "選択した2列を削除" }));
  expect(dispatch).toHaveBeenCalledWith({
    type: "removeColumns",
    id: t.id,
    indices: [0, 2],
    expectedRows: t.rows,
    expectedColumns: t.columns,
  });
  fireEvent.click(header(0));
  fireEvent.click(header(2), { shiftKey: true });
  fireEvent.contextMenu(header(1));
  expect(
    (getByRole("menuitem", { name: "選択した3列を削除" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  rerender(<TableGrid table={{ ...t, columns: ["丙", "乙", "甲"] }} />);
  expect(container.querySelectorAll('[aria-selected="true"]')).toHaveLength(0);
});

it.each([
  { selected: [0, 2], target: 3, x: 440, to: 2 },
  { selected: [1, 3], target: 0, x: 310, to: 0 },
  { selected: [1, 2], target: 2, x: 440, to: null },
])("複数列 $selected をまとめて移動する", ({ selected, target, x, to }) => {
  const t = {
    ...table,
    columns: ["甲", "乙", "丙", "丁"],
    rows: [["a", "b", "c", "d"]],
  };
  const { container } = render(<TableGrid table={t} />);
  const header = (n: number) =>
    container.querySelector(`[data-column="${n}"]`)!;
  fireEvent.click(header(selected[0]));
  fireEvent.click(header(selected[1]), { metaKey: true });
  vi.spyOn(header(target), "getBoundingClientRect").mockReturnValue({
    left: 300,
    width: 160,
  } as DOMRect);
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(header(selected[1]).querySelector(".column-letter")!, {
    dataTransfer,
  });
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.assign(drop, { clientX: x, dataTransfer });
  fireEvent(header(target), drop);
  if (to === null) expect(dispatch).not.toHaveBeenCalled();
  else
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(
      {
        type: "moveColumns",
        id: t.id,
        indices: selected,
        to,
        expectedColumns: t.columns,
        expectedRows: t.rows,
      },
      expect.any(Function),
    );
});

it.each([
  { indices: [0, 2], target: 3, y: 330, to: 2 },
  { indices: [1, 3], target: 0, y: 302, to: 0 },
  { indices: [1, 2], target: 2, y: 330, to: null },
])(
  "選択行 $indices をドラッグし、移動後も選択を維持する",
  ({ indices, target, y, to }) => {
    const t = { ...table, rows: [["a"], ["b"], ["c"], ["d"]] };
    const { container, rerender } = render(<TableGrid table={t} />);
    const row = (n: number) => container.querySelector(`[data-row="${n}"]`)!;
    const header = (n: number) => row(n).querySelector("th")!;
    fireEvent.click(header(indices[0]));
    fireEvent.click(header(indices[1]), { metaKey: true });
    expect(header(indices[0]).draggable).toBe(true);
    vi.spyOn(row(target), "getBoundingClientRect").mockReturnValue({
      top: 300,
      height: 36,
    } as DOMRect);
    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(header(indices[0]), { dataTransfer });
    for (const type of ["dragover", "drop"]) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { clientY: y, dataTransfer });
      fireEvent(row(target), event);
    }
    if (to === null) {
      expect(dispatch).not.toHaveBeenCalled();
      return;
    }
    expect(dispatch).toHaveBeenCalledWith(
      {
        type: "moveRows",
        id: t.id,
        indices,
        to,
        expectedColumns: t.columns,
        expectedRows: t.rows,
      },
      expect.any(Function),
    );
    act(() => dispatch.mock.calls[0][1](true));
    const order = [0, 1, 2, 3].filter((i) => !indices.includes(i));
    order.splice(to, 0, ...indices);
    rerender(<TableGrid table={{ ...t, rows: order.map((i) => t.rows[i]) }} />);
    expect(header(to).getAttribute("aria-selected")).toBe("true");
    expect(header(to + 1).getAttribute("aria-selected")).toBe("true");
    // 選択をやり直さず、次のドラッグも同じ2行を対象にする。
    dispatch.mockClear();
    const nextTarget = to === 0 ? 3 : 0;
    vi.spyOn(row(nextTarget), "getBoundingClientRect").mockReturnValue({
      top: 300,
      height: 36,
    } as DOMRect);
    fireEvent.dragStart(header(to), { dataTransfer });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.assign(drop, { clientY: to === 0 ? 330 : 302, dataTransfer });
    fireEvent(row(nextTarget), drop);
    expect(dispatch.mock.calls[0][0].indices).toEqual([to, to + 1]);
  },
);

it("画面外へ移動してもドラッグ元の行ヘッダーを維持する", () => {
  const { container } = render(<TableGrid table={table} />);
  const header = container.querySelector('[data-row="0"] th')!;
  fireEvent.dragStart(header, { dataTransfer: { setData: vi.fn() } });
  fireEvent.scroll(container.querySelector(".grid-scroll")!, {
    target: { scrollTop: 18000 },
  });
  expect(container.querySelector('[data-row="0"] th')).toBe(header);
  fireEvent.dragEnd(header);
  expect(container.querySelector('[data-row="0"]')).toBeNull();
});

it.each([
  { kind: "row", after: false, label: "上に2行挿入", at: 0 },
  { kind: "row", after: true, label: "下に2行挿入", at: 3 },
  { kind: "column", after: false, label: "左に2列挿入", at: 0 },
  { kind: "column", after: true, label: "右に2列挿入", at: 3 },
])("右クリックから $label", ({ kind, label, at }) => {
  const t = {
    ...table,
    columns: ["甲", "乙", "丙"],
    rows: [
      ["a", "b", "c"],
      ["d", "e", "f"],
      ["g", "h", "i"],
    ],
  };
  const { container, getByRole, rerender } = render(<TableGrid table={t} />);
  const header = (i: number) =>
    container.querySelector(
      kind === "row" ? `[data-row="${i}"] th` : `[data-column="${i}"]`,
    )!;
  fireEvent.click(header(0));
  fireEvent.click(header(2), { metaKey: true });
  fireEvent.contextMenu(header(2));
  fireEvent.click(getByRole("menuitem", { name: label }));
  expect(dispatch).toHaveBeenCalledExactlyOnceWith(
    {
      type: kind === "row" ? "insertRows" : "insertColumns",
      id: t.id,
      at,
      count: 2,
      expectedColumns: t.columns,
      expectedRows: t.rows,
    },
    expect.any(Function),
  );
  const next = {
    ...t,
    columns: [...t.columns],
    rows: t.rows.map((row) => [...row]),
  };
  if (kind === "row") next.rows.splice(at, 0, ["", "", ""], ["", "", ""]);
  else {
    next.columns.splice(at, 0, "列 1", "列 2");
    next.rows.forEach((row) => row.splice(at, 0, "", ""));
  }
  act(() => dispatch.mock.calls[0][1](true, { tables: [next] }));
  rerender(<TableGrid table={next} />);
  expect(header(at).getAttribute("aria-selected")).toBe("true");
  expect(header(at + 1).getAttribute("aria-selected")).toBe("true");
  expect(container.querySelectorAll('[aria-selected="true"]')).toHaveLength(2);
});

it("最後の1行でも前後に挿入でき、上限の列には挿入できない", () => {
  const t = {
    ...table,
    columns: Array.from({ length: 50 }, (_, i) => `列${i}`),
    rows: [Array(50).fill("")],
  };
  const { container, getByRole } = render(<TableGrid table={t} />);
  fireEvent.contextMenu(container.querySelector('[data-row="0"] th')!);
  expect(
    (getByRole("menuitem", { name: "行1 を削除" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (getByRole("menuitem", { name: "下に1行挿入" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  fireEvent.contextMenu(container.querySelector('[data-column="0"]')!);
  expect(
    (getByRole("menuitem", { name: "左に1列挿入" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it.each(["", "   ", "あ".repeat(342)])(
  "無効な列名は送信せず、その場で修正できる",
  (invalid) => {
    const { getByLabelText, getByRole, queryByLabelText } = render(
      <TableGrid table={table} />,
    );
    fireEvent.doubleClick(getByLabelText("表 1列の名前を編集"));
    const input = getByLabelText("表 1列の名前");
    fireEvent.change(input, { target: { value: invalid } });
    fireEvent.blur(input);
    expect(dispatch).not.toHaveBeenCalled();
    expect(getByRole("alert").textContent).toMatch(/列名/);
    expect(getByLabelText("表 1列の名前")).toBe(input);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "新しい列名" } });
    fireEvent.blur(input);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "renameColumn",
      id: table.id,
      col: 0,
      name: "新しい列名",
      expectedColumns: table.columns,
    });
    expect(queryByLabelText("表 1列の名前")).toBeNull();
  },
);

it("貼り付け上限を超える場合は送信前に表内でエラーを表示する", () => {
  const ui = render(<TableGrid table={table} />);
  const cell = ui.getByLabelText("表 1行 1列");
  fireEvent.paste(cell, {
    clipboardData: { getData: () => Array(51).fill("値").join("\t") },
  });
  expect(dispatch).not.toHaveBeenCalled();
  expect(ui.getByRole("alert").textContent).toMatch(/5000行・50列/);
});

it("クイック検索は表示だけを絞り、元の行番号で編集する", () => {
  const source = {
    ...table,
    rows: [["非表示"], ["Apple"], ["除外"], ["APPLE 日本語"]],
  };
  const ui = render(<TableGrid table={source} />);
  fireEvent.change(ui.getByLabelText("表 クイック検索"), {
    target: { value: "apple" },
  });
  expect(ui.queryByLabelText("表 1行 1列")).toBeNull();
  expect(ui.getByLabelText("表 2行 1列")).toBeTruthy();
  expect(ui.getByLabelText("表 4行 1列")).toBeTruthy();
  expect(dispatch).not.toHaveBeenCalled();
  const cell = ui.getByLabelText("表 4行 1列");
  fireEvent.focus(cell);
  fireEvent.change(cell, { target: { value: "APPLE 編集" } });
  fireEvent.blur(cell);
  expect(dispatch).toHaveBeenCalledWith({
    type: "paste",
    id: "t",
    row: 3,
    col: 0,
    values: [["APPLE 編集"]],
    expectedValues: [["APPLE 日本語"]],
  });
  fireEvent.click(ui.getByLabelText("表 検索をクリア"));
  expect(ui.getByLabelText("表 1行 1列")).toBeTruthy();
});
it("検索結果の範囲コピーは隠れた行を含めず、複数行の貼り付けを拒否する", () => {
  const ui = render(
    <TableGrid
      table={{ ...table, rows: [["hit 1"], ["hidden"], ["hit 3"]] }}
    />,
  );
  fireEvent.change(ui.getByLabelText("表 クイック検索"), {
    target: { value: "hit" },
  });
  fireEvent.mouseDown(ui.getByLabelText("表 1行 1列"));
  fireEvent.mouseDown(ui.getByLabelText("表 3行 1列"), { shiftKey: true });
  const setData = vi.fn();
  fireEvent.copy(ui.getByLabelText("表 3行 1列"), {
    clipboardData: { setData },
  });
  expect(setData).toHaveBeenCalledWith("text/plain", "hit 1\nhit 3");
  fireEvent.paste(ui.getByLabelText("表 1行 1列"), {
    clipboardData: { getData: () => "a\nb" },
  });
  expect(ui.getByRole("alert").textContent).toContain("絞り込みを解除");
  expect(dispatch).not.toHaveBeenCalled();
});
it("検索した結果表は0件表示と検索解除に対応し、集計には元の表を渡す", () => {
  const ui = render(
    <TableGrid
      readOnly
      table={{
        ...table,
        kind: "display",
        rows: [["日本語"], ["English"]],
        footer: [true],
        footerTotals: ["42"],
      }}
    />,
  );
  fireEvent.change(ui.getByLabelText("表 クイック検索"), {
    target: { value: "該当なし" },
  });
  expect(ui.getByText("検索に一致する行はありません")).toBeTruthy();
  expect(ui.getByText("42")).toBeTruthy();
  expect(dispatch).not.toHaveBeenCalled();
  fireEvent.click(ui.getByLabelText("表 検索をクリア"));
  expect(ui.getByText("日本語")).toBeTruthy();
});
it("検索後の遠い元行番号を空白行にせず仮想表示する", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => [
    i === 999 ? "末尾の一致" : "その他",
  ]);
  const ui = render(<TableGrid table={{ ...table, rows }} />);
  fireEvent.change(ui.getByLabelText("表 クイック検索"), {
    target: { value: "末尾" },
  });
  expect(ui.getByLabelText("表 1000行 1列")).toBeTruthy();
  expect(ui.container.querySelectorAll("textarea").length).toBe(1);
  expect(ui.container.querySelector("tbody td[aria-hidden]")).toBeNull();
});

it("列の値を複数選択して表示だけを絞り込み、検索とANDで組み合わせる", () => {
  const source = {
    ...table,
    columns: ["品名", "分類"],
    rows: [
      ["赤ペン", "文房具"],
      ["りんご", "食品"],
      ["赤い袋", "日用品"],
      ["コップ", "雑貨"],
      ["青ペン", "文房具"],
    ],
  };
  const ui = render(<TableGrid table={source} />);
  fireEvent.click(ui.getByLabelText("表 分類 の表示を絞り込み"));
  fireEvent.click(ui.getByRole("button", { name: "選択を解除" }));
  expect(ui.queryByLabelText("表 1行 1列")).toBeNull();
  fireEvent.click(ui.getByRole("checkbox", { name: /文房具/ }));
  fireEvent.click(ui.getByRole("checkbox", { name: /日用品/ }));
  expect(ui.getByLabelText("表 1行 1列")).toBeTruthy();
  expect(ui.getByLabelText("表 3行 1列")).toBeTruthy();
  expect(ui.queryByLabelText("表 2行 1列")).toBeNull();
  fireEvent.click(ui.getByLabelText("値の絞り込みを閉じる"));
  fireEvent.change(ui.getByLabelText("表 クイック検索"), {
    target: { value: "赤" },
  });
  expect(ui.queryByLabelText("表 5行 1列")).toBeNull();
  expect(ui.getByLabelText("表 3行 1列")).toBeTruthy();
  expect(dispatch).not.toHaveBeenCalled();
  fireEvent.click(ui.getByRole("button", { name: "列の絞り込みを解除" }));
  fireEvent.click(ui.getByLabelText("表 検索をクリア"));
  expect(ui.getByLabelText("表 2行 1列")).toBeTruthy();
});
it("列構成が変わったら別の列へ条件を誤適用せず、空欄も選択できる", () => {
  const source = { ...table, columns: ["分類"], rows: [[""], ["A"]] };
  const ui = render(<TableGrid table={source} readOnly />);
  fireEvent.click(ui.getByLabelText("表 分類 の表示を絞り込み"));
  fireEvent.click(ui.getByRole("checkbox", { name: /A/ }));
  expect(ui.getByText("1 / 2 行")).toBeTruthy();
  expect(dispatch).not.toHaveBeenCalled();
  ui.rerender(<TableGrid table={{ ...source, columns: ["品名"] }} readOnly />);
  expect(ui.getByText("2 / 2 行")).toBeTruthy();
  expect(
    [...ui.container.querySelectorAll(".result-cell")].map(
      (el) => el.textContent,
    ),
  ).toContain("A");
});

it("表示順で範囲を選択・コピーし、編集は元の行へ送る", () => {
  const ui = render(
    <TableGrid
      table={{ ...table, columns: ["数量"], rows: [["2"], ["10"], ["1"]] }}
    />,
  );
  fireEvent.click(ui.getByLabelText("表 数量 の表示を絞り込み"));
  fireEvent.click(ui.getByRole("button", { name: "↑ 昇順" }));
  expect(
    [...ui.container.querySelectorAll("tr[data-row]")].map((el) =>
      el.getAttribute("data-row"),
    ),
  ).toEqual(["2", "0", "1"]);
  expect(
    ui.container
      .querySelector('tr[data-row="2"] th')
      ?.getAttribute("draggable"),
  ).not.toBe("true");
  expect(dispatch).not.toHaveBeenCalled();
  fireEvent.click(ui.getByLabelText("値の絞り込みを閉じる"));
  fireEvent.mouseDown(ui.getByLabelText("表 3行 1列"));
  fireEvent.mouseDown(ui.getByLabelText("表 1行 1列"), { shiftKey: true });
  const setData = vi.fn();
  fireEvent.copy(ui.getByLabelText("表 1行 1列"), {
    clipboardData: { setData },
  });
  expect(setData).toHaveBeenCalledWith("text/plain", "1\n2");
  const cell = ui.getByLabelText("表 3行 1列");
  fireEvent.focus(cell);
  fireEvent.change(cell, { target: { value: "3" } });
  fireEvent.blur(cell);
  expect(dispatch).toHaveBeenCalledWith({
    type: "paste",
    id: "t",
    row: 2,
    col: 0,
    values: [["3"]],
    expectedValues: [["1"]],
  });
});
it("行ヘッダーの範囲選択は表示順で扱い、降順と解除も出力を変更しない", () => {
  const ui = render(
    <TableGrid
      table={{ ...table, columns: ["数量"], rows: [["2"], ["10"], ["1"]] }}
    />,
  );
  const open = () =>
    fireEvent.click(ui.getByLabelText("表 数量 の表示を絞り込み"));
  open();
  fireEvent.click(ui.getByRole("button", { name: "↑ 昇順" }));
  fireEvent.click(ui.getByLabelText("値の絞り込みを閉じる"));
  fireEvent.click(ui.container.querySelector('tr[data-row="2"] th')!);
  fireEvent.click(ui.container.querySelector('tr[data-row="0"] th')!, {
    shiftKey: true,
  });
  const setData = vi.fn();
  fireEvent.copy(ui.container.querySelector('tr[data-row="0"] th')!, {
    clipboardData: { setData },
  });
  expect(setData).toHaveBeenCalledWith("text/plain", "1\n2");
  open();
  fireEvent.click(ui.getByRole("button", { name: "↓ 降順" }));
  expect(
    [...ui.container.querySelectorAll("tr[data-row]")].map((el) =>
      el.getAttribute("data-row"),
    ),
  ).toEqual(["1", "0", "2"]);
  fireEvent.click(ui.getByRole("button", { name: "並べ替え解除" }));
  expect(
    [...ui.container.querySelectorAll("tr[data-row]")].map((el) =>
      el.getAttribute("data-row"),
    ),
  ).toEqual(["0", "1", "2"]);
  expect(dispatch).not.toHaveBeenCalled();
});

it("結果表の列ヘッダーの文字からドラッグして出力列を移動できる", () => {
  const t = {
    ...table,
    kind: "display" as const,
    columns: ["名前", "個数"],
    rows: [["鉛筆", "3"]],
  };
  const { container, rerender } = render(<TableGrid table={t} readOnly />);
  const first = container.querySelector('[data-column="0"]')!;
  const last = container.querySelector('[data-column="1"]')!;
  expect(first.getAttribute("draggable")).toBe("true");
  vi.spyOn(last, "getBoundingClientRect").mockReturnValue({
    left: 300,
    width: 160,
  } as DOMRect);
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(first.querySelector(".column-letter")!, { dataTransfer });
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.assign(drop, { clientX: 450, dataTransfer });
  fireEvent(last, drop);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith(
    {
      type: "moveColumn",
      id: t.id,
      from: 0,
      to: 1,
      expectedColumns: t.columns,
      expectedRows: t.rows,
    },
    expect.any(Function),
  );
  expect(container.querySelector("textarea")).toBeNull();
  rerender(<TableGrid table={{ ...t, stale: true }} readOnly />);
  expect(
    container.querySelector('[data-column="0"]')!.getAttribute("draggable"),
  ).toBeNull();
});

it("結果表の列名をダブルクリックで変更し、空欄や重複は編集時に防ぐ", () => {
  const t = {
    ...table,
    kind: "display" as const,
    columns: ["分類", "個数"],
    rows: [["文房具", "3"]],
  };
  const ui = render(<TableGrid table={t} readOnly />);
  fireEvent.doubleClick(ui.getByLabelText("表 2列の名前を編集"));
  const input = ui.getByLabelText("表 2列の名前");
  fireEvent.change(input, { target: { value: "分類" } });
  fireEvent.blur(input);
  expect(ui.getByRole("alert").textContent).toContain("重複");
  expect(dispatch).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.blur(input);
  expect(ui.getByRole("alert").textContent).toContain("入力してください");
  fireEvent.change(input, { target: { value: "数量" } });
  fireEvent.blur(input);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({
    type: "renameColumn",
    id: t.id,
    col: 1,
    name: "数量",
    expectedColumns: t.columns,
  });
  expect(ui.queryByLabelText("表 2列の名前")).toBeNull();
});

it("結果表の列メニューから出力列を非表示にし、最後の列は残す", () => {
  const t = {
    ...table,
    kind: "display" as const,
    columns: ["分類", "個数"],
    rows: [["文房具", "3"]],
  };
  const ui = render(<TableGrid table={t} readOnly />);
  fireEvent.contextMenu(ui.container.querySelector('[data-column="1"]')!);
  expect(ui.queryByRole("menuitem", { name: /削除/ })).toBeNull();
  expect(ui.queryByRole("menuitem", { name: /挿入/ })).toBeNull();
  fireEvent.click(ui.getByRole("menuitem", { name: "「個数」列を非表示" }));
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({
    type: "hideOutputColumn",
    id: t.id,
    col: 1,
    expectedColumns: t.columns,
  });
  ui.rerender(
    <TableGrid
      table={{ ...t, columns: ["分類"], rows: [["文房具"]] }}
      readOnly
    />,
  );
  fireEvent.contextMenu(ui.container.querySelector('[data-column="0"]')!);
  expect(
    (
      ui.getByRole("menuitem", {
        name: "「分類」列を非表示",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
