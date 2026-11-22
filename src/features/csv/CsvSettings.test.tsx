// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TableData } from "../../api/project";
import { CsvSettings } from "./CsvSettings";
const { importCsv, dispatch } = vi.hoisted(() => ({
  importCsv: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({
    importCsv,
    dispatch,
    pending: 0,
    project: { tables: [{}, {}] },
  }),
}));
afterEach(() => {
  cleanup();
  importCsv.mockReset();
  dispatch.mockReset();
});
const table = {
  id: "csv-1",
  title: "CSV 1",
  kind: "csv",
  rows: [],
  columns: [],
  compact: false,
} as unknown as TableData;
function file(bytes: Uint8Array, size = bytes.length) {
  return { name: "商品.csv", size, arrayBuffer: async () => bytes.buffer };
}
it("選択したUTF-8ファイルとヘッダー設定を共通操作へ渡す", async () => {
  const ui = render(<CsvSettings table={table} />);
  fireEvent.click(ui.getByRole("checkbox"));
  const text = "001,日本語\n002,abc";
  fireEvent.change(ui.getByLabelText("CSV 1 CSVファイル"), {
    target: { files: [file(new TextEncoder().encode(text))] },
  });
  await waitFor(() =>
    expect(importCsv).toHaveBeenCalledWith({
      type: "importCsv",
      id: "csv-1",
      fileName: "商品.csv",
      text,
      hasHeaders: false,
    }),
  );
});
it("文字コード・容量・サーバーの入力エラーを表示し、選び直せる", async () => {
  const ui = render(<CsvSettings table={table} />);
  const choose = (value: ReturnType<typeof file>) =>
    fireEvent.change(ui.getByLabelText("CSV 1 CSVファイル"), {
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
  expect(importCsv).not.toHaveBeenCalled();
  importCsv.mockRejectedValueOnce(new Error("CSVの列数が一致しません"));
  choose(file(new TextEncoder().encode("A,B\n1")));
  await waitFor(() =>
    expect(ui.getByRole("alert").textContent).toContain("列数"),
  );
  importCsv.mockResolvedValueOnce(undefined);
  choose(file(new TextEncoder().encode("A,B\n1,2")));
  await waitFor(() => expect(ui.queryByRole("alert")).toBeNull());
  await waitFor(() =>
    expect(
      (ui.getByRole("button", { name: "CSVを選択" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
});
