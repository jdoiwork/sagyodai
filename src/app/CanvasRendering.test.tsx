// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { TableFlowNode } from "../features/canvas/layout";
import App from "./App";

const state = vi.hoisted(() => ({
  viewport: { x: 0, y: 0, zoom: 1 },
  listeners: new Set<() => void>(),
  flowRender: vi.fn(),
  bounds: vi.fn(() => ({ x: 0, y: 0, width: 400, height: 300 })),
}));
vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  const api = {
    getViewport: () => state.viewport,
    getNodes: () => [{ id: "one" }, { id: "two" }],
    setViewport: vi.fn(),
    zoomTo: vi.fn(),
    fitView: vi.fn(),
    screenToFlowPosition: (p: unknown) => p,
  };
  return {
    ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
    ReactFlow: ({
      nodes,
      children,
    }: {
      nodes: TableFlowNode[];
      children: ReactNode;
    }) => {
      state.flowRender();
      return (
        <>
          {nodes.map((n) => (
            <div key={n.id} style={n.style} data-testid={n.id}>
              <input aria-label={n.id} defaultValue="" />
            </div>
          ))}
          {children}
        </>
      );
    },
    getNodesBounds: state.bounds,
    getViewportForBounds: () => ({ x: 0, y: 0, zoom: 1 }),
    Background: () => null,
    BackgroundVariant: { Dots: "dots" },
    useReactFlow: () => api,
    useViewport: () =>
      React.useSyncExternalStore(
        (callback) => {
          state.listeners.add(callback);
          return () => {
            state.listeners.delete(callback);
          };
        },
        () => state.viewport,
      ),
  };
});
vi.mock("../features/canvas/TableNode", () => ({ TableNode: () => null }));
vi.mock("../features/project/ProjectFiles", () => ({
  ProjectFiles: () => null,
}));
vi.mock("../features/project/SyncConflicts", () => ({
  SyncConflicts: () => null,
}));
vi.mock("./ProjectContext", () => {
  const tables = [
    { id: "one", sheetId: "sheet-1" },
    { id: "two", sheetId: "sheet-2" },
  ];
  return {
    useProject: () => ({
      project: {
        tables,
        sheets: [
          { id: "sheet-1", title: "入力" },
          { id: "sheet-2", title: "結果" },
        ],
      },
      pending: 0,
      connected: true,
      dispatch: vi.fn(),
    }),
  };
});
vi.mock("../features/canvas/useCanvasNodes", () => {
  const nodes = ["one", "two"].map((id) => ({
    id,
    style: { width: 400 },
    data: { table: {} },
  }));
  return { useCanvasNodes: () => ({ nodes, selectNode: vi.fn() }) };
});
afterEach(cleanup);

it("パン・ズームで全ノードを再描画せず、シート切替後も下書きDOMを保持する", () => {
  const ui = render(<App />);
  const before = state.flowRender.mock.calls.length;
  act(() => {
    state.viewport = { x: -500, y: -300, zoom: 1.5 };
    state.listeners.forEach((fn) => fn());
  });
  expect(ui.getByRole("button", { name: "150%" })).toBeTruthy();
  expect(state.flowRender.mock.calls.length).toBe(before);
  const draft = ui.getByLabelText("one");
  fireEvent.change(draft, { target: { value: "未適用の日本語" } });
  expect(ui.getByTestId("two").style.display).toBe("none");
  fireEvent.click(ui.getByRole("tab", { name: "結果" }));
  expect(ui.getByTestId("one").style.display).toBe("none");
  expect(ui.getByTestId("two").style.display).toBe("");
  fireEvent.click(ui.getByRole("button", { name: "全体表示" }));
  expect(state.bounds).toHaveBeenLastCalledWith([{ id: "two" }]);
  fireEvent.click(ui.getByRole("tab", { name: "入力" }));
  expect(ui.getByLabelText("one")).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe("未適用の日本語");
});
