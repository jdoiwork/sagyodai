import { useEffect, type RefObject } from "react";

export function useTableWheel(
  viewport: RefObject<HTMLDivElement | null>,
  onCanvasScroll?: (dx: number, dy: number) => void,
) {
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      // トラックパッドのピンチは React Flow のズーム処理へ渡す。
      if (event.ctrlKey) return;
      const unitX =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1;
      const unitY =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? el.clientHeight
            : 1;
      const dx =
        event.shiftKey && event.deltaX === 0
          ? event.deltaY * unitX
          : event.deltaX * unitX;
      const dy =
        event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY * unitY;
      if (!dx && !dy) return;
      event.preventDefault();
      event.stopPropagation();
      const left = el.scrollLeft,
        top = el.scrollTop;
      el.scrollLeft = Math.max(
        0,
        Math.min(Math.max(0, el.scrollWidth - el.clientWidth), left + dx),
      );
      el.scrollTop = Math.max(
        0,
        Math.min(Math.max(0, el.scrollHeight - el.clientHeight), top + dy),
      );
      // 表で消費できなかった分だけ引き継ぐ。斜めの操作も各軸で判定する。
      const restX = dx - (el.scrollLeft - left),
        restY = dy - (el.scrollTop - top);
      if (Math.abs(restX) > 0.01 || Math.abs(restY) > 0.01)
        onCanvasScroll?.(restX, restY);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [viewport, onCanvasScroll]);
}
