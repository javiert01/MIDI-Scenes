/**
 * The performance workbench runner (perf/README.md).
 *
 *   npm run perf                          measure this working tree against the budgets
 *   npm run perf -- --base-ref origin/main   …and against a base commit, side by side
 *   npm run perf:update                   re-record the draw-call baseline
 *
 * Builds the harness page against `src/` (and the base's `src/`), plays every
 * Workload into every Scene in headless Chromium, and fails (exit 1) when a
 * frame goes over budget, a case got slower than the base, a Scene draws more
 * than its recorded baseline, or the shipped bundle grew too much.
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { fileBytes } from '../vite.config';
import type { RunOptions, RunResult } from './harness/main';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PERF = path.join(ROOT, 'perf');
const OUT = path.join(PERF, '.out');
const BASE_CHECKOUT = path.join(OUT, 'base');
const SEED = 20260611;

interface Budgets {
  frame: { p95Ms: number; tolerancePct: number };
  regression: { medianPct: number; minDeltaMs: number };
  drawCalls: { tolerancePct: number };
  bundle: { maxGzipKb: number; maxGrowthPct: number };
}

interface Baseline {
  drawCalls: Record<string, number>;
}

interface CaseStats {
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  drawCalls: number;
  deterministic: boolean;
}

interface CaseReport {
  key: string;
  sceneId: string;
  workloadId: string;
  head: CaseStats;
  base: CaseStats | null;
  baselineDrawCalls: number | null;
  failures: string[];
  notes: string[];
}

interface BundleReport {
  headKb: number;
  baseKb: number | null;
  failures: string[];
}

const { values: args } = parseArgs({
  options: {
    'base-ref': { type: 'string' },
    rounds: { type: 'string', default: '3' },
    frames: { type: 'string', default: '300' },
    warmup: { type: 'string', default: '120' },
    only: { type: 'string' },
    update: { type: 'boolean', default: false },
    'no-bundle': { type: 'boolean', default: false },
    markdown: { type: 'string' },
    json: { type: 'string' },
  },
  allowPositionals: true,
});

const rounds = Number(args.rounds);
const frames = Number(args.frames);
const warmupFrames = Number(args.warmup);

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const budgets = readJson<Budgets>(path.join(PERF, 'budgets.json'));
const baselineFile = path.join(PERF, 'baseline.json');
const baseline: Baseline = existsSync(baselineFile)
  ? readJson<Baseline>(baselineFile)
  : { drawCalls: {} };

function git(...gitArgs: string[]): string {
  return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** Checks `ref` out (detached) under perf/.out/base, replacing any earlier checkout. */
function checkOutBase(ref: string): { root: string; sha: string } {
  const sha = git('rev-parse', '--verify', `${ref}^{commit}`);
  removeBaseCheckout();
  git('worktree', 'add', '--detach', '--force', BASE_CHECKOUT, sha);
  return { root: BASE_CHECKOUT, sha };
}

function removeBaseCheckout(): void {
  if (existsSync(BASE_CHECKOUT)) {
    try {
      git('worktree', 'remove', '--force', BASE_CHECKOUT);
    } catch {
      rmSync(BASE_CHECKOUT, { recursive: true, force: true });
    }
  }
  git('worktree', 'prune');
}

/** Builds the harness page with `@/` pointing at `srcDir`. Returns its URL path under OUT. */
async function buildHarness(label: string, srcDir: string): Promise<string> {
  await build({
    configFile: false,
    root: path.join(PERF, 'harness'),
    base: './',
    publicDir: false,
    logLevel: 'warn',
    plugins: [fileBytes()],
    resolve: { alias: { '@': srcDir } },
    build: {
      outDir: path.join(OUT, label, 'harness'),
      emptyOutDir: true,
      reportCompressedSize: false,
      chunkSizeWarningLimit: Infinity,
    },
  });
  return `/${label}/harness/index.html`;
}

/** Builds the app as it ships from `root` and returns its gzipped JS + CSS, in KB. */
async function bundleKb(label: string, root: string): Promise<number> {
  const outDir = path.join(OUT, label, 'app');
  await build({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    logLevel: 'error',
    build: {
      outDir,
      emptyOutDir: true,
      reportCompressedSize: false,
      // The size that matters here is the gzipped total this runner reports.
      chunkSizeWarningLimit: Infinity,
    },
  });
  let bytes = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const file = path.join(dir, entry);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.(js|css)$/.test(entry))
        bytes += gzipSync(readFileSync(file), { level: 9 }).length;
    }
  };
  walk(outDir);
  return bytes / 1024;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
};

function serve(dir: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const file = path.join(dir, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
      // Cross-origin isolation sharpens performance.now() from 100 µs to 5 µs.
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

async function openHarness(browser: Browser, url: string): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1700, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  try {
    await page.waitForFunction(() => window.perf?.ready === true, undefined, { timeout: 15000 });
  } catch {
    throw new Error(`The harness at ${url} never became ready. ${errors.join(' | ')}`);
  }
  return page;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}

const median = (values: number[]) =>
  quantile(
    [...values].sort((a, b) => a - b),
    0.5,
  );
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

/** Folds a case's rounds into one figure each: medians of the per-round statistics. */
function summarise(results: RunResult[]): CaseStats {
  const perRound = results.map((result) => {
    const sorted = [...result.frameMs].sort((a, b) => a - b);
    return {
      median: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      max: sorted[sorted.length - 1],
      calls: mean(result.drawCalls),
    };
  });
  const calls = perRound.map((round) => round.calls);
  return {
    medianMs: median(perRound.map((round) => round.median)),
    p95Ms: median(perRound.map((round) => round.p95)),
    maxMs: Math.max(...perRound.map((round) => round.max)),
    drawCalls: calls[0],
    deterministic: calls.every((value) => value === calls[0]),
  };
}

/**
 * The p95 a case may reach before it fails: the frame budget plus the
 * tolerance that absorbs a slow runner. Timing is the one check that depends
 * on the machine, and CI runners vary a lot from one run to the next.
 */
const frameLimitMs = budgets.frame.p95Ms * (1 + (budgets.frame.tolerancePct ?? 0) / 100);
const frameBudgetLabel =
  `${budgets.frame.p95Ms} ms` +
  (budgets.frame.tolerancePct ? ` +${budgets.frame.tolerancePct}% tolerance` : '');

function judge(report: CaseReport): void {
  const { head, base } = report;
  if (head.p95Ms > frameLimitMs) {
    report.failures.push(
      `p95 frame ${head.p95Ms.toFixed(2)} ms is over the ${frameBudgetLabel} budget` +
        (frameLimitMs > budgets.frame.p95Ms ? ` (${frameLimitMs.toFixed(2)} ms)` : ''),
    );
  } else if (head.p95Ms > budgets.frame.p95Ms) {
    report.notes.push(
      `p95 frame ${head.p95Ms.toFixed(2)} ms is over the ${budgets.frame.p95Ms} ms budget but within the +${budgets.frame.tolerancePct}% tolerance (${frameLimitMs.toFixed(2)} ms): a slow machine, or a Scene close to its budget`,
    );
  }
  if (base) {
    const delta = head.medianMs - base.medianMs;
    const pct = (delta / base.medianMs) * 100;
    if (pct > budgets.regression.medianPct && delta > budgets.regression.minDeltaMs) {
      report.failures.push(
        `median frame ${pct.toFixed(0)}% slower than base (${base.medianMs.toFixed(2)} → ${head.medianMs.toFixed(2)} ms)`,
      );
    }
  }
  if (!head.deterministic) {
    report.notes.push('draw calls varied between rounds: the Scene has an unseeded input');
  }
  if (args.update) return;
  const recorded = report.baselineDrawCalls;
  if (recorded === null) {
    report.notes.push('no draw-call baseline yet: run `npm run perf:update`');
    return;
  }
  const limit = recorded * (1 + budgets.drawCalls.tolerancePct / 100);
  if (head.drawCalls > limit) {
    report.failures.push(
      `${fmtCalls(head.drawCalls)} draw calls/frame is over the baseline ${fmtCalls(recorded)} +${budgets.drawCalls.tolerancePct}% — if intended, run \`npm run perf:update\``,
    );
  } else if (head.drawCalls < recorded * (1 - budgets.drawCalls.tolerancePct / 100)) {
    report.notes.push(
      `draws well under its baseline ${fmtCalls(recorded)}: run \`npm run perf:update\` to lock the win in`,
    );
  }
}

const fmtMs = (ms: number) => ms.toFixed(2);
const fmtCalls = (calls: number) => Math.round(calls).toLocaleString('en-US');
const fmtPct = (from: number, to: number) => {
  // `+ 0` turns a rounded -0 into 0, so an unchanged figure never reads "-0%".
  const pct = Math.round(((to - from) / from) * 100) + 0;
  return `${pct >= 0 ? '+' : ''}${pct}%`;
};

function markdown(
  cases: CaseReport[],
  bundle: BundleReport | null,
  baseSha: string | null,
  failed: number,
): string {
  const lines: string[] = [];
  lines.push(
    failed === 0
      ? '## ✅ Performance: within budget'
      : `## ❌ Performance: ${failed} check${failed === 1 ? '' : 's'} failed`,
  );
  lines.push('');
  lines.push(
    `One frame's update + draw + raster in headless Chromium (software canvas, 1600×800), ` +
      `median of ${rounds} round${rounds === 1 ? '' : 's'} × ${frames} frames after ${warmupFrames} warmup. ` +
      `Budget: p95 ≤ ${frameBudgetLabel}` +
      (baseSha ? `; compared against base \`${baseSha.slice(0, 7)}\` on the same machine.` : '.'),
  );
  lines.push('');
  lines.push('| Scene | Workload | Median ms | p95 ms | vs base | Draw calls / frame | |');
  lines.push('|---|---|--:|--:|--:|--:|:-:|');
  for (const c of cases) {
    const vsBase = c.base
      ? `${fmtPct(c.base.medianMs, c.head.medianMs)} (${fmtMs(c.base.medianMs)})`
      : '—';
    const calls =
      c.baselineDrawCalls === null
        ? fmtCalls(c.head.drawCalls)
        : `${fmtCalls(c.head.drawCalls)} (${fmtPct(c.baselineDrawCalls, c.head.drawCalls)})`;
    lines.push(
      `| ${c.sceneId} | ${c.workloadId} | ${fmtMs(c.head.medianMs)} | ${fmtMs(c.head.p95Ms)} | ${vsBase} | ${calls} | ${c.failures.length ? '❌' : '✅'} |`,
    );
  }
  if (bundle) {
    lines.push('');
    const vs =
      bundle.baseKb === null
        ? ''
        : ` (base ${bundle.baseKb.toFixed(1)} KB, ${fmtPct(bundle.baseKb, bundle.headKb)})`;
    lines.push(
      `**Bundle:** ${bundle.headKb.toFixed(1)} KB gzipped JS + CSS${vs}, budget ${budgets.bundle.maxGzipKb} KB ${bundle.failures.length ? '❌' : '✅'}`,
    );
  }
  const failures = [
    ...cases.flatMap((c) => c.failures.map((f) => `**${c.key}**: ${f}`)),
    ...(bundle?.failures.map((f) => `**bundle**: ${f}`) ?? []),
  ];
  if (failures.length) {
    lines.push('', '### Failures', '', ...failures.map((f) => `- ${f}`));
  }
  const notes = cases.flatMap((c) => c.notes.map((n) => `**${c.key}**: ${n}`));
  if (notes.length) lines.push('', '### Notes', '', ...notes.map((n) => `- ${n}`));
  lines.push('');
  return lines.join('\n');
}

function consoleTable(cases: CaseReport[]): string {
  const header = ['case', 'median', 'p95', 'max', 'vs base', 'calls', ''];
  const rows = cases.map((c) => [
    c.key,
    fmtMs(c.head.medianMs),
    fmtMs(c.head.p95Ms),
    fmtMs(c.head.maxMs),
    c.base ? fmtPct(c.base.medianMs, c.head.medianMs) : '—',
    fmtCalls(c.head.drawCalls),
    c.failures.length ? 'FAIL' : 'ok',
  ]);
  const widths = header.map((_, i) => Math.max(...[header, ...rows].map((row) => row[i].length)));
  return [header, ...rows]
    .map((row) =>
      row
        .map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i])))
        .join('  '),
    )
    .join('\n');
}

async function main(): Promise<number> {
  const started = Date.now();
  const base = args['base-ref'] ? checkOutBase(args['base-ref']) : null;
  let server: Server | undefined;
  let browser: Browser | undefined;
  try {
    log('Building the harness…');
    const headUrl = await buildHarness('head', path.join(ROOT, 'src'));
    let baseUrl: string | null = null;
    if (base) {
      try {
        baseUrl = await buildHarness('base', path.join(base.root, 'src'));
      } catch (error) {
        log(
          `⚠ Could not build the harness against the base (${String(error)}); skipping comparison.`,
        );
      }
    }

    const served = await serve(OUT);
    server = served.server;
    browser = await chromium.launch({
      args: ['--disable-gpu', '--enable-precise-memory-info'],
    });
    const headPage = await openHarness(browser, served.origin + headUrl);
    let basePage: Page | null = null;
    if (baseUrl) {
      try {
        basePage = await openHarness(browser, served.origin + baseUrl);
      } catch (error) {
        log(`⚠ ${String(error)}; skipping comparison.`);
      }
    }

    const sceneIds = await headPage.evaluate(() => window.perf!.sceneIds());
    const workloadIds = await headPage.evaluate(() => window.perf!.workloadIds());
    const baseSceneIds = basePage ? await basePage.evaluate(() => window.perf!.sceneIds()) : [];
    const cases = sceneIds
      .flatMap((sceneId) => workloadIds.map((workloadId) => ({ sceneId, workloadId })))
      .filter(
        ({ sceneId, workloadId }) => !args.only || `${sceneId}/${workloadId}`.includes(args.only),
      );
    if (cases.length === 0) throw new Error(`No case matches --only ${args.only}`);

    const headRuns = new Map<string, RunResult[]>();
    const baseRuns = new Map<string, RunResult[]>();
    const runOn = (page: Page, options: RunOptions) =>
      page.evaluate((o) => window.perf!.run(o), options);

    for (let round = 0; round < rounds; round++) {
      for (const { sceneId, workloadId } of cases) {
        const key = `${sceneId}/${workloadId}`;
        log(`Round ${round + 1}/${rounds}  ${key}`);
        const options: RunOptions = { sceneId, workloadId, warmupFrames, frames, seed: SEED };
        // Alternate which side goes first so neither always runs on a warmer browser.
        const sides: Array<[Page, Map<string, RunResult[]>]> = [[headPage, headRuns]];
        if (basePage && baseSceneIds.includes(sceneId)) sides.push([basePage, baseRuns]);
        if (round % 2 === 1) sides.reverse();
        for (const [page, runs] of sides) {
          const result = await runOn(page, options);
          runs.set(key, [...(runs.get(key) ?? []), result]);
        }
      }
    }

    const reports: CaseReport[] = cases.map(({ sceneId, workloadId }) => {
      const key = `${sceneId}/${workloadId}`;
      const baseResults = baseRuns.get(key);
      const report: CaseReport = {
        key,
        sceneId,
        workloadId,
        head: summarise(headRuns.get(key)!),
        base: baseResults ? summarise(baseResults) : null,
        baselineDrawCalls: baseline.drawCalls[key] ?? null,
        failures: [],
        notes: [],
      };
      judge(report);
      return report;
    });

    let bundle: BundleReport | null = null;
    if (!args['no-bundle']) {
      log('Measuring the bundle…');
      const headKb = await bundleKb('head', ROOT);
      let baseKb: number | null = null;
      if (base) {
        try {
          baseKb = await bundleKb('base', base.root);
        } catch (error) {
          log(`⚠ Could not build the base app (${String(error)}); skipping its bundle.`);
        }
      }
      bundle = { headKb, baseKb, failures: [] };
      if (headKb > budgets.bundle.maxGzipKb) {
        bundle.failures.push(
          `${headKb.toFixed(1)} KB is over the ${budgets.bundle.maxGzipKb} KB budget`,
        );
      }
      if (baseKb !== null && ((headKb - baseKb) / baseKb) * 100 > budgets.bundle.maxGrowthPct) {
        bundle.failures.push(
          `grew ${fmtPct(baseKb, headKb)} over the base (limit +${budgets.bundle.maxGrowthPct}%)`,
        );
      }
    }

    if (args.update) {
      const drawCalls = { ...baseline.drawCalls };
      for (const report of reports)
        drawCalls[report.key] = Math.round(report.head.drawCalls * 10) / 10;
      const sorted = Object.fromEntries(
        Object.entries(drawCalls).sort(([a], [b]) => a.localeCompare(b)),
      );
      await writeFile(
        baselineFile,
        `${JSON.stringify(
          {
            $comment:
              'Mean drawing calls per frame for each Scene/Workload, recorded by `npm run perf:update`. Deterministic: review changes here like a snapshot.',
            drawCalls: sorted,
          },
          null,
          2,
        )}\n`,
      );
      log(`Recorded the draw-call baseline for ${reports.length} cases in perf/baseline.json`);
    }

    const failed =
      reports.reduce((sum, r) => sum + r.failures.length, 0) + (bundle?.failures.length ?? 0);
    const report = markdown(reports, bundle, baseUrl && basePage ? base!.sha : null, failed);

    log('');
    log(consoleTable(reports));
    log('');
    if (bundle)
      log(
        `bundle  ${bundle.headKb.toFixed(1)} KB gzip${bundle.baseKb === null ? '' : `  (base ${bundle.baseKb.toFixed(1)} KB)`}`,
      );
    for (const r of reports) for (const f of r.failures) log(`✗ ${r.key}: ${f}`);
    for (const f of bundle?.failures ?? []) log(`✗ bundle: ${f}`);
    for (const r of reports) for (const n of r.notes) log(`· ${r.key}: ${n}`);
    log('');
    log(
      `${failed === 0 ? '✓ Performance within budget' : `✗ ${failed} performance check(s) failed`} (${((Date.now() - started) / 1000).toFixed(0)} s)`,
    );

    if (args.markdown) await writeFile(args.markdown, report);
    if (args.json) {
      await writeFile(
        args.json,
        `${JSON.stringify({ baseSha: base?.sha ?? null, budgets, cases: reports, bundle }, null, 2)}\n`,
      );
    }
    return failed === 0 ? 0 : 1;
  } finally {
    await browser?.close();
    server?.close();
    if (base) removeBaseCheckout();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    log(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(2);
  },
);
