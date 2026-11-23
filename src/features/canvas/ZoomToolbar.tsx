import { useRef } from "react";
import {
  getViewportForBounds,
  getNodesBounds,
  useReactFlow,
  useViewport,
} from "@xyflow/react";
import { Icon } from "../../components/Icon";

// ビューポートの購読は小さな操作バー内に限定し、全ノードへ再描画を伝播させない。
export function ZoomToolbar({ nodeIds }: { nodeIds: string[] }) {
  const { zoom } = useViewport();
  const toolbar = useRef<HTMLDivElement>(null);
  const { zoomTo, setViewport, getNodes } = useReactFlow();
  return (
    <div className="zoom-toolbar" ref={toolbar}>
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
      <button aria-label="拡大" onClick={() => zoomTo(Math.min(2, zoom + 0.1))}>
        <Icon name="plus" />
      </button>
      <div className="toolbar-separator" />
      <button
        onClick={() => {
          const ids = new Set(nodeIds);
          const nodes = getNodes().filter((node) => ids.has(node.id));
          // display:noneの未計測ノードを待たず、表示中の既知の寸法だけで合わせる。
          const canvas = toolbar.current?.parentElement;
          if (nodes.length && canvas)
            void setViewport(
              getViewportForBounds(
                getNodesBounds(nodes),
                canvas.clientWidth,
                canvas.clientHeight,
                0.4,
                1,
                0.2,
              ),
            );
        }}
      >
        <Icon name="fit" />
        全体表示
      </button>
    </div>
  );
}
