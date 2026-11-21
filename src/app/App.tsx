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
  const [help, setHelp] = useState(() => window.innerWidth >= 1200);
  const { zoomTo, fitView, screenToFlowPosition } = useReactFlow();
  const { zoom } = useViewport();
  const canvas = useRef<HTMLElement>(null);
  const guide = useRef<HTMLElement>(null);
  const adding = useRef<{
    kind: "input" | "filter" | "display";
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
  function addNode(kind: "input" | "filter" | "display") {
    if (!canvas.current || !project) return;
    const rect = canvas.current.getBoundingClientRect();
    const guideRect = guide.current?.getBoundingClientRect();
    const right = guideRect?.width ? guideRect.left - 16 : rect.right - 24;
    const left = rect.left + 24,
      top = rect.top + 88;
    // 大きく拡大して全体が入らない場合も、見出しと設定の起点を画面内に残す。
    const width = (kind === "filter" ? 400 : 760) * zoom;
    const height = (kind === "filter" ? 360 : 390) * zoom;
    const position = screenToFlowPosition({
      x: left + Math.max(0, (right - left - width) / 2),
      y: top + Math.max(0, (rect.bottom - 80 - top - height) / 2),
    });
    adding.current = { kind, ids: new Set(project.tables.map((t) => t.id)) };
    dispatch({ type: "addNode", kind, position });
  }
  return (
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
      <main ref={canvas} className="canvas-shell">
        <ReactFlow
          nodes={nodes}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          deleteKeyCode={null}
          nodesConnectable
          edges={(project?.tables ?? [])
            .filter((t) => t.source)
            .map((t) => ({
              id: `edge-${t.id}`,
              source: t.source!,
              target: t.id,
              sourceHandle: "out",
              targetHandle: "in",
              type: "smoothstep",
              style: {
                stroke: t.stale ? "#bd9147" : "#386e61",
                strokeWidth: 2.5,
              },
            }))}
          onConnect={(connection) =>
            dispatch({
              type: "connect",
              id: connection.target,
              source: connection.source,
            })
          }
          zoomOnDoubleClick={false}
          minZoom={0.4}
          maxZoom={2}
          panOnScroll
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
              width: Number(node.style?.width ?? node.data.table.width),
              height: Number(node.style?.height ?? node.data.table.height),
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
        <div className="canvas-toolbar">
          <button
            className="primary"
            disabled={!project || pending > 0}
            onClick={() => addNode("input")}
          >
            <Icon name="plus" />
            表を追加
          </button>
          <button
            disabled={!project || pending > 0}
            onClick={() => addNode("filter")}
          >
            <Icon name="filter" />
            フィルタ
          </button>
          <button
            disabled={!project || pending > 0}
            onClick={() => addNode("display")}
          >
            <Icon name="table" />
            結果表
          </button>
          <div className="toolbar-separator" />
          <button
            disabled={!project?.canUndo || pending > 0}
            onClick={() => dispatch({ type: "undo" })}
            title="全タブ共通の履歴を戻します"
            aria-label="元に戻す"
          >
            <Icon name="undo" />
          </button>
          <button
            disabled={!project?.canRedo || pending > 0}
            onClick={() => dispatch({ type: "redo" })}
            aria-label="やり直す"
          >
            <Icon name="redo" />
          </button>
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
          <button onClick={() => fitView({ padding: 0.2, maxZoom: 1 })}>
            <Icon name="fit" />
            全体表示
          </button>
        </div>
        <div className="canvas-hint">
          余白をドラッグして移動 · ピンチでズーム
        </div>
      </main>
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
          {project?.tables.length ?? 0} 個のノード
          <span className="status-separator">/</span>
          セル編集はフォーカス移動時に反映
        </span>
        <span>CANVAS PROTOTYPE · 01</span>
      </footer>
    </div>
  );
}
export default function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
