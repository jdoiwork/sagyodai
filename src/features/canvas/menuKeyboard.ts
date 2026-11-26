// 上下キーでは循環し、Home / End では先頭・末尾の項目へ移動する。
export function getNextMenuItemIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
): number {
  if (itemCount === 0) return -1;
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return itemCount - 1;
    case "ArrowDown":
      return (currentIndex + 1 + itemCount) % itemCount;
    case "ArrowUp":
      return (currentIndex - 1 + itemCount) % itemCount;
    default:
      return currentIndex;
  }
}
