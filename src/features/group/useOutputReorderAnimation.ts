import { useEffect, useLayoutEffect, useRef } from "react";

// UI内だけのIDを列と一緒に移動し、入力欄とフォーカスを作り直さない。
export function useOutputReorderAnimation(count: number) {
  const list = useRef<HTMLDivElement>(null);
  const ids = useRef<number[]>([]);
  const sequence = useRef(0);
  const positions = useRef<Map<string, number> | null>(null);
  const animations = useRef<Animation[]>([]);
  while (ids.current.length < count) ids.current.push(sequence.current++);
  ids.current.length = count;

  function move(from: number, to: number) {
    const elements =
      list.current?.querySelectorAll<HTMLElement>("[data-output-id]");
    positions.current = new Map();
    elements?.forEach((element) => {
      // 途中のアニメーション位置も含めて測り、ズーム倍率を除く。
      const rect = element.getBoundingClientRect();
      const scale = element.offsetHeight
        ? rect.height / element.offsetHeight
        : 1;
      positions.current?.set(
        element.dataset.outputId!,
        rect.top / (scale || 1),
      );
    });
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    [ids.current[from], ids.current[to]] = [ids.current[to], ids.current[from]];
  }

  useLayoutEffect(() => {
    const previous = positions.current;
    positions.current = null;
    if (
      !previous ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    list.current
      ?.querySelectorAll<HTMLElement>("[data-output-id]")
      .forEach((element) => {
        const oldTop = previous.get(element.dataset.outputId!);
        if (oldTop === undefined || !element.animate) return;
        const rect = element.getBoundingClientRect();
        const scale = element.offsetHeight
          ? rect.height / element.offsetHeight
          : 1;
        const distance = oldTop - rect.top / (scale || 1);
        if (Math.abs(distance) < 1) return;
        animations.current.push(
          element.animate(
            [
              {
                transform: `translateY(${distance}px)`,
                backgroundColor: "#e3f2ea",
              },
              { transform: "translateY(0)", backgroundColor: "#ffffff" },
            ],
            { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
          ),
        );
      });
  });
  useEffect(
    () => () => {
      animations.current.forEach((animation) => animation.cancel());
    },
    [],
  );
  return {
    list,
    ids: ids.current,
    move,
    remove: (index: number) => {
      ids.current.splice(index, 1);
    },
  };
}
