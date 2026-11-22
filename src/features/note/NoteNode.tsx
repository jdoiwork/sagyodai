import { NodeSettings } from "../filter/NodeSettings";
import { TextSettings } from "../text/TextSettings";
import { NodePorts } from "../canvas/NodePorts";
import { useEffect, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TableFlowNode } from "../canvas/layout";
import { NodeTitle } from "../canvas/NodeTitle";
import { NodeActions } from "../canvas/NodeActions";
import { Icon } from "../../components/Icon";
import { useProject } from "../../app/ProjectContext";

export function NoteNode({ data, selected }: NodeProps<TableFlowNode>) {
  const { dispatch, pending, project } = useProject();
  const table = data.table;
  const isResult = table.kind === "textDisplay";
  const isViewer = isResult || table.kind === "text";
  const isFile = table.kind === "text";
  const text = isResult
    ? table.rows.map((row) => row.join("\t")).join("\n")
    : isFile
      ? (table.textSource?.text ?? "")
      : (table.note?.text ?? "");
  const plainText = table.textDisplay === "plain";
  function setPlainText(plain: boolean) {
    dispatch({
      type: "setTextDisplay",
      id: table.id,
      display: plain ? "plain" : "markdown",
    });
  }
  const [editing, setEditing] = useState(!isViewer && !text);
  const [draft, setDraft] = useState(text);
  const [original, setOriginal] = useState(text);
  // 競合の再適用で自分の本文が保存された場合も、次の保存を競合にしない。
  useEffect(() => {
    if (text === draft) setOriginal(text);
  }, [text, draft]);
  const error =
    new TextEncoder().encode(draft).length > 100000
      ? "メモは100000バイト以内にしてください。"
      : draft.split("\n").length > 5000
        ? "メモの出力は5000行以内にしてください（空行も含みます）。"
        : "";
  function save() {
    if (error || pending) return;
    if (draft === original) {
      setEditing(false);
      return;
    }
    dispatch(
      { type: "setNote", id: table.id, text: draft, expectedText: original },
      (ok) => {
        if (ok) setEditing(false);
      },
    );
  }
  return (
    <>
      <NodePorts table={table} />
      <section className="table-node note-node" aria-label={table.title}>
        <NodeResizer
          isVisible={selected && !table.compact}
          minWidth={380}
          minHeight={240}
          maxWidth={2400}
          maxHeight={1600}
          onResizeStart={data.onLayoutStart}
          onResizeEnd={(_, p) =>
            data.onLayoutEnd({
              x: p.x,
              y: p.y,
              width: p.width,
              height: p.height,
            })
          }
        />
        <header className="table-drag-handle">
          <div
            className="table-icon"
            title={isResult ? "結果テキスト" : isFile ? "テキスト入力" : "メモ"}
          >
            <Icon name="note" />
          </div>
          <div>
            <NodeTitle table={table} />
            <span>
              {isViewer
                ? `${isResult ? "結果テキスト" : "テキストファイル"} · ${plainText ? "テキスト" : "Markdown"}`
                : "メモ · Markdown"}
            </span>
          </div>
          {isViewer && (
            <button
              className="nodrag nopan"
              aria-label={`${table.title} ${table.compact ? "展開" : "コンパクト表示"}`}
              aria-expanded={!table.compact}
              onClick={() =>
                dispatch({
                  type: "setCompact",
                  id: table.id,
                  compact: !table.compact,
                })
              }
            >
              <Icon name={table.compact ? "expand" : "collapse"} />
              {table.compact ? "展開" : "縮小"}
            </button>
          )}
          <NodeActions table={table} />
          <span className="grip" aria-hidden="true">
            ⠿
          </span>
        </header>
        {isResult ? (
          <NodeSettings table={table} />
        ) : isFile ? (
          <TextSettings table={table} />
        ) : (
          <div className="note-actions nodrag nopan">
            {editing ? (
              <>
                <button disabled={!!error || pending > 0} onClick={save}>
                  <Icon name="check" />
                  保存して閲覧
                </button>
                <button
                  disabled={pending > 0}
                  onClick={() => {
                    setDraft(text);
                    setOriginal(text);
                    setEditing(false);
                  }}
                >
                  キャンセル
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setDraft(text);
                  setOriginal(text);
                  setEditing(true);
                }}
              >
                <Icon name="edit" />
                編集
              </button>
            )}
            <button
              className="action-danger"
              disabled={pending > 0 || project?.tables.length === 1}
              onClick={() => dispatch({ type: "removeNode", id: table.id })}
            >
              <Icon name="trash" />
              削除
            </button>
          </div>
        )}
        {isViewer && !table.compact && (
          <div
            className="note-actions nodrag nopan"
            role="group"
            aria-label={`${table.title} 表示形式`}
          >
            <button
              disabled={pending > 0}
              aria-pressed={!plainText}
              onClick={() => setPlainText(false)}
            >
              Markdown
            </button>
            <button
              disabled={pending > 0}
              aria-pressed={plainText}
              onClick={() => setPlainText(true)}
            >
              テキスト
            </button>
          </div>
        )}
        {editing ? (
          <>
            {draft !== original && (
              <span className="condition-dirty note-message">
                未保存の変更があります
              </span>
            )}
            {text !== original && (
              <p className="node-error note-message" role="alert">
                別の操作でメモが更新されています。保存時に競合を確認します。
              </p>
            )}
            {error && (
              <p className="node-error note-message" role="alert">
                {error}
              </p>
            )}
            <textarea
              className="note-editor nodrag nopan nowheel"
              aria-label={`${table.title} 本文`}
              aria-invalid={!!error}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="メモを入力（Markdown対応）"
              onKeyDown={(e) => e.stopPropagation()}
            />
          </>
        ) : (
          <div
            className="note-preview nodrag nopan nowheel"
            hidden={isViewer && table.compact}
            aria-label={`${table.title} 閲覧`}
          >
            {text ? (
              isViewer && plainText ? (
                <pre className="text-file-plain">{text}</pre>
              ) : (
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  skipHtml
                  components={{
                    a: ({ children, href, title }) => (
                      <a
                        href={href}
                        title={title}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {children}
                      </a>
                    ),
                  }}
                >
                  {text}
                </Markdown>
              )
            ) : (
              <p className="note-empty">
                {isResult
                  ? "表示する結果はありません。"
                  : isFile
                    ? table.textSource
                      ? "ファイルは空です。"
                      : "ファイルを選択すると本文を表示します。"
                    : "メモは空です。「編集」から入力できます。"}
              </p>
            )}
          </div>
        )}
      </section>
    </>
  );
}
