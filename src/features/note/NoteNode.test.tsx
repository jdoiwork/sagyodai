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
