import { memo, useEffect, useRef, useState } from "react";
type Props = {
  value: string;
  label: string;
  selected: boolean;
  onSelect: (extend: boolean) => void;
  onCommit: (value: string, original: string) => void;
  onNavigate: (direction: "next" | "previous" | "down" | "up") => void;
};
export const Cell = memo(function Cell({
  value,
  label,
  selected,
  onSelect,
  onCommit,
  onNavigate,
}: Props) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const composing = useRef(false);
  const endedAt = useRef(0);
  const original = useRef(value);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <textarea
      aria-label={label}
      data-committed-value={value}
      className={selected ? "cell selected-cell" : "cell"}
      rows={1}
      value={draft}
      spellCheck={false}
      onFocus={() => {
        focused.current = true;
        original.current = value;
      }}
      onMouseDown={(e) => {
        onSelect(e.shiftKey);
        if (e.shiftKey) e.preventDefault();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        endedAt.current = performance.now();
      }}
      onBlur={(e) => {
        focused.current = false;
        if (e.target.value !== original.current)
          onCommit(e.target.value, original.current);
        else setDraft(value);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        // Safari では変換確定の Enter と compositionend の順序が異なることがある。
        if (
          composing.current ||
          e.nativeEvent.isComposing ||
          e.keyCode === 229 ||
          performance.now() - endedAt.current < 60
        )
          return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.value = original.current;
          setDraft(original.current);
          e.currentTarget.blur();
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.altKey)) {
          e.preventDefault();
          onNavigate(
            e.key === "Tab"
              ? e.shiftKey
                ? "previous"
                : "next"
              : e.shiftKey
                ? "up"
                : "down",
          );
        }
      }}
    />
  );
});
