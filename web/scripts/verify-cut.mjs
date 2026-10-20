// Chrome check of the cut (slice clip-cut), not part of `pnpm test`:
//   node --conditions=react-server scripts/verify-cut.mjs [file.mp4] [in] [out]
// Cuts the file with src/lib/video/cut.ts (default: the test fixture, 1.3–2.6 s), loads the cut in a
// <video> in headless Chrome (plays to the end) and decodes every sample with WebCodecs.
// Serves on 127.0.0.1:3150 (never 3000/3100) and stops Chrome and the server on every way out.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFile, DataStream, Endianness, MP4BoxBuffer } from "mp4box";
import { cutMp4 } from "../src/lib/video/cut.ts";

const file = process.argv[2] ?? new URL("../tests/fixtures/video/fake-kf.mp4", import.meta.url).pathname;
const inS = Number(process.argv[3] ?? 1.3);
const outS = Number(process.argv[4] ?? 2.6);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 3150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString("base64");

const cut = new Uint8Array(await (await cutMp4(new Blob([readFileSync(file)]), inS, outS)).arrayBuffer());

// The cut's samples and decoder config, read back independently of cut.ts.
const f = createFile();
let info;
const samples = [];
f.onReady = (i) => { info = i; f.setExtractionOptions(i.videoTracks[0].id, null, { nbSamples: 1e6 }); f.start(); };
f.onSamples = (_id, _u, ss) => samples.push(...ss);
f.appendBuffer(MP4BoxBuffer.fromArrayBuffer(cut.slice().buffer, 0));
f.flush();
const v = info.videoTracks[0];
const ds = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
f.getTrackById(v.id).mdia.minf.stbl.stsd.entries[0].avcC.write(ds);
const job = {
  file: b64(cut), codec: v.codec, avcC: b64(new Uint8Array(ds.buffer, 8)), w: v.video.width, h: v.video.height,
  samples: samples.map((s) => ({ sync: s.is_sync, t: Math.round((s.cts * 1e6) / v.timescale), d: Math.round((s.duration * 1e6) / v.timescale), data: b64(new Uint8Array(s.data)) })),
};

const PAGE = `<!doctype html><meta charset="utf-8"><body><script>
const b = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
window.check = async (j) => {
  const out = {};
  const url = URL.createObjectURL(new Blob([b(j.file)], { type: 'video/mp4' }));
  const v = document.createElement('video'); v.muted = true; v.src = url; document.body.append(v);
  try {
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video error ' + v.error?.code)); setTimeout(() => rej(new Error('load timeout')), 8000); });
    out.duration = v.duration; out.dims = v.videoWidth + 'x' + v.videoHeight;
    const ended = new Promise((res) => (v.onended = () => res(true)));
    await v.play();
    out.ended = await Promise.race([ended, new Promise((r) => setTimeout(() => r(false), 8000))]);
  } catch (e) { out.videoError = String(e); }
  URL.revokeObjectURL(url);
  let errors = 0, frames = 0;
  const dec = new VideoDecoder({ output: (fr) => { frames++; fr.close(); }, error: (e) => { errors++; out.decErr = String(e); } });
  const cfg = { codec: j.codec, description: b(j.avcC), codedWidth: j.w, codedHeight: j.h };
  out.configSupported = (await VideoDecoder.isConfigSupported(cfg)).supported;
  dec.configure(cfg);
  for (const s of j.samples) dec.decode(new EncodedVideoChunk({ type: s.sync ? 'key' : 'delta', timestamp: s.t, duration: s.d, data: b(s.data) }));
  try { await dec.flush(); } catch (e) { errors++; out.flushErr = String(e); }
  return Object.assign(out, { samples: j.samples.length, frames, decodeErrors: errors });
};
</script>`;

const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const profile = mkdtempSync(join(tmpdir(), "verify-cut-"));
const dbg = 9850 + Math.floor(Math.random() * 50);
const browser = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${profile}`, `--remote-debugging-port=${dbg}`, "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
const watchdog = setTimeout(() => { browser.kill("SIGKILL"); server.close(); console.error("verify-cut: timed out"); process.exit(1); }, 60000);
let ok = false;
try {
  let target;
  for (let i = 0; i < 75 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ }
    if (!target) await sleep(200);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
  await sleep(800);
  const m = await send("Runtime.evaluate", { expression: `check(${JSON.stringify(job)})`, returnByValue: true, awaitPromise: true });
  const r = m.result?.result?.value ?? m.result;
  ok = r.ended === true && r.configSupported === true && r.decodeErrors === 0 && r.frames === r.samples;
  console.log(JSON.stringify({ file: file.split("/").pop(), inS, outS, bytes: cut.length, ...r, ok }));
  ws.close();
} finally {
  clearTimeout(watchdog);
  browser.kill();
  server.close();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
