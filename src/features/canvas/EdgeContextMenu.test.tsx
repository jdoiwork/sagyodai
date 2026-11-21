// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeContextMenu } from "./EdgeContextMenu";
afterEach(cleanup);
it("解除を選んだ時だけ実行し、Escape と外側クリックは閉じるだけ", () => {
  const onDisconnect = vi.fn(),
    onClose = vi.fn();
  const ui = render(
    <EdgeContextMenu
      x={10}
      y={10}
      onDisconnect={onDisconnect}
      onClose={onClose}
    />,
  );
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.pointerDown(document.body);
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(onDisconnect).not.toHaveBeenCalled();
  fireEvent.click(ui.getByRole("menuitem", { name: "接続を解除" }));
  expect(onDisconnect).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledTimes(3);
});

it("パレットは選択中の色を示し、選択した色だけを変更する", () => {
  const onColor = vi.fn(),
    onClose = vi.fn(),
    onDisconnect = vi.fn();
  const ui = render(
    <EdgeContextMenu
      x={0}
      y={0}
      color="blue"
      onColor={onColor}
      onClose={onClose}
      onDisconnect={onDisconnect}
    />,
  );
  expect(
    ui.getByRole("menuitemradio", { name: "青" }).getAttribute("aria-checked"),
  ).toBe("true");
  fireEvent.click(ui.getByRole("menuitemradio", { name: "紫" }));
  expect(onColor).toHaveBeenLastCalledWith("purple");
  expect(onDisconnect).not.toHaveBeenCalled();
  fireEvent.click(ui.getByRole("menuitemradio", { name: "標準色に戻す" }));
  expect(onColor).toHaveBeenLastCalledWith(null);
});
