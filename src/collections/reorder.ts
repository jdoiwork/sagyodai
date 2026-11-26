export function swapItems<T>(
  items: readonly T[],
  firstIndex: number,
  secondIndex: number,
): T[] {
  const result = [...items];
  [result[firstIndex], result[secondIndex]] = [
    result[secondIndex],
    result[firstIndex],
  ];
  return result;
}

// toは選択項目を取り除いた後の挿入位置。戻り値は並べ替え後の元の添字。
export function getOrderAfterMovingItems(
  itemCount: number,
  selectedIndices: readonly number[],
  to: number,
): number[] {
  const order = Array.from({ length: itemCount }, (_, index) => index).filter(
    (index) => !selectedIndices.includes(index),
  );
  order.splice(to, 0, ...selectedIndices);
  return order;
}

export function getDropDestination(
  itemCount: number,
  selectedIndices: readonly number[],
  targetIndex: number,
  after: boolean,
) {
  const boundary = targetIndex + (after ? 1 : 0);
  // ドロップ境界より前にある移動元を除き、削除後の挿入位置に変換する。
  const to =
    boundary - selectedIndices.filter((index) => index < boundary).length;
  const order = getOrderAfterMovingItems(itemCount, selectedIndices, to);
  return {
    to,
    unchanged: order.every((originalIndex, index) => originalIndex === index),
    side: after ? ("after" as const) : ("before" as const),
  };
}
