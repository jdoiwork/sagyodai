// 装飾用のアイコン。操作名はボタンの文字・aria-label に任せる。
const paths = {
  http: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c4 5 4 13 0 18-4-5-4-13 0-18",
  jsonSelect: "M8 3H5v6l-2 3 2 3v6h3M16 3h3v6l2 3-2 3v6h-3M9 12h6m-3-3 3 3-3 3",
  jsonTable: "M3 4h18v16H3ZM3 9h18M9 9v11M3 14h18",
  tree: "M4 3h6v5H4ZM7 8v12h7M7 13h7M14 10h6v5h-6ZM14 18h6v5h-6Z",
  note: "M4 3h16v14l-4 4H4ZM16 21v-4h4M8 7h8M8 11h8",
  replace: "M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  moveSheet: "M4 4h9v4M4 4v16h9v-4M10 12h11m-4-4 4 4-4 4",
  aggregate: "M19 4H5l7 8-7 8h14",
  sort: "M7 3v18m-4-4 4 4 4-4M17 21V3m-4 4 4-4 4 4",
  union: "M3 5h5l4 7h9M3 19h5l4-7m5-4 4 4-4 4",
  collapse: "m6 14 6-6 6 6",
  expand: "m6 10 6 6 6-6",
  edit: "m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z",
  plus: "M12 5v14M5 12h14",
  filter: "M3 5h18l-7 8v6l-4 2v-8Z",
  editableTable:
    "M10 20H3V4h16v5M3 9h10M8 9v11M12 21l1-4 7-7 3 3-7 7ZM18 12l3 3",
  table: "M3 4h18v16H3ZM3 9h18M9 9v11",
  check: "m5 12 4 4L19 6",
  refresh:
    "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  folder: "M3 7V4h6l2 3h10v13H3ZM3 10h18",
  save: "M4 3h13l3 3v15H4ZM8 3v6h8V3M8 21v-8h8v8",
  undo: "M9 5 3 11l6 6M3 11h11a6 6 0 0 1 6 6",
  redo: "m15 5 6 6-6 6M21 11H10a6 6 0 0 0-6 6",
  minus: "M5 12h14",
  fit: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 8h8v8H8Z",
  help: "M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  close: "m6 6 12 12M6 18 18 6",
};
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      className="action-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
