#!/usr/bin/env node
/**
 * Renders a hand-painted SVG (in tools/) to a JPEG for app/art/, with Chromium via Playwright.
 *
 *   node tools/render-art.js tools/shire-bounder-art.svg app/art/shire-bounder.jpg
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node tools/render-art.js <in.svg> <out.jpg>');
  process.exit(1);
}
const { chromium } = createRequire(import.meta.url)('playwright');
const svg = await readFile(input, 'utf8');
const [, width, height] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg).map(Number);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
await page.screenshot({ path: resolve(output), type: 'jpeg', quality: 86, clip: { x: 0, y: 0, width, height } });
await browser.close();
