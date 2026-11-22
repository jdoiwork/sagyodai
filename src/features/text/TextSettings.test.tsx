// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TableData } from "../../api/project";
import { TextSettings } from "./TextSettings";
const { importSource, dispatch } = vi.hoisted(() => ({
  importSource: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({
    importSource,
    dispatch,
    pending: 0,
    project: { tables: [{}, {}] },
  }),
}));
afterEach(() => {
  cleanup();
  importSource.mockReset();
  dispatch.mockReset();
});
const table = {
  id: "text-1",
  title: "テキスト 1",
  kind: "text",
  rows: [],
  columns: [],
  compact: false,
} as unknown as TableData;
function file(bytes: Uint8Array, size = bytes.length) {
  return { name: "商品.txt", size, arrayBuffer: async () => bytes.buffer };
}
it("選択したUTF-8テキストを共通操作へ渡す", async () => {
  const ui = render(<TextSettings table={table} />);
  const text = "001,日本語\n002,abc";
  fireEvent.change(ui.getByLabelText("テキスト 1 テキストファイル"), {
    target: { files: [file(new TextEncoder().encode(text))] },
  });
  await waitFor(() =>
    expect(importSource).toHaveBeenCalledWith({
      type: "importText",
      id: "text-1",
      fileName: "商品.txt",
      text,
    }),
  );
});
it("文字コード・容量・サーバーの入力エラーを表示し、選び直せる", async () => {
  const ui = render(<TextSettings table={table} />);
  const choose = (value: ReturnType<typeof file>) =>
    fireEvent.change(ui.getByLabelText("テキスト 1 テキストファイル"), {
      target: { files: [value] },
    });
  choose(file(new Uint8Array([0xff])));
  await waitFor(() =>
    expect(ui.getByRole("alert").textContent).toContain("UTF-8"),
  );
  choose(file(new Uint8Array(), 1024 * 1024 + 1));
  await waitFor(() =>
    expect(ui.getByRole("alert").textContent).toContain("1 MiB"),
  );
  expect(importSource).not.toHaveBeenCalled();
  importSource.mockRejectedValueOnce(
    new Error("テキストの行数が上限を超えています"),
  );
  choose(file(new TextEncoder().encode("A,B\n1")));
  await waitFor(() =>
    expect(ui.getByRole("alert").textContent).toContain("行数"),
  );
  importSource.mockResolvedValueOnce(undefined);
  choose(file(new TextEncoder().encode("A,B\n1,2")));
  await waitFor(() => expect(ui.queryByRole("alert")).toBeNull());
  await waitFor(() =>
    expect(
      (ui.getByRole("button", { name: "ファイルを選択" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
});
