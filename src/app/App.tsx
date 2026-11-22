import { AddNodeMenu } from "../features/canvas/AddNodeMenu";
import { NodeNavigation } from "../features/canvas/NodeActions";
import { nodeSize } from "../features/canvas/layout";
import { SheetBar } from "../features/sheets/SheetBar";
import { sheetOf, sheetsOf } from "../features/sheets/model";
import { unionInputHandle } from "../features/union/ports";
import { colorValue } from "../features/canvas/colors";
import { EdgeContextMenu } from "../features/canvas/EdgeContextMenu";
import { createsCycle, MAX_NODES } from "../validation/input";
import { CANVAS_SCROLL_SPEED } from "../features/canvas/scroll";
import { Icon } from "../components/Icon";
import { SyncConflicts } from "../features/project/SyncConflicts";
import { useEffect, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
} from "@xyflow/react";
import { useProject } from "./ProjectContext";
import { TableNode } from "../features/canvas/TableNode";
import { useCanvasNodes } from "../features/canvas/useCanvasNodes";
import { ProjectFiles } from "../features/project/ProjectFiles";
const nodeTypes = { table: TableNode };
function Canvas() {
  const { project, dispatch, error, pending, connected } = useProject();
  const { nodes, onNodesChange, begin, finish, selectNode } = useCanvasNodes(
    project,
    dispatch,
    pending,
  );
  const [selectedSheet, setSelectedSheet] = useState("sheet-1");
  const activeSheet = sheetsOf(project).some((s) => s.id === selectedSheet)
    ? selectedSheet
    : sheetsOf(project)[0].id;
  const visibleTables =
    project?.tables.filter((t) => sheetOf(t) === activeSheet) ?? [];
  const visibleIds = new Set(visibleTables.map((t) => t.id));
  const [edgeMenu, setEdgeMenu] = useState<{
    x: number;
    y: number;
    target: string;
    source: string;
    revision: number;
  } | null>(null);
  const connectionFromInput = useRef(false);
  const [connectionColor, setConnectionColor] = useState<string>();
  const [help, setHelp] = useState(() => window.innerWidth >= 1200);
  const { zoomTo, fitView, screenToFlowPosition, getViewport, setViewport } =
    useReactFlow();
  const { zoom } = useViewport();
  const viewports = useRef(
    new Map<string, { x: number; y: number; zoom: number }>(),
  );
  const previousSheet = useRef(activeSheet);
  useEffect(() => {
    if (previousSheet.current === activeSheet) return;
    viewports.current.set(previousSheet.current, getViewport());
    previousSheet.current = activeSheet;
    void setViewport(
      viewports.current.get(activeSheet) ?? { x: 0, y: 0, zoom: 1 },
    );
    setEdgeMenu(null);
  }, [activeSheet, getViewport, setViewport]);
  const canvas = useRef<HTMLElement>(null);
  const guide = useRef<HTMLElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const adding = useRef<{
    kind:
      | "input"
      | "csv"
      | "filter"
      | "display"
      | "union"
      | "sort"
      | "aggregate"
      | "replace"
      | "note";
    ids: Set<string>;
  } | null>(null);
  useEffect(() => {
    if (!adding.current || !project) return;
    const added = project.tables.find(
      (t) => t.kind === adding.current?.kind && !adding.current.ids.has(t.id),
    );
    if (added) {
      selectNode(added.id);
      adding.current = null;
    } else if (!pending) adding.current = null;
  }, [project, pending, selectNode]);
  function addNode(
    kind:
      | "input"
      | "csv"
      | "filter"
      | "display"
      | "union"
      | "sort"
      | "aggregate"
      | "replace"
      | "note",
  ) {
    if (
      !canvas.current ||
      !project ||
      pending > 0 ||
      project.tables.length >= MAX_NODES
    )
      return;
    const rect = canvas.current.getBoundingClientRect();
    const guideRect = guide.current?.getBoundingClientRect();
    const right = guideRect?.width ? guideRect.left - 16 : rect.right - 24;
    const left = rect.left + 24,
      top =
        (toolbar.current?.getBoundingClientRect().bottom ?? rect.top + 72) + 16;
    // 大きく拡大して全体が入らない場合も、見出しと設定の起点を画面内に残す。
    const width =
      (kind === "sort" || kind === "aggregate" || kind === "replace"
        ? 520
        : kind === "filter" || kind === "union"
          ? 440
          : kind === "note"
            ? 400
            : 760) * zoom;
    const height =
      (kind === "aggregate" || kind === "replace"
        ? 480
        : kind === "filter" || kind === "union" || kind === "sort"
          ? 360
          : kind === "note"
            ? 360
            : 390) * zoom;
    const position = screenToFlowPosition({
      x: left + Math.max(0, (right - left - width) / 2),
      y: top + Math.max(0, (rect.bottom - 80 - top - height) / 2),
    });
    adding.current = { kind, ids: new Set(project.tables.map((t) => t.id)) };
    dispatch({ type: "addNode", kind, position, sheetId: activeSheet });
  }
  return (
    <NodeNavigation.Provider
      value={{
        activeSheet,
        onMoved: (table) => {
          const rect = canvas.current?.getBoundingClientRect();
          const { width, height } = nodeSize(table);
          const zoom = Math.max(
            0.4,
            Math.min(
              1,
              (rect?.width ?? 900) / (width + 100),
              (rect?.height ?? 600) / (height + 140),
            ),
          );
          viewports.current.set(sheetOf(table), {
            x: (rect?.width ?? 900) / 2 - (table.x + width / 2) * zoom,
            y: (rect?.height ?? 600) / 2 - (table.y + height / 2) * zoom,
            zoom,
          });
          if (sheetOf(table) === activeSheet) {
            void setViewport(viewports.current.get(activeSheet)!);
          }
          setSelectedSheet(sheetOf(table));
          selectNode(table.id);
        },
      }}
    >
      <div className="workspace">
        <header className="app-header">
          <div className="brand-mark">▦</div>
          <div className="brand">
            作業台<span>SAGYODAI</span>
          </div>
          <div className="header-divider" />
          <span className="project-name">はじめてのキャンバス</span>
          <span className="prototype-label">操作感の試作</span>
          <div className="header-right">
            <ProjectFiles />
            <button className="help-button" onClick={() => setHelp((v) => !v)}>
              <Icon name="help" />
              操作ガイド
            </button>
          </div>
        </header>
        {edgeMenu &&
          project?.revision === edgeMenu.revision &&
          project.tables.some(
            (t) =>
              t.id === edgeMenu.target &&
              (t.source === edgeMenu.source ||
                t.unionInputs?.some((i) => i.source === edgeMenu.source)),
          ) && (
            <EdgeContextMenu
              x={edgeMenu.x}
              y={edgeMenu.y}
              color={
                project.tables
                  .find((t) => t.id === edgeMenu.target)
                  ?.unionInputs?.find((i) => i.source === edgeMenu.source)
                  ?.color ??
                project.tables.find((t) => t.id === edgeMenu.target)?.edgeColor
              }
              onColor={(color) =>
                dispatch(
                  project.tables.find((t) => t.id === edgeMenu.target)?.kind ===
                    "union"
                    ? {
                        type: "setUnionEdgeColor",
                        id: edgeMenu.target,
                        source: edgeMenu.source,
                        color,
                      }
                    : {
                        type: "setColor",
                        id: edgeMenu.target,
                        target: "edge",
                        color,
                      },
                )
              }
              onClose={() => setEdgeMenu(null)}
              onDisconnect={() => {
                const t = project.tables.find((t) => t.id === edgeMenu.target)!;
                if (t.kind === "union") {
                  const sources = (t.unionInputs ?? []).map((i) => i.source);
                  dispatch({
                    type: "setUnion",
                    id: t.id,
                    sources: sources.filter((s) => s !== edgeMenu.source),
                    expectedSources: sources,
                    distinct: !!t.unionDistinct,
                  });
                } else dispatch({ type: "connect", id: t.id, source: null });
              }}
            />
          )}
        <main ref={canvas} className="canvas-shell">
          <ReactFlow
            // 非表示シートの入力途中の値を保持するため、ノードをアンマウントしない。
            nodes={nodes.map((node) => ({
              ...node,
              selected: visibleIds.has(node.id) && node.selected,
              draggable: visibleIds.has(node.id),
              selectable: visibleIds.has(node.id),
              style: {
                ...node.style,
                visibility: visibleIds.has(node.id) ? "visible" : "hidden",
              },
            }))}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            deleteKeyCode={null}
            onEdgeContextMenu={(event, edge) => {
              event.preventDefault();
              event.stopPropagation();
              if (project && !pending)
                setEdgeMenu({
                  x: event.clientX,
                  y: event.clientY,
                  target: edge.target,
                  source: edge.source,
                  revision: project.revision,
                });
            }}
            onMoveStart={() => setEdgeMenu(null)}
            nodesConnectable
            onConnectStart={(_, params) => {
              connectionFromInput.current = params.handleType === "target";
              const table = project?.tables.find((t) => t.id === params.nodeId);
              setConnectionColor(
                colorValue(
                  connectionFromInput.current
                    ? table?.inputColor
                    : table?.outputColor,
                ),
              );
            }}
            onConnectEnd={() => setConnectionColor(undefined)}
            connectionLineStyle={{
              stroke: connectionColor ?? "#396b5b",
              strokeWidth: 2.5,
            }}
            connectionRadius={28}
            reconnectRadius={16}
            onReconnect={(edge, connection) =>
              dispatch({
                type: "connect",
                id: edge.target,
                source: connection.source,
              })
            }
            edges={visibleTables.flatMap((t) => {
              const inputs =
                t.kind === "union"
                  ? (t.unionInputs ?? [])
                  : t.source
                    ? [{ source: t.source, color: t.edgeColor }]
                    : [];
              return inputs
                .filter((input) => visibleIds.has(input.source))
                .map((input) => ({
                  id: `edge-${t.id}-${input.source}`,
                  source: input.source,
                  target: t.id,
                  sourceHandle: "out",
                  targetHandle:
                    t.kind === "union" ? unionInputHandle(input.source) : "in",
                  type: "smoothstep",
                  reconnectable:
                    t.kind === "union" ? (false as const) : ("source" as const),
                  style: {
                    stroke:
                      colorValue(input.color) ??
                      (t.stale ? "#bd9147" : "#386e61"),
                    strokeDasharray: t.stale ? "6 4" : undefined,
                    strokeWidth: 2.5,
                  },
                }));
            })}
            isValidConnection={(connection) =>
              !!project &&
              project.tables.some((t) => t.id === connection.source) &&
              project.tables.some(
                (t) =>
                  t.id === connection.target &&
                  t.kind !== "input" &&
                  t.kind !== "csv" &&
                  t.kind !== "note" &&
                  (t.kind !== "union" || connection.targetHandle === "in"),
              ) &&
              !createsCycle(
                project.tables,
                connection.target,
                connection.source,
              )
            }
            onConnect={(connection) =>
              dispatch({
                type: "connectFromPort",
                id: connection.target,
                source: connection.source,
                fromInput: connectionFromInput.current,
              })
            }
            zoomOnDoubleClick={false}
            minZoom={0.4}
            maxZoom={2}
            panOnScroll
            panOnScrollSpeed={CANVAS_SCROLL_SPEED}
            zoomOnScroll={false}
            panOnDrag
            selectionOnDrag={false}
            autoPanOnNodeFocus={false}
            autoPanOnNodeDrag={false}
            multiSelectionKeyCode={null}
            onNodeDragStart={(_, node) => begin(node.id)}
            onNodeDragStop={(_, node) =>
              finish(node.id, {
                x: node.position.x,
                y: node.position.y,
                width: node.data.table.compact
                  ? node.data.table.width
                  : Number(node.style?.width ?? node.data.table.width),
                height: node.data.table.compact
                  ? node.data.table.height
                  : Number(node.style?.height ?? node.data.table.height),
              })
            }
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1.3}
              color="#cdd6d2"
            />
          </ReactFlow>
          <div
            ref={toolbar}
            className="canvas-toolbar"
            aria-busy={pending > 0}
            aria-describedby={
              project && project.tables.length >= MAX_NODES
                ? "node-limit-message"
                : undefined
            }
          >
            {project && project.tables.length >= MAX_NODES && (
              <div
                id="node-limit-message"
                className="node-limit-message"
                role="status"
              >
                <strong>
                  ノード数が上限の{MAX_NODES}個に達したため、追加できません。
                </strong>
                <span>
                  全シートの合計が対象です。不要なノードを削除すると追加できます。
                </span>
              </div>
            )}
            <AddNodeMenu
              category="source"
              disabled={
                !project || project.tables.length >= MAX_NODES || pending > 0
              }
              onAdd={addNode}
            />
            <AddNodeMenu
              category="processing"
              disabled={
                !project || project.tables.length >= MAX_NODES || pending > 0
              }
              onAdd={addNode}
            />
            <button
              disabled={!project || project.tables.length >= MAX_NODES}
              title={
                project && project.tables.length >= MAX_NODES
                  ? `上限の${MAX_NODES}ノードに達しています`
                  : undefined
              }
              aria-disabled={
                !project || project.tables.length >= MAX_NODES || pending > 0
              }
              onClick={() => addNode("display")}
            >
              <Icon name="table" />
              結果表
            </button>
            <div className="toolbar-history">
              <div className="toolbar-separator" />
              <button
                disabled={!project?.canUndo}
                aria-disabled={!project?.canUndo || pending > 0}
                onClick={() => {
                  if (!pending) dispatch({ type: "undo" });
                }}
                title="全タブ共通の履歴を戻します"
                aria-label="元に戻す"
              >
                <Icon name="undo" />
              </button>
              <button
                disabled={!project?.canRedo}
                aria-disabled={!project?.canRedo || pending > 0}
                onClick={() => {
                  if (!pending) dispatch({ type: "redo" });
                }}
                aria-label="やり直す"
              >
                <Icon name="redo" />
              </button>
            </div>
          </div>
          {help && (
            <aside ref={guide} className="guide">
              <div className="guide-eyebrow">CANVAS PLAYGROUND</div>
              <h1>
                表を置いて、
                <br />
                自由に試す。
              </h1>
              <p>
                セルをクリックして入力。
                <br />
                表計算ソフトのデータも、そのまま。
              </p>
              <ol>
                <li>
                  <strong>日本語を入力</strong>
                  <span>
                    変換の Enter は入力を確定。
                    <br />
                    もう一度 Enter で次の行へ。
                  </span>
                </li>
                <li>
                  <strong>まとめて貼り付け</strong>
                  <span>
                    タブと改行を行・列に展開。
                    <br />
                    足りない行や列は自動追加。
                  </span>
                </li>
                <li>
                  <strong>広げて、並べる</strong>
                  <span>
                    見出しをドラッグして移動。
                    <br />
                    選択した表の端でサイズ変更。
                  </span>
                </li>
              </ol>
              <div className="guide-tip">
                Shift＋クリックで範囲選択
                <br />
                ⌘C で選択範囲をコピー
                <br />
                Tab / Enter でセル移動
              </div>
            </aside>
          )}
          <SyncConflicts />
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {!project && !error && (
            <div className="loading">キャンバスを準備しています…</div>
          )}
          <div className="zoom-toolbar">
            <button
              aria-label="縮小"
              onClick={() => zoomTo(Math.max(0.4, zoom - 0.1))}
            >
              <Icon name="minus" />
            </button>
            <button
              className="zoom-value"
              title="100% に戻す"
              onClick={() => zoomTo(1)}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              aria-label="拡大"
              onClick={() => zoomTo(Math.min(2, zoom + 0.1))}
            >
              <Icon name="plus" />
            </button>
            <div className="toolbar-separator" />
            <button
              onClick={() =>
                fitView({
                  nodes: visibleTables.map((t) => ({ id: t.id })),
                  padding: 0.2,
                  maxZoom: 1,
                })
              }
            >
              <Icon name="fit" />
              全体表示
            </button>
          </div>
          <div className="canvas-hint">
            出力 → 入力へドラッグで接続 · 余白で移動 · ピンチでズーム
          </div>
        </main>
        <SheetBar active={activeSheet} onSelect={setSelectedSheet} />
        <footer className="statusbar">
          <span>
            <i className={error ? "status-dot error" : "status-dot"} />
            {error
              ? "要確認"
              : pending
                ? "反映中…"
                : project
                  ? connected
                    ? "同期中"
                    : "再接続中…"
                  : "接続中"}
          </span>
          <span>
            {visibleTables.length} 個のノード（全体{" "}
            {project?.tables.length ?? 0}）
            <span className="status-separator">/</span>
            セル編集はフォーカス移動時に反映
          </span>
          <span>CANVAS PROTOTYPE · 01</span>
        </footer>
      </div>
    </NodeNavigation.Provider>
  );
}
export default function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
