// Touch swipes and tab taps on the tab shell (slice motion-shell), with frame timing, through the same
// Chromium DevTools protocol as shoot.mjs. Real touch events (Input.dispatchTouchEvent: pointerType
// "touch"), real time, optional CPU throttling.
// node .claude/skills/run-web/swipe.mjs --path /load --steps "left,right,tap:/analyse,back"
//   [--width 390] [--height 844] [--cpu 4] [--share 0.3] [--ms 300] [--mid <file.png>] [--out <file.png>]
//   [--reduce-motion] [--zoom200] [--base http://localhost:3100] [--timeout 120]
// Steps: left | right (a swipe of --share x width over --ms, from the middle, never the edge zones),
//   flick-left | flick-right (15 % of the width in 80 ms), short-left | short-right (15 % over 600 ms),
//   edge-left | edge-right (starting 10 px from the edge), tap:<path> (a click on that tab), key:<path> (focus + Enter), back | forward (history),
//   scroll-down | scroll-up (a touch drag mostly in y: 300 px up/down with 20 px sideways),
//   diag-left | diag-right (|dx| = |dy| = 60 px: below the 1.3 lock ratio, must not move a page),
//   tabkeys (Tab pressed 60 times: reports whether focus ever reached an inactive page),
//   scroll:<css> (scroll the match's own <main>, active page or not, so the match sits 80 px under its top),
//   click:<css> (click the first visible, non-inert match), drag:<css> (a horizontal touch drag across the
//   match's middle, 15 % -> 85 % of its width in 30 moves of 20 ms), wait:<ms>. A <css> must not hold a comma.
// Probes: --init <file.js> runs in every document before the app (Page.addScriptToEvaluateOnNewDocument:
//   spies, per-frame samplers); --report <file.js> is an expression evaluated after the steps, its value in
//   the JSON as `report` or, with --report-out <file.json>, written there.
// Per step also: each page's scrollTop, whether every inactive page is inert + visibility hidden, the
// indicator's transform, and the card-stack frames that changed after the gesture ended (count and span in ms:
// a 440 ms animation spans ~440, a snap 0-1 changes).
// --mid shoots the screen half-way through the first swipe (the card stack mid-move).
// Prints one JSON line: per step the URL and active page after it settles; long animation frames
// (PerformanceObserver "long-animation-frame", > 50 ms) and the largest gap between animation frames
// while gestures ran. Exits 1 on a long frame over 50 ms, a console error or a page that never got ready.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
  options: {
    path: { type: "string", default: "/load" },
    steps: { type: "string", default: "left,right" },
    width: { type: "string", default: "390" },
    height: { type: "string", default: "844" },
    cpu: { type: "string", default: "1" },
    share: { type: "string", default: "0.3" },
    ms: { type: "string", default: "300" },
    mid: { type: "string" },
    out: { type: "string" },
    base: { type: "string", default: process.env.BASE_URL ?? "http://localhost:3100" },
    "reduce-motion": { type: "boolean", default: false },
    zoom200: { type: "boolean", default: false },
    timeout: { type: "string", default: "120" },
    trace: { type: "string" },
    init: { type: "string" }, // a script for every new document, before the app's own
    report: { type: "string" }, // an expression evaluated after the steps
    "report-out": { type: "string" }, // the report's value as JSON to this file // a CDP trace of the steps (devtools.timeline) to this file; its summary goes in the JSON
  },
});
const width = Number(opt.width);
const height = Number(opt.height);
const DEFAULT_BROWSER = {
  win32: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  linux: "google-chrome",
};
const browserPath = process.env.BROWSER_PATH ?? process.env.EDGE_PATH ?? DEFAULT_BROWSER[process.platform] ?? "google-chrome";
const profile = mkdtempSync(join(tmpdir(), "run-web-"));
const port = 9800 + Math.floor(Math.random() * 100);
const browser = spawn(
  browserPath,
  ["--headless=new", "--hide-scrollbars", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"],
  { stdio: "ignore" },
);
const watchdog = setTimeout(() => {
  console.error(`swipe did not finish within ${opt.timeout} s; browser killed`);
  browser.kill("SIGKILL");
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  process.exit(1);
}, Number(opt.timeout) * 1000);
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
  const traceEvents = [];
  let traceDone;
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result ?? {});
      pending.delete(msg.id);
    } else if (msg.method === "Tracing.dataCollected") {
      traceEvents.push(...msg.params.value);
    } else if (msg.method === "Tracing.tracingComplete") {
      traceDone?.();
    } else if (msg.method === "Runtime.exceptionThrown") {
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
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
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  if (opt["reduce-motion"]) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  if (opt.init) await send("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(opt.init, "utf8") });
  await send("Page.navigate", { url: new URL(opt.path, opt.base).href });

  let ready = false;
  for (let i = 0; i < 150 && !ready; i++) {
    await sleep(200);
    // Every tab, not only the active one: the others stream in from their defaults, and a swipe
    // measured while they hydrate measures the stream, not the swipe.
    // A page outside the tab shell (/fokus) has no [data-tab-page]: ready once the document is
    // complete and its <main> holds no skeleton (tester 2026-10-15: it waited 30 s and exited 1).
    ready = await evaluate(
      `([...document.querySelectorAll('[data-tab-page]')].length === 3` +
        ` && [...document.querySelectorAll('[data-tab-page]')].every((p) => p.querySelector('main h1'))` +
        ` && !document.querySelector('[data-tab-page] [class*="animate-pulse"]'))` +
        ` || (document.readyState === 'complete' && !document.querySelector('[data-tab-page]')` +
        ` && !!document.querySelector('main') && !document.querySelector('main [class*="animate-pulse"]'))`,
    );
  }
  if (!ready) {
    console.error("page did not become ready within 30 s");
    exitCode = 1;
  }
  if (opt.zoom200) {
    await evaluate(`document.head.append(Object.assign(document.createElement('style'), { textContent: 'html { font-size: 200% !important; }' })); true`);
  }
  await sleep(1500); // hydration settles before the clock starts
  // Frame timing from here on: long animation frames and the largest rAF gap while gestures run.
  await evaluate(`(() => {
    window.__long = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); })
      .observe({ type: 'long-animation-frame', buffered: false }); } catch { window.__long = null; }
    // Per long frame also where its time went (LoAF attribution): script ms, the render phase (rAF, style,
    // layout, paint) and its style+layout part, and the top scripts (invoker, source, ms, forced layout ms).
    window.__longAt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration > 50) {
      const end = e.startTime + e.duration, r = (v) => Math.round(v);
      window.__longAt.push([r(e.startTime), r(e.duration), { script: r(e.scripts.reduce((a, s) => a + s.duration, 0)),
        render: e.renderStart ? r(end - e.renderStart) : 0, styleLayout: e.styleAndLayoutStart ? r(end - e.styleAndLayoutStart) : 0,
        scripts: e.scripts.filter((s) => s.duration >= 5).map((s) => [s.invokerType, s.invoker.slice(0, 60), (s.sourceFunctionName || '') + '@' + (s.sourceURL || '').split('/').pop(), r(s.duration), r(s.forcedStyleAndLayoutDuration)]) }]); } })
      .observe({ type: 'long-animation-frame', buffered: false }); } catch {}
    window.__gap = 0; window.__measure = false; let last = 0;
    const tick = (t) => { if (window.__measure && last) window.__gap = Math.max(window.__gap, t - last); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    window.__tl = []; let sig = '';
    const sample = (t) => { const s = [...document.querySelectorAll('[data-tab-page]')].map((e) => e.style.transform).join('|');
      if (s !== sig) { sig = s; window.__tl.push(t); } requestAnimationFrame(sample); };
    requestAnimationFrame(sample); return true; })()`);
  const state = () =>
    evaluate(`(() => { const pages = [...document.querySelectorAll('[data-tab-page]')];
      const act = document.querySelector('[data-tab-page][data-active]');
      return { url: location.pathname + location.search, active: act?.dataset.tabPage ?? null,
        inactiveInert: pages.filter((e) => e !== act).every((e) => e.inert && e.getAttribute('aria-hidden') === 'true' && getComputedStyle(e).visibility === 'hidden'),
        notInert: pages.filter((e) => e !== act && !(e.inert && e.getAttribute('aria-hidden') === 'true' && getComputedStyle(e).visibility === 'hidden'))
          .map((e) => [e.dataset.tabPage, e.inert, e.getAttribute('aria-hidden'), getComputedStyle(e).visibility, e.style.transform]),
        activeHidden: act ? [act.inert, act.getAttribute('aria-hidden'), getComputedStyle(act).visibility] : null,
        focus: (() => { const a = document.activeElement; return a === document.body ? 'body'
          : [a?.tagName, a?.getAttribute('href'), a?.closest('[data-tab-page]')?.dataset.tabPage ?? 'shell'].join(' '); })(),
        scroll: Object.fromEntries(pages.map((e) => [e.dataset.tabPage, Math.round(e.querySelector('main')?.scrollTop ?? -1)])),
        transforms: pages.map((e) => e.style.transform),
        navs: [...document.querySelectorAll('nav[aria-label="Hovedmenu"]')].filter((n) => n.offsetParent !== null && !n.closest('[inert]'))
          .map((n) => ({ top: Math.round(n.getBoundingClientRect().top), indicator: [...n.querySelectorAll('span.block')].some((x) => x.offsetParent !== null) })),
        indicator: [...document.querySelectorAll('nav[aria-label="Hovedmenu"] span[class*="w-1/3"]')].at(-1)?.style.transform ?? null }; })()`);
  const initial = await state();
  const cpu = Number(opt.cpu);
  if (cpu > 1) await send("Emulation.setCPUThrottlingRate", { rate: cpu });

  const touch = (type, x, y) => send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  const y = Math.round(height * 0.45);
  let midShot = opt.mid;
  let midState = null;
  async function vertical(sx, sy, dx, dy) {
    const x0 = Math.round(width / 2), y0 = Math.round(height * 0.5);
    await touch("touchStart", x0, y0);
    for (let k = 1; k <= 12; k++) {
      await sleep(25);
      await touch("touchMove", Math.round(x0 + (sx * dx * k) / 12), Math.round(y0 + (sy * dy * k) / 12));
    }
    await touch("touchEnd", 0, 0);
  }
  async function swipe(dir, share, ms, fromEdge = false) {
    const sign = dir === "left" ? -1 : 1;
    const x0 = fromEdge ? (sign < 0 ? width - 10 : 10) : sign < 0 ? Math.round(width * 0.75) : Math.round(width * 0.25);
    const dist = share * width;
    const n = ms <= 100 ? 4 : 16; // a flick: few moves, so CDP round trips don't slow it below 0.45 px/ms
    await touch("touchStart", x0, y);
    for (let k = 1; k <= n; k++) {
      await sleep(ms / n);
      await touch("touchMove", Math.round(x0 + (sign * dist * k) / n), y);
      if (midShot && k === Math.floor(n / 2)) {
        midState = await state();
        const shot = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(midShot, Buffer.from(shot.data, "base64"));
        midShot = undefined;
      }
    }
    await touch("touchEnd", 0, 0);
  }
  const results = [];
  if (opt.trace) await send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline,blink", transferMode: "ReportEvents" });
  await evaluate(`window.__measure = true`);
  for (const step of opt.steps.split(",").map((s) => s.trim()).filter(Boolean)) {
    const ms = Number(opt.ms);
    const t0 = await evaluate(`performance.now()`);
    let tEnd = t0;
    if (step === "left" || step === "right") await swipe(step, Number(opt.share), ms);
    else if (step === "flick-left" || step === "flick-right") await swipe(step.slice(6), 0.18, 40); // < 22 %, > 0.45 px/ms
    else if (step === "short-left" || step === "short-right") await swipe(step.slice(6), 0.15, 600);
    else if (step === "edge-left" || step === "edge-right") await swipe(step.slice(5), Number(opt.share), ms, true);
    // The tab bar's link (a page's own section links, e.g. Analyse's Cykel, share hrefs and are inert when hidden).
    else if (step.startsWith("tap:"))
      await evaluate(
        `[...document.querySelectorAll('nav[aria-label="Hovedmenu"] a[href="${step.slice(4)}"]')]` +
          `.find((a) => a.offsetParent !== null && !a.closest('[inert]'))?.click(); true`, // the visible bar or strip
      );
    else if (step === "back") await evaluate(`history.back(); true`);
    else if (step === "forward") await evaluate(`history.forward(); true`);
    // key:<path>: focus that tab's link in the visible bar or strip, then Enter (a keyboard activation).
    else if (step.startsWith("key:")) {
      await evaluate(
        `[...document.querySelectorAll('nav[aria-label="Hovedmenu"] a[href="${step.slice(4)}"]')]` +
          `.find((a) => a.offsetParent !== null && !a.closest('[inert]'))?.focus(); true`,
      );
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    }
    else if (step.startsWith("scroll:"))
      await evaluate(`(() => { const sel = ${JSON.stringify(step.slice(7))}; const all = [...document.querySelectorAll(sel)];
        const el = all.find((e) => e.closest('[data-tab-page]')?.hasAttribute('data-active')) ?? all[0]; const m = el?.closest('main');
        if (m) m.scrollTop += el.getBoundingClientRect().top - m.getBoundingClientRect().top - 80; return true; })()`);
    else if (step.startsWith("click:"))
      await evaluate(`[...document.querySelectorAll(${JSON.stringify(step.slice(6))})].find((e) => e.offsetParent !== null && !e.closest('[inert]'))?.click(); true`);
    else if (step.startsWith("drag:")) {
      const box = await evaluate(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(step.slice(5))})].find((e) => e.offsetParent !== null && !e.closest('[inert]'));
        const r = e?.getBoundingClientRect(); return r ? [r.left, r.top, r.width, r.height] : null; })()`);
      if (box === null) throw new Error(`drag: no visible ${step.slice(5)}`);
      const [bx, by, bw, bh] = box, dy = Math.round(by + bh / 2);
      await touch("touchStart", Math.round(bx + bw * 0.15), dy);
      for (let k = 1; k <= 30; k++) {
        await sleep(20);
        await touch("touchMove", Math.round(bx + bw * (0.15 + (0.7 * k) / 30)), dy);
      }
      await touch("touchEnd", 0, 0);
    }
    else if (step.startsWith("wait:")) await sleep(Number(step.slice(5)));
    else if (step === "scroll-down") await vertical(1, -1, 20, 300);
    else if (step === "scroll-up") await vertical(1, 1, 20, 300);
    else if (step === "diag-left" || step === "diag-right") await vertical(step === "diag-left" ? -1 : 1, -1, 60, 60);
    else if (step === "tabkeys") {
      let leaked = 0;
      for (let k = 0; k < 60; k++) {
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        if (await evaluate(`!!document.activeElement?.closest('[data-tab-page]:not([data-active])')`)) leaked += 1;
      }
      results.push({ step, focusInInactivePage: leaked });
      continue;
    }
    else throw new Error(`unknown step ${step}`);
    if (!step.startsWith("tap:") && !step.startsWith("key:") && step !== "back" && step !== "forward") tEnd = await evaluate(`performance.now()`);
    await sleep(700); // the 440 ms animation and a margin
    const after = await evaluate(`window.__tl.filter((t) => t > ${tEnd})`);
    results.push({
      step,
      ...(await state()),
      settle: { changes: after.length, spanMs: after.length ? Math.round(after[after.length - 1] - after[0]) : 0 },
      ...(await evaluate(`(() => { const l = (window.__longAt || []).filter(([t]) => t >= ${t0});
        return { long: l.map(([, d]) => d), loaf: l.map(([, d, a]) => ({ ms: d, ...a })) }; })()`)),
    });
    await evaluate(`window.__longAt = []; true`);
  }
  await evaluate(`window.__measure = false`);
  let traceSummary;
  if (opt.trace) {
    const done = new Promise((r) => (traceDone = r));
    await send("Tracing.end");
    await done;
    writeFileSync(opt.trace, JSON.stringify({ traceEvents }));
    // The renderer main thread's rendering work of 8 ms or more: style (elementCount), layout, pre-paint, paint.
    const main = traceEvents.find((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain");
    traceSummary = traceEvents
      .filter((e) => e.ph === "X" && e.dur >= 8000 && (!main || (e.pid === main.pid && e.tid === main.tid)) &&
        ["UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "UpdateLayer", "FunctionCall", "EventDispatch", "RunMicrotasks", "HitTest", "ParseHTML", "IntersectionObserverController::computeIntersections"].includes(e.name))
      .map((e) => [e.name, Math.round(e.dur / 1000), e.args?.elementCount ?? e.args?.beginData?.dirtyObjects ?? e.args?.data?.type ?? e.args?.data?.functionName ?? ""]);
  }
  if (cpu > 1) await send("Emulation.setCPUThrottlingRate", { rate: 1 });
  let report;
  if (opt.report) {
    report = await evaluate(readFileSync(opt.report, "utf8"));
    if (opt["report-out"]) {
      writeFileSync(opt["report-out"], JSON.stringify(report));
      report = `written to ${opt["report-out"]}`;
    }
  }
  const timing = await evaluate(`({ long: window.__long, gap: Math.round(window.__gap) })`);
  const overflow = await evaluate(
    `[...document.querySelectorAll('[data-tab-page] main')].some((m) => m.scrollWidth > m.clientWidth) || document.documentElement.scrollWidth > document.documentElement.clientWidth`,
  );
  if (opt.out) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(opt.out, Buffer.from(shot.data, "base64"));
  }
  const long = timing.long === null ? null : timing.long.filter((d) => d > 50);
  console.log(
    JSON.stringify({ path: opt.path, cpu, initial, mid: midState, steps: results, longFramesOver50ms: long, maxFrameGapMs: timing.gap, trace: traceSummary, horizontalOverflow: overflow, consoleErrors: errors, report }),
  );
  if ((long !== null && long.length > 0) || errors.length > 0 || overflow) exitCode = 1;
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
