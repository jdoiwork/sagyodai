import { cellInputError } from "../../validation/input";
import { memo, useEffect, useRef, useState } from "react";
type Props = {
  autoFocus?: boolean;
  value: string;
  label: string;
  selected: boolean;
  onSelect: (extend: boolean) => void;
  onValidationError?: (message: string) => void;
  onCommit: (value: string, original: string) => void;
  onNavigate: (direction: "next" | "previous" | "down" | "up") => void;
};
export const Cell = memo(function Cell({
  autoFocus,
  value,
  label,
  selected,
  onSelect,
  onCommit,
  onValidationError,
  onNavigate,
}: Props) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  const invalid = useRef(false);
  const focused = useRef(false);
  const composing = useRef(false);
  const endedAt = useRef(0);
  const original = useRef(value);
  useEffect(() => {
    if (!focused.current && !invalid.current) setDraft(value);
  }, [value]);
  return (
    <textarea
      autoFocus={autoFocus}
      aria-label={label}
      aria-invalid={!!error}
      title={error || undefined}
      data-committed-value={value}
      className={selected ? "cell selected-cell" : "cell"}
      rows={1}
      value={draft}
      spellCheck={false}
      onFocus={() => {
        focused.current = true;
        if (!invalid.current) original.current = value;
      }}
      onMouseDown={(e) => {
        onSelect(e.shiftKey);
        if (e.shiftKey) e.preventDefault();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        const message = cellInputError(e.target.value);
        // 不正な下書きがある間は別タブの応答で消さない。
        invalid.current = !!message;
        setError(message);
        onValidationError?.(message);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        endedAt.current = performance.now();
      }}
      onBlur={(e) => {
        focused.current = false;
        const message = cellInputError(e.target.value);
        if (message) {
          invalid.current = true;
          setError(message);
          onValidationError?.(message);
          return;
        }
        invalid.current = false;
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
          invalid.current = false;
          setError("");
          onValidationError?.("");
          e.currentTarget.blur();
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.altKey)) {
          e.preventDefault();
          if (cellInputError(e.currentTarget.value)) return;
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
