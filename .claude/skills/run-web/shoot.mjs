// Exact-width, real-time screenshot of the web app through a Chromium browser's DevTools protocol
// (CDP): Edge on Windows, Chrome on macOS, google-chrome on Linux; BROWSER_PATH (or EDGE_PATH) overrides.
// node .claude/skills/run-web/shoot.mjs --out <file.png> [--path /load] [--width 390]
//   [--open] [--dark] [--reduce-motion] [--fake-camera] [--zoom200] [--base http://localhost:3100] [--timeout 90]
//   [--click "<css selector>|text=<label>"]... (taps in order before the shot)
//   [--wait-text "<text>"]  (after the taps, wait up to 30 s until the page shows this text)
//   [--webgl]  (software WebGL2 instead of --disable-gpu: MediaPipe needs it)
//   [--wait-seconds 30]  (how long --wait-text waits, inside --timeout)
// The JSON line lists every request that left the page's origin (offOrigin: the URLs, from CDP's
// Network domain), so a self-hosted asset is proven local (slice clip-pose: MediaPipe).
//   [--ready "<css selector>"]  (default: the app's own readiness; a selector for a page outside the app,
//   e.g. a design reference opened with --base file:///…/design/reference/ --path mockup.html)
// Prints one JSON line; exits 1 on horizontal overflow, console errors, a page that never got ready,
// or when the whole shot takes longer than --timeout seconds (a hung browser is killed, never waited on).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
  options: {
    out: { type: "string" },
    path: { type: "string", default: "/" },
    width: { type: "string", default: "390" },
    base: { type: "string", default: process.env.BASE_URL ?? "http://localhost:3100" },
    open: { type: "boolean", default: false },
    dark: { type: "boolean", default: false },
    "reduce-motion": { type: "boolean", default: false },
    "fake-camera": { type: "boolean", default: false },
    webgl: { type: "boolean", default: false },
    zoom200: { type: "boolean", default: false },
    timeout: { type: "string", default: "90" },
    ready: { type: "string" },
    // After the taps, wait (≤ 30 s, inside --timeout) until the page's text contains this (slice
    // clip-cut: Kameratest's 4 s test clip ends after the shot would be taken); not found = exit 1.
    "wait-text": { type: "string" },
    // How long --wait-text waits (slice clip-pose: Kameratest's Pose run comes after the 4 s clip).
    "wait-seconds": { type: "string", default: "30" },
    // Taps before the shot, in order, 800 ms apart (slice fokus-minimise: a jump, then Minimér):
    // a CSS selector (the first match), or text=<start of a button's or link's text>.
    click: { type: "string", multiple: true },
  },
});
if (!opt.out) {
  console.error("--out <file.png> is required");
  process.exit(2);
}
const width = Number(opt.width);
const timeoutS = Number(opt.timeout);
const DEFAULT_BROWSER = {
  win32: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  linux: "google-chrome",
};
const browserPath = process.env.BROWSER_PATH ?? process.env.EDGE_PATH ?? DEFAULT_BROWSER[process.platform] ?? "google-chrome";
const profile = mkdtempSync(join(tmpdir(), "run-web-"));
const port = 9800 + Math.floor(Math.random() * 100);
// --fake-camera (slice video-record): Chrome's built-in fake camera, permission granted without a
// prompt, so recording can be shot and measured headless. The test pattern is synthetic, never a real clip.
const FAKE_CAMERA = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
// --webgl (slice clip-pose): software WebGL2 (SwiftShader) instead of --disable-gpu, for MediaPipe,
// which uploads every frame through WebGL2 even on its CPU delegate. Timings are not the phone's.
const WEBGL = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const browser = spawn(
  browserPath,
  ["--headless=new", ...(opt.webgl ? WEBGL : ["--disable-gpu"]), "--hide-scrollbars", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, ...(opt["fake-camera"] ? FAKE_CAMERA : []), "about:blank"],
  { stdio: "ignore" },
);
// A hung browser once stalled a screenshot run for hours (2026-10-13): the whole shot gets a hard limit.
const watchdog = setTimeout(() => {
  console.error(`shot did not finish within ${timeoutS} s; browser killed`);
  browser.kill("SIGKILL");
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  process.exit(1);
}, timeoutS * 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

try {
  let target;
  for (let i = 0; i < 75 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    } catch {}
    if (!target) await sleep(200);
  }
  if (!target) throw new Error(`the browser did not start (${browserPath}); set BROWSER_PATH`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  const errors = [];
  const offOrigin = new Set(); // requests that left the page's origin (CDP Network)
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result ?? {});
      pending.delete(msg.id);
    } else if (msg.method === "Runtime.exceptionThrown") {
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    } else if (msg.method === "Network.requestWillBeSent") {
      const url = msg.params.request.url;
      if (/^(https?|wss?):/.test(url) && new URL(url).origin !== new URL(opt.base).origin) offOrigin.add(url);
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    }
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expression) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  // Exact viewport: --window-size is clamped to ~516 px on Windows; device metrics are not.
  const metrics = (height) =>
    send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await metrics(844);
  const media = [
    ...(opt.dark ? [{ name: "prefers-color-scheme", value: "dark" }] : []),
    ...(opt["reduce-motion"] ? [{ name: "prefers-reduced-motion", value: "reduce" }] : []),
  ];
  if (media.length > 0) await send("Emulation.setEmulatedMedia", { features: media });
  await send("Page.navigate", { url: new URL(opt.path, opt.base).href });

  // Real time, no --virtual-time-budget: React hydrates on an animation frame virtual time never fires.
  // Ready = a heading is rendered, no loading status (English or Danish) and no skeleton shows
  // (skeletons pulse; client parts like the chart render one until hydration), and every chart
  // has drawn its lines.
  let ready = false;
  for (let i = 0; i < 150 && !ready; i++) {
    await sleep(200);
    ready = await evaluate(
      opt.ready !== undefined
        ? `!!document.querySelector(${JSON.stringify(opt.ready)})`
        : `!!document.querySelector('main h1')` +
            ` && ![...document.querySelectorAll('[role=status]')].some((e) => /^\\s*(Loading|Henter|Indlæser)/.test(e.textContent))` +
            ` && !document.querySelector('[class*="animate-pulse"]')` +
            ` && [...document.querySelectorAll('.recharts-wrapper')].every((w) => w.querySelector('.recharts-line-curve'))`,
    );
  }
  if (!ready) {
    console.error("page did not become ready within 30 s");
    exitCode = 1;
  }
  await sleep(400);
  for (const c of opt.click ?? []) {
    const hit = await evaluate(
      `(() => { const s = ${JSON.stringify(c)}; const el = s.startsWith('text=')` +
        ` ? [...document.querySelectorAll('button, a')].find((e) => e.textContent.trim().startsWith(s.slice(5)))` +
        ` : document.querySelector(s); if (!el) return false; el.click(); return true; })()`,
    );
    if (!hit) {
      console.error(`--click ${c}: nothing matched`);
      exitCode = 1;
    }
    await sleep(800);
  }
  if (opt["wait-text"] !== undefined) {
    let seen = false;
    const waitS = Number(opt["wait-seconds"]);
    for (let i = 0; i < waitS * 5 && !seen; i++) {
      seen = await evaluate(`document.body.innerText.includes(${JSON.stringify(opt["wait-text"])})`);
      if (!seen) await sleep(200);
    }
    if (!seen) {
      console.error(`--wait-text ${opt["wait-text"]}: not shown within ${waitS} s`);
      exitCode = 1;
    }
  }
  if (opt.open) await evaluate(`document.querySelectorAll('details').forEach((d) => { d.open = true; }); true`);
  // A stylesheet, not a style attribute on <html>: React owns that element's attributes.
  if (opt.zoom200) {
    await evaluate(
      `document.head.append(Object.assign(document.createElement('style'), { textContent: 'html { font-size: 200% !important; }' })); true`,
    );
  }
  await sleep(200);

  // The tab shell (motion-shell) scrolls each page in its own container, not the document: the
  // full-page height adds what the active page's container hides, and a horizontal overflow inside
  // it counts like one of the document's.
  const page = await evaluate(
    `(() => { const doc = document.documentElement;` +
      ` const m = document.querySelector('[data-tab-page][data-active] main');` +
      ` const extra = m ? Math.max(0, m.scrollHeight - m.clientHeight) : 0;` +
      ` return { height: Math.ceil(doc.scrollHeight + extra), scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth,` +
      ` innerOverflow: m ? m.scrollWidth > m.clientWidth : false }; })()`,
  );
  await metrics(page.height); // full page in one shot
  await sleep(300);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(opt.out, Buffer.from(shot.data, "base64"));

  const horizontalOverflow = page.scrollWidth > page.clientWidth || page.innerOverflow;
  console.log(JSON.stringify({ out: opt.out, width, height: page.height, horizontalOverflow, consoleErrors: errors, offOrigin: [...offOrigin] }));
  if (horizontalOverflow || errors.length > 0) exitCode = 1;
  ws.close();
} finally {
  clearTimeout(watchdog);
  browser.kill();
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
}
process.exit(exitCode);
