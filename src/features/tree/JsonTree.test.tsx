// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { JsonTree } from "./JsonTree";
afterEach(cleanup);
it("オブジェクトと配列を開閉し、値と特殊なキーを安全に表示する", () => {
  const ui = render(
    <JsonTree
      text={
        '{"商品":[{"名前":"ペン","数量":2}],"有効":true,"空":null,"__proto__":"値","html":"<script>test</script>"}'
      }
    />,
  );
  expect(ui.container.textContent).toContain('"有効": true');
  expect(ui.container.textContent).toContain('"空": null');
  expect(ui.container.querySelector("script")).toBeNull();
  expect(ui.container.textContent).toContain('"__proto__": "値"');
  fireEvent.click(ui.getByRole("button", { name: '"商品": 配列 (1)' }));
  fireEvent.click(ui.getByRole("button", { name: "[0]: オブジェクト (2)" }));
  expect(ui.container.textContent).toContain('"名前": "ペン"');
  fireEvent.click(ui.getByRole("button", { name: '"商品": 配列 (1)' }));
  expect(ui.container.textContent).not.toContain('"名前": "ペン"');
});
it("不正JSONから復帰し、ルートの単純値や空配列、大きな配列を表示する", () => {
  const ui = render(<JsonTree text="{" />);
  expect(ui.getByRole("alert")).toBeTruthy();
  ui.rerender(<JsonTree text="null" />);
  expect(ui.queryByRole("alert")).toBeNull();
  expect(ui.container.textContent).toBe("$: null");
  ui.rerender(<JsonTree text="[]" />);
  expect(ui.getByRole("button", { name: "$: 配列 (0)" })).toBeTruthy();
  ui.rerender(
    <JsonTree
      text={JSON.stringify(Array.from({ length: 101 }, (_, i) => i))}
    />,
  );
  expect(ui.container.textContent).not.toContain("[100]: 100");
  fireEvent.click(ui.getByRole("button", { name: "さらに表示（残り 1 件）" }));
  expect(ui.container.textContent).toContain("[100]: 100");
});
