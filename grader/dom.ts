import type { Locator, Page } from '@playwright/test';
import type { RGBA } from './colors';

/** Document-relative bounding box. */
export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** Computed style values (kebab-case property names) for every element the locator matches. */
export function stylesOf(locator: Locator, props: string[]): Promise<Record<string, string>[]> {
  return locator.evaluateAll(
    (els, props) =>
      els.map((el) => {
        const cs = getComputedStyle(el);
        return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
      }),
    props,
  );
}

export function rectsOf(locator: Locator): Promise<Rect[]> {
  return locator.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left + scrollX,
        right: r.right + scrollX,
        top: r.top + scrollY,
        bottom: r.bottom + scrollY,
        width: r.width,
        height: r.height,
      };
    }),
  );
}

/**
 * Converts any CSS color (names, hex, rgb, hsl, oklch...) to sRGB by painting it on a 1×1
 * canvas. Invalid colors come back transparent.
 */
export function toRgba(page: Page, colors: string[]): Promise<RGBA[]> {
  return page.evaluate((colors) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    return colors.map((color) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    });
  }, colors);
}

/** "a, b, c ועוד 2" */
export function summarize(items: string[], max = 4): string {
  const unique = [...new Set(items)];
  return unique.length <= max ? unique.join(', ') : `${unique.slice(0, max).join(', ')} ועוד ${unique.length - max}`;
}
