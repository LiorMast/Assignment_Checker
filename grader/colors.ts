/** sRGB color: r, g, b in 0–255, a in 0–1. */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** h in 0–360, s and l in 0–100. */
export interface HSL {
  h: number;
  s: number;
  l: number;
}

/** Semi-transparent colors are judged as they look over a white page. */
export function flatten(c: RGBA): RGBA {
  if (c.a >= 1) return c;
  const mix = (v: number) => Math.round(v * c.a + 255 * (1 - c.a));
  return { r: mix(c.r), g: mix(c.g), b: mix(c.b), a: 1 };
}

export function toHsl(color: RGBA): HSL {
  const { r, g, b } = flatten(color);
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  return { h, s: s * 100, l: l * 100 };
}

// Thresholds are deliberately generous: any reasonable "light", "gray" or "white" passes.
export const isTransparent = (c: RGBA) => c.a < 0.1;
export const isLight = (c: RGBA) => !isTransparent(c) && toHsl(c).l >= 70;
export const isWhite = (c: RGBA) => !isTransparent(c) && toHsl(c).l >= 90;
export function isGray(c: RGBA): boolean {
  if (isTransparent(c)) return false;
  const { s, l } = toHsl(c);
  return s <= 25 && l >= 15 && l <= 85;
}

export const sameColor = (a: RGBA, b: RGBA) =>
  Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b)) <= 3;

export function describeColor(c: RGBA): string {
  if (isTransparent(c)) return 'שקוף (לא הוגדר)';
  if (c.a < 1) return `rgba(${c.r}, ${c.g}, ${c.b}, ${+c.a.toFixed(2)})`;
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}
