// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NoteNode } from "./NoteNode";
import type { ComponentProps } from "react";
const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({ dispatch, pending: 0, project: { tables: [{}, {}] } }),
}));
vi.mock("@xyflow/react", () => ({ NodeResizer: () => null }));
vi.mock("../filter/NodeSettings", () => ({
  NodeSettings: () => <div>入力・更新設定</div>,
}));
vi.mock("../canvas/NodePorts", () => ({ NodePorts: () => null }));
vi.mock("../canvas/NodeActions", () => ({ NodeActions: () => null }));
vi.mock("../canvas/NodeTitle", () => ({ NodeTitle: () => null }));
afterEach(() => {
  cleanup();
  dispatch.mockReset();
});
function props(text: string) {
  return {
    data: {
      table: { id: "memo", kind: "note", title: "メモ", note: { text } },
      onLayoutStart: vi.fn(),
      onLayoutEnd: vi.fn(),
    },
    selected: false,
  } as unknown as ComponentProps<typeof NoteNode>;
}
it("Markdownの見出し・表を表示し、HTMLや危険なリンクを実行しない", () => {
  const ui = render(
    <NoteNode
      {...props(
        "# 見出し\n\n**重要**\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n[リンク](javascript:alert)",
      )}
    />,
  );
  expect(ui.getByRole("heading", { name: "見出し" })).toBeTruthy();
  expect(ui.getByRole("table")).toBeTruthy();
  expect(ui.container.querySelector("strong")?.textContent).toBe("重要");
  expect(ui.container.querySelector("script")).toBeNull();
  expect(ui.container.querySelector("a")?.getAttribute("href")).not.toContain(
    "javascript:",
  );
});
it("本文を編集して保存し、編集中の外部更新で下書きを失わない", () => {
  const ui = render(<NoteNode {...props("元の本文")} />);
  fireEvent.click(ui.getByRole("button", { name: /^編集$/ }));
  fireEvent.change(ui.getByLabelText("メモ 本文"), {
    target: { value: "# 自分の本文" },
  });
  ui.rerender(<NoteNode {...props("別タブの本文")} />);
  expect((ui.getByLabelText("メモ 本文") as HTMLTextAreaElement).value).toBe(
    "# 自分の本文",
  );
  expect(ui.getByRole("alert").textContent).toContain("別の操作");
  fireEvent.click(ui.getByRole("button", { name: "保存して閲覧" }));
  expect(dispatch.mock.calls[0][0]).toEqual({
    type: "setNote",
    id: "memo",
    text: "# 自分の本文",
    expectedText: "元の本文",
  });
  ui.rerender(<NoteNode {...props("# 自分の本文")} />);
  fireEvent.click(ui.getByRole("button", { name: "保存して閲覧" }));
  expect(ui.getByRole("heading", { name: "自分の本文" })).toBeTruthy();
});

it("テキストファイルもメモと同じMarkdown閲覧表示にし、編集操作は表示しない", () => {
  const node = props("");
  node.data.table = {
    ...node.data.table,
    kind: "text",
    note: undefined,
    textSource: { fileName: "sample.md", text: "# ファイル見出し\n\n**本文**" },
  };
  const ui = render(<NoteNode {...node} />);
  expect(ui.getByRole("heading", { name: "ファイル見出し" })).toBeTruthy();
  expect(ui.getByRole("button", { name: "ファイルを選び直す" })).toBeTruthy();
  expect(ui.queryByRole("button", { name: /^編集$/ })).toBeNull();
  expect(ui.queryByRole("table")).toBeNull();
  expect(ui.queryByRole("searchbox")).toBeNull();
});

it("テキスト表示は記号・改行・空白を保持し、出力を変更せずMarkdownへ戻せる", () => {
  const node = props("");
  const text = "# 見出し\n\n  **本文**\n<script>test</script>\n";
  node.data.table = {
    ...node.data.table,
    kind: "text",
    note: undefined,
    textSource: { fileName: "sample.txt", text },
  };
  const ui = render(<NoteNode {...node} />);
  fireEvent.click(ui.getByRole("button", { name: /^テキスト$/ }));
  expect(dispatch).toHaveBeenLastCalledWith({
    type: "setTextDisplay",
    id: "memo",
    display: "plain",
  });
  node.data.table = { ...node.data.table, textDisplay: "plain" };
  ui.rerender(<NoteNode {...node} />);
  expect(ui.container.querySelector("pre")?.textContent).toBe(text);
  expect(ui.container.querySelector("script")).toBeNull();
  expect(ui.queryByRole("heading", { name: "見出し" })).toBeNull();
  fireEvent.click(ui.getByRole("button", { name: "Markdown" }));
  expect(dispatch).toHaveBeenLastCalledWith({
    type: "setTextDisplay",
    id: "memo",
    display: "markdown",
  });
  node.data.table = { ...node.data.table, textDisplay: "markdown" };
  ui.rerender(<NoteNode {...node} />);
  expect(ui.getByRole("heading", { name: "見出し" })).toBeTruthy();
  expect(ui.container.querySelector("pre")).toBeNull();
});

it("結果テキストは列をタブ・行を改行で連結し、入力が更新されると表示も更新する", () => {
  const node = props("");
  node.data.table = {
    ...node.data.table,
    kind: "textDisplay",
    note: undefined,
    textDisplay: "plain",
    columns: ["A", "B"],
    rows: [
      ["日本語", "001"],
      ["", ""],
      ["末尾", "値"],
    ],
  };
  const ui = render(<NoteNode {...node} />);
  expect(ui.container.querySelector("pre")?.textContent).toBe(
    "日本語\t001\n\t\n末尾\t値",
  );
  expect(ui.queryByRole("button", { name: /^編集$/ })).toBeNull();
  expect(ui.getByText("入力・更新設定")).toBeTruthy();
  node.data.table = {
    ...node.data.table,
    rows: [["# 見出し"]],
    columns: ["本文"],
    textDisplay: "markdown",
  };
  ui.rerender(<NoteNode {...node} />);
  expect(ui.getByRole("heading", { name: "見出し" })).toBeTruthy();
});
