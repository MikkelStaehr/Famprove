// Copies MediaPipe's WASM files from node_modules to public/mediapipe/<version>/wasm/ (git-ignored),
// so Pose runs self-hosted: every request stays on this origin (slice clip-pose). Run by `dev` and
// `build` in package.json (pnpm skips pre-scripts), so Vercel's `pnpm build` gets them the same way.
// Idempotent: a file whose size and bytes already match is left alone.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG = "@mediapipe/tasks-vision";

/** The installed package's folder and version (its exports don't include package.json). */
export function packageInfo(web) {
  const dir = join(web, "node_modules", ...PKG.split("/"));
  const { version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  return { dir, version };
}

function same(a, b) {
  if (!existsSync(b)) return false;
  if (statSync(a).size !== statSync(b).size) return false;
  return readFileSync(a).equals(readFileSync(b));
}

/** Copies every file of `from` into `to`; returns the names copied (empty when all were up to date). */
export function copyWasm(from, to) {
  mkdirSync(to, { recursive: true });
  const copied = [];
  for (const name of readdirSync(from).sort()) {
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    const dst = join(to, name);
    if (same(src, dst)) continue;
    copyFileSync(src, dst);
    copied.push(name);
  }
  return copied;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { dir, version } = packageInfo(web);
  const to = join(web, "public", "mediapipe", version, "wasm");
  const copied = copyWasm(join(dir, "wasm"), to);
  console.log(copied.length === 0 ? `mediapipe ${version}: wasm up to date` : `mediapipe ${version}: copied ${copied.join(", ")}`);
}
