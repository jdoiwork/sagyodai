// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppSettings, FavoritePicker } from "./AppSettings";
import { PathField } from "./PathField";
const favorite = {
  id: "venv",
  name: "分析用Python",
  program: "/tmp/.venv/bin/python",
  cwd: "/tmp/work",
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("登録したお気に入りを選択できる", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 1, revision: 3, favorites: [favorite] }),
    }),
  );
  const select = vi.fn();
  const ui = render(<FavoritePicker onSelect={select} />);
  await waitFor(() =>
    expect(ui.getByRole("option", { name: favorite.name })).toBeTruthy(),
  );
  fireEvent.change(ui.getByRole("combobox"), { target: { value: "venv" } });
  expect(select).toHaveBeenCalledWith(favorite);
});
it("設定保存にはrevisionを渡し、失敗した場合は下書きを保持する", async () => {
  const fetch = vi
    .fn()
    .mockImplementation(async (_url: string, options?: RequestInit) => ({
      ok: !options,
      json: async () =>
        options
          ? { error: "別の画面で更新されました" }
          : { version: 1, revision: 3, favorites: [favorite] },
    }));
  vi.stubGlobal("fetch", fetch);
  const ui = render(<AppSettings />);
  fireEvent.click(ui.getByRole("button", { name: "設定" }));
  const name = await ui.findByLabelText("お気に入りの名前");
  fireEvent.change(name, { target: { value: "日本語の環境" } });
  fireEvent.click(ui.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(ui.getByRole("alert").textContent).toContain("別の画面"),
  );
  expect((name as HTMLInputElement).value).toBe("日本語の環境");
  expect(JSON.parse(fetch.mock.calls.find((c) => c[1])![1].body).revision).toBe(
    3,
  );
});
it("ファイルとフォルダを選択でき、キャンセルは入力を変えない", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        path: "/tmp",
        parent: "/",
        truncated: false,
        entries: [
          { name: "日本語.py", path: "/tmp/日本語.py", directory: false },
          { name: "Other.PY", path: "/tmp/Other.PY", directory: false },
          { name: "scripts", path: "/tmp/scripts", directory: true },
        ],
      }),
    }),
  );
  const change = vi.fn();
  const ui = render(
    <PathField label="スクリプトのパス" value="/old.py" onChange={change} />,
  );
  fireEvent.click(ui.getByRole("button", { name: "スクリプトのパスを選択" }));
  await ui.findByRole("button", { name: "日本語.py" });
  const search = ui.getByRole("searchbox", { name: "名前で絞り込み" });
  fireEvent.change(search, { target: { value: ".py" } });
  expect(ui.getByRole("button", { name: "Other.PY" })).toBeTruthy();
  expect(ui.queryByRole("button", { name: "scripts" })).toBeNull();
  fireEvent.change(search, { target: { value: "該当なし" } });
  expect(ui.getByRole("status").textContent).toContain(
    "一致する候補がありません",
  );
  fireEvent.change(search, { target: { value: "日本語" } });
  expect(ui.queryByRole("button", { name: "Other.PY" })).toBeNull();
  fireEvent.click(ui.getByRole("button", { name: "日本語.py" }));
  expect(change).toHaveBeenCalledWith("/tmp/日本語.py");
  ui.rerender(
    <PathField label="作業フォルダ" value="/tmp" directory onChange={change} />,
  );
  fireEvent.click(ui.getByRole("button", { name: "作業フォルダを選択" }));
  await waitFor(() =>
    expect(
      (
        ui.getByRole("button", {
          name: "このフォルダを選択",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  expect(within(ui.getByRole("dialog")).queryByText("日本語.py")).toBeNull();
  fireEvent.click(ui.getByRole("button", { name: "このフォルダを選択" }));
  expect(change).toHaveBeenLastCalledWith("/tmp");
  change.mockClear();
  fireEvent.click(ui.getByRole("button", { name: "作業フォルダを選択" }));
  fireEvent.click(ui.getByRole("button", { name: "キャンセル" }));
  expect(change).not.toHaveBeenCalled();
});
