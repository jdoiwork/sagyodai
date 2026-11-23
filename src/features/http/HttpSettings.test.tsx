// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TableData } from "../../api/project";
import { HttpSettings } from "./HttpSettings";
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
  vi.resetAllMocks();
});
const table = {
  id: "http",
  title: "HTTP 1",
  kind: "http",
  rows: [],
  columns: [],
} as unknown as TableData;
it("入力エラーを修正して取得し、再通信せず出力を切り替える", async () => {
  importSource.mockResolvedValue(undefined);
  const ui = render(<HttpSettings table={table} />);
  fireEvent.click(ui.getByRole("button", { name: "リクエスト" }));
  expect(ui.getByRole("alert").textContent).toContain("URL");
  expect(importSource).not.toHaveBeenCalled();
  fireEvent.change(ui.getByLabelText("HTTP 1 URL"), {
    target: { value: "http://localhost:9999/json" },
  });
  importSource.mockRejectedValueOnce(new Error("ヘッダーが不正です"));
  fireEvent.click(ui.getByRole("button", { name: "リクエスト" }));
  await waitFor(() =>
    expect(ui.getByRole("alert").textContent).toContain("ヘッダー"),
  );
  fireEvent.change(ui.getByLabelText("HTTP 1 送信ヘッダー"), {
    target: { value: "Accept: application/json" },
  });
  fireEvent.click(ui.getByRole("button", { name: "リクエスト" }));
  await waitFor(() => expect(ui.queryByRole("alert")).toBeNull());
  expect(importSource).toHaveBeenLastCalledWith({
    type: "fetchHttp",
    id: "http",
    config: {
      url: "http://localhost:9999/json",
      method: "GET",
      headers: "Accept: application/json",
      body: "",
    },
  });
  fireEvent.change(ui.getByLabelText("HTTP 1 出力"), {
    target: { value: "raw" },
  });
  await waitFor(() =>
    expect(importSource).toHaveBeenLastCalledWith({
      type: "setHttpOutput",
      id: "http",
      output: "raw",
    }),
  );
});
