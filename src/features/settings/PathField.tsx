import { Icon } from "../../components/Icon";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { z } from "zod";
import { request } from "./api";
const listingSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  truncated: z.boolean(),
  entries: z.array(
    z.object({ name: z.string(), path: z.string(), directory: z.boolean() }),
  ),
});
export function PathField({
  label,
  value,
  onChange,
  directory = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  directory?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="path-field">
      <label>
        {label}
        <input
          aria-label={label}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <button
        type="button"
        aria-label={`${label}を選択`}
        onClick={() => setOpen(true)}
      >
        参照…
      </button>
      {open &&
        createPortal(
          <PathPicker
            label={label}
            initial={value}
            directory={directory}
            onClose={() => setOpen(false)}
            onSelect={(p) => {
              onChange(p);
              setOpen(false);
            }}
          />,
          document.body,
        )}
    </div>
  );
}
function PathPicker({
  label,
  initial,
  directory,
  onClose,
  onSelect,
}: {
  label: string;
  initial: string;
  directory: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [path, setPath] = useState(initial);
  const [query, setQuery] = useState("");
  const [listing, setListing] = useState<z.infer<typeof listingSchema> | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  async function load(p: string) {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await request("/api/paths", listingSchema, { path: p });
      if (current === generation.current) {
        setListing(next);
        setPath(next.path);
        setQuery("");
      }
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : "フォルダを開けません。");
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    ref.current?.showModal();
    void load(initial);
    return () => {
      generation.current++;
    };
  }, [initial]);
  const entries =
    listing?.entries.filter(
      (entry) =>
        (!directory || entry.directory) &&
        entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ) ?? [];
  return (
    <dialog
      ref={ref}
      className="app-settings-dialog path-picker"
      aria-label={`${label}を選択`}
      onCancel={onClose}
    >
      <h2>{label}を選択</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load(path);
        }}
      >
        <label>
          フォルダのパス
          <input
            aria-label="フォルダのパス"
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.nativeEvent.isComposing || e.keyCode === 229)
              )
                e.preventDefault();
            }}
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </label>
        <button disabled={busy}>開く</button>
      </form>
      <p>{listing?.path}</p>
      <button
        disabled={busy || !listing?.parent}
        onClick={() => listing?.parent && void load(listing.parent)}
      >
        上のフォルダへ
      </button>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">読み込み中…</p>}
      <label className="path-search">
        名前で絞り込み
        <input
          type="search"
          aria-label="名前で絞り込み"
          placeholder="ファイル・フォルダ名の一部"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="path-entries">
        {!busy && listing && entries.length === 0 && (
          <p role="status">一致する候補がありません。</p>
        )}
        {entries.map((e) => (
          <button
            key={e.path}
            disabled={busy}
            onClick={() => (e.directory ? void load(e.path) : onSelect(e.path))}
          >
            <span
              className={
                e.directory
                  ? "path-icon path-icon-folder"
                  : "path-icon path-icon-file"
              }
            >
              <Icon name={e.directory ? "folder" : "note"} />
            </span>
            <span>{e.name}</span>
          </button>
        ))}
      </div>
      {listing?.truncated && (
        <p>
          項目が多いため一部を省略しました。絞り込みは取得済みの候補が対象です。パスを直接指定できます。
        </p>
      )}
      <div className="dialog-actions">
        {directory && (
          <button
            disabled={busy || !listing || !!error}
            onClick={() => listing && onSelect(listing.path)}
          >
            このフォルダを選択
          </button>
        )}
        <button onClick={onClose}>キャンセル</button>
      </div>
    </dialog>
  );
}
