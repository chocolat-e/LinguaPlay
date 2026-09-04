/**
 * Phase 4c — print results/report.html to PDF.
 *
 * The PDF is a print of the real report page, so it keeps the screen design
 * rather than reconstructing it; `@media print` in the template supplies
 * pagination and forces the light palette. Run `report.mjs` first.
 *
 *   node eval/report-pdf.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(EVAL_DIR, 'results');
const source = join(RESULTS_DIR, 'report.html');
const target = join(RESULTS_DIR, 'Punch-English-Coach-Evaluation.pdf');

if (!existsSync(source)) {
  console.error(`${source} does not exist — run \`node eval/report.mjs\` first.`);
  process.exit(1);
}

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('Chrome not found. Set CHROME_PATH to the executable.');
  process.exit(1);
}

execFileSync(chrome, [
  '--headless=old',
  '--disable-gpu',
  '--no-sandbox',
  // The page builds its tables and charts in script, so give it time to run
  // before the snapshot is taken.
  '--virtual-time-budget=20000',
  // Otherwise Chrome stamps a date and the page title onto every sheet.
  '--no-pdf-header-footer',
  `--print-to-pdf=${target}`,
  pathToFileURL(source).href,
], { stdio: 'inherit' });

console.log(`wrote ${target}`);
