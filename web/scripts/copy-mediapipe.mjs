// Copies MediaPipe's WASM files from node_modules to public/mediapipe/<version>/wasm/ (git-ignored),
// so Pose runs self-hosted: every request stays on this origin (slice clip-pose). Run by `dev` and
// `build` in package.json (pnpm skips pre-scripts), so Vercel's `pnpm build` gets them the same way.
// Idempotent: a file whose size and bytes already match is left alone.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = "@mediapipe/tasks-vision";
/** The files FilesetResolver.forVisionTasks loads (SIMD, no-SIMD and module builds); all must be there. */
export const REQUIRED_WASM = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

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

/**
 * Copies every file of `from` into `to`; returns the names copied (empty when all were up to date).
 * Throws, copying nothing, when `from` lacks any of `required`: an empty folder is never "up to date".
 */
export function copyWasm(from, to, required = REQUIRED_WASM) {
  const present = existsSync(from) ? readdirSync(from) : [];
  const missing = required.filter((name) => !present.includes(name));
  if (missing.length > 0) throw new Error(`mediapipe: ${from} mangler ${missing.join(", ")}`);
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

/** True when this file is the script node was started with (symlinks resolved on both sides). */
function isMain() {
  const arg = process.argv[1];
  if (arg === undefined || !existsSync(arg)) return false;
  return realpathSync(resolve(arg)) === realpathSync(fileURLToPath(import.meta.url));
}

if (isMain()) {
  const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { dir, version } = packageInfo(web);
  const to = join(web, "public", "mediapipe", version, "wasm");
  const copied = copyWasm(join(dir, "wasm"), to);
  console.log(copied.length === 0 ? `mediapipe ${version}: wasm up to date` : `mediapipe ${version}: copied ${copied.join(", ")}`);
}
