#!/usr/bin/env node
/**
 * Boot check for a deployed (or local preview) build of the app.
 *
 * Usage:
 *   node checks/preview-boot.mjs <url>
 *
 * Examples:
 *   node checks/preview-boot.mjs http://localhost:4173/Demonstrable-Plotalizer/
 *   node checks/preview-boot.mjs https://dbolser.github.io/Demonstrable-Plotalizer/previews/pr-123/
 *
 * Asserts that the app boots: the page loads without console page errors and
 * the sample scatter-plot matrix renders (>0 canvas elements appear).
 *
 * Requirements: puppeteer-core (devDependency, installed via `npm ci`) and a
 * system Chrome/Chromium. The browser binary is auto-detected from common
 * locations; override with CHROME_PATH=/path/to/chrome.
 *
 * Exit codes: 0 = pass, 1 = check failed, 2 = usage/environment error.
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node checks/preview-boot.mjs <url>');
  process.exit(2);
}

const candidates = [
  process.env.CHROME_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error(
    `No Chrome/Chromium binary found (tried: ${candidates.join(', ')}). Set CHROME_PATH.`
  );
  process.exit(2);
}

const TIMEOUT_MS = 30_000;
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

let failed = false;
try {
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const loc = msg.location();
      // Ignore the browser's automatic favicon probe; it is not an app resource.
      if (loc && loc.url && /\/favicon\.ico$/.test(loc.url)) return;
      const at = loc && loc.url ? ` (${loc.url})` : '';
      consoleErrors.push(`${msg.text()}${at}`);
    }
  });

  console.log(`Loading ${url} ...`);
  const response = await page.goto(url, {
    waitUntil: 'networkidle2',
    timeout: TIMEOUT_MS,
  });
  if (!response || !response.ok()) {
    throw new Error(`Page load failed: HTTP ${response ? response.status() : 'no response'}`);
  }

  // The app auto-loads the sample CSV on boot and renders the matrix to
  // canvas elements; wait for at least one to appear.
  await page.waitForSelector('canvas', { timeout: TIMEOUT_MS });
  const canvasCount = await page.$$eval('canvas', (els) => els.length);
  if (canvasCount === 0) {
    throw new Error('No canvas elements rendered');
  }
  console.log(`OK: ${canvasCount} canvas element(s) rendered`);

  if (pageErrors.length > 0) {
    throw new Error(`Uncaught page error(s):\n  ${pageErrors.join('\n  ')}`);
  }
  if (consoleErrors.length > 0) {
    throw new Error(`Console error(s):\n  ${consoleErrors.join('\n  ')}`);
  }
  console.log('OK: no page or console errors');
  console.log('PASS: app boots and renders the sample matrix');
} catch (err) {
  failed = true;
  console.error(`FAIL: ${err.message ?? err}`);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
