import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Bootstrap, for the exercises that use it (ex2+).
 *
 * The exercise links Bootstrap 5.3.3 from jsDelivr. The same version is a devDependency, and
 * requests for it (jsDelivr, unpkg, cdnjs) are answered from node_modules: grading doesn't
 * depend on the network and every submission gets exactly the same file. The npm files are
 * byte-identical to the CDN's, so a correct `integrity` attribute still matches.
 * Other versions are fetched from the network as usual.
 */
export const BOOTSTRAP_VERSION = '5.3.3';
export const BOOTSTRAP_RTL_URL = `https://cdn.jsdelivr.net/npm/bootstrap@${BOOTSTRAP_VERSION}/dist/css/bootstrap.rtl.min.css`;

const PACKAGE_DIR = path.dirname(require.resolve('bootstrap/package.json'));
const installed = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')).version;
if (installed !== BOOTSTRAP_VERSION) {
  throw new Error(`node_modules has bootstrap ${installed}, the grader expects ${BOOTSTRAP_VERSION}: run npm install`);
}

const v = BOOTSTRAP_VERSION.replace(/\./g, '\\.');
/** CDN URLs of this version → path inside the package's dist folder. */
const CDN = new RegExp(
  `^https://(?:cdn\\.jsdelivr\\.net/npm/bootstrap@${v}/dist/|unpkg\\.com/bootstrap@${v}/dist/|cdnjs\\.cloudflare\\.com/ajax/libs/bootstrap/${v}/)([^?#]+)`,
  'i',
);
const TYPES: Record<string, string> = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.map': 'application/json' };

/** Serves this Bootstrap version's CDN files from node_modules (other requests are left alone). */
export async function serveBootstrapLocally(page: Page) {
  await page.route(CDN, async (route) => {
    const rest = CDN.exec(route.request().url())![1];
    const file = path.join(PACKAGE_DIR, 'dist', path.normalize(rest).replace(/^(\.\.[\\/])+/, ''));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fallback();
    await route.fulfill({
      status: 200,
      body: fs.readFileSync(file),
      headers: { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Access-Control-Allow-Origin': '*' },
    });
  });
}

export interface BootstrapLink {
  /** The href as written. */
  attr: string;
  href: string;
  loaded: boolean;
  rtl: boolean;
  integrity: boolean;
  /** Major version from the URL, when it says (bootstrap@5.3.3, bootstrap/4.6.2...). */
  version?: number;
}

export interface BootstrapState {
  links: BootstrapLink[];
  /** Bootstrap 5's CSS variables are defined: some Bootstrap 5 stylesheet is applied. */
  applied: boolean;
  /** Bootstrap 4's variables instead. */
  v4: boolean;
  /** Elements with grid classes (row / col-*), as written in the HTML. */
  gridElements: number;
  /** The student's own stylesheets (or <style>) that come before the first Bootstrap one, in document order. */
  ownBefore: string[];
}

/** Which Bootstrap stylesheets the page links and whether one is applied. */
export function bootstrapState(page: Page): Promise<BootstrapState> {
  return page.evaluate(() => {
    const isBootstrap = (href: string) => /bootstrap/i.test(href);
    const sheets = Array.from(document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link, style')).filter(
      (el) => !el.hasAttribute('data-grader-injected') && (el.tagName === 'STYLE' || /stylesheet/i.test((el as HTMLLinkElement).rel)),
    );
    const links = sheets
      .filter((el): el is HTMLLinkElement => el.tagName === 'LINK' && isBootstrap((el as HTMLLinkElement).href))
      .map((link) => {
        const major = /bootstrap(?:@|\/)(\d+)\./i.exec(link.href)?.[1];
        return {
          attr: link.getAttribute('href') ?? '',
          href: link.href,
          loaded: !!link.sheet,
          rtl: /\.rtl\./i.test(link.href),
          integrity: link.hasAttribute('integrity'),
          ...(major ? { version: Number(major) } : {}),
        };
      });
    const firstBootstrap = sheets.findIndex((el) => el.tagName === 'LINK' && isBootstrap((el as HTMLLinkElement).href) && !!(el as HTMLLinkElement).sheet);
    const ownBefore = (firstBootstrap < 0 ? [] : sheets.slice(0, firstBootstrap))
      .filter((el) => (el.tagName === 'STYLE' ? (el.textContent ?? '').trim() !== '' : !isBootstrap((el as HTMLLinkElement).href) && !!(el as HTMLLinkElement).sheet))
      .map((el) => (el.tagName === 'STYLE' ? '<style>' : (el.getAttribute('href') ?? '')));
    const root = getComputedStyle(document.documentElement);
    const grid = /^(row|col|col-(sm|md|lg|xl|xxl))$|^col(-(sm|md|lg|xl|xxl))?-(\d+|auto)$/;
    return {
      links,
      applied: root.getPropertyValue('--bs-blue').trim() !== '',
      v4: root.getPropertyValue('--breakpoint-md').trim() !== '',
      gridElements: Array.from(document.querySelectorAll('[class]')).filter((el) => Array.from(el.classList).some((c) => grid.test(c))).length,
      ownBefore,
    };
  });
}

/**
 * Adds Bootstrap 5.3.3 RTL as the first stylesheet (so the student's own CSS still overrides it),
 * for pages whose Bootstrap link is missing or broken. Served from node_modules.
 */
export async function injectBootstrap(page: Page) {
  await page.evaluate(async (url) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.setAttribute('data-grader-injected', '');
    const loaded = new Promise((resolve) => {
      link.onload = link.onerror = resolve;
    });
    const first = document.head.querySelector('link[rel~="stylesheet" i], style');
    if (first) first.before(link);
    else document.head.append(link);
    await loaded;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, BOOTSTRAP_RTL_URL);
}

let classes: Set<string> | undefined;

/** Every class name Bootstrap 5.3.3's CSS defines (row, col-sm-6, d-md-block, ...). */
export function bootstrapClasses(): Set<string> {
  if (!classes) {
    const css = fs
      .readFileSync(path.join(PACKAGE_DIR, 'dist', 'css', 'bootstrap.rtl.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Drop the declaration blocks (the innermost braces), keeping the selectors, also inside @media.
      .replace(/\{[^{}]*\}/g, ' ');
    classes = new Set(Array.from(css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g), (m) => m[1]));
  }
  return classes;
}
