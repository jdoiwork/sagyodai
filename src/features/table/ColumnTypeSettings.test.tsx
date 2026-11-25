// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { TypeFields } from "./ColumnTypeSettings";
import type { TypeConfig } from "../../api/project";
import { sortDisplayRows } from "./displayOrder";
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({ dispatch: vi.fn() }),
}));
afterEach(cleanup);
it("整数と真偽値の初期値、null許容と空欄規則を独立して設定する", () => {
  function Form() {
    const [config, setConfig] = useState<TypeConfig>({
      dataType: "string",
      nullable: false,
      empty: { mode: "value", value: "" },
    });
    return <TypeFields config={config} onChange={setConfig} />;
  }
  const ui = render(<Form />);
  fireEvent.change(ui.getByLabelText("列の型"), {
    target: { value: "integer" },
  });
  expect((ui.getByLabelText("空欄の代替値") as HTMLInputElement).value).toBe(
    "0",
  );
  expect(
    (ui.getByRole("option", { name: "nullにする" }) as HTMLOptionElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(ui.getByLabelText("nullを許容する"));
  expect((ui.getByLabelText("空欄の扱い") as HTMLSelectElement).value).toBe(
    "value",
  );
  fireEvent.change(ui.getByLabelText("空欄の扱い"), {
    target: { value: "null" },
  });
  expect(ui.queryByLabelText("空欄の代替値")).toBeNull();
  fireEvent.click(ui.getByLabelText("nullを許容する"));
  expect((ui.getByLabelText("空欄の代替値") as HTMLInputElement).value).toBe(
    "0",
  );
  fireEvent.change(ui.getByLabelText("列の型"), {
    target: { value: "boolean" },
  });
  expect((ui.getByLabelText("空欄の代替値") as HTMLInputElement).value).toBe(
    "false",
  );
});
it("表示ソートは大きな整数を丸めずnullを末尾にする", () => {
  const rows = [["9007199254740993"], ["9007199254740992"], ["null"]];
  expect(
    sortDisplayRows(rows, [0, 1, 2], { column: 0, direction: "asc" }, [
      [{ type: "integer", value: rows[0][0] }],
      [{ type: "integer", value: rows[1][0] }],
      [{ type: "null" }],
    ]),
  ).toEqual([1, 0, 2]);
});
