import type { PaletteColor } from "../../api/project";

export const palette: Record<PaletteColor, { label: string; hex: string }> = {
  green: { label: "緑", hex: "#34856a" },
  blue: { label: "青", hex: "#397bc4" },
  purple: { label: "紫", hex: "#8754ba" },
  pink: { label: "桃", hex: "#c75491" },
  red: { label: "赤", hex: "#ce5149" },
  orange: { label: "橙", hex: "#be7c24" },
  gray: { label: "灰", hex: "#70818a" },
};
export function colorValue(color: PaletteColor | null | undefined) {
  return color ? palette[color].hex : undefined;
}
