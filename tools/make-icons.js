#!/usr/bin/env node
/**
 * Renders app/icons/icon.svg to the PNG sizes the web manifest and iOS need, with
 * Playwright's Chromium. Dev-only, and needs Playwright installed (globally is fine:
 * `NODE_PATH=$(npm root -g) node tools/make-icons.js`).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const dir = fileURLToPath(new URL('../app/icons/', import.meta.url));
// require() honours NODE_PATH, so a global install works: NODE_PATH=$(npm root -g) node tools/make-icons.js
const { chromium } = createRequire(import.meta.url)('playwright');
const svg = await readFile(`${dir}icon.svg`, 'utf8');
const browser = await chromium.launch();
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:#07060f}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: `${dir}icon-${size}.png`, omitBackground: false });
  await page.close();
}
await browser.close();
console.log('Wrote icon-180.png, icon-192.png and icon-512.png');
