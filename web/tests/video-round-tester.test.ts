/**
 * Tester round (2026-10-17, slices variant-parts-grant, video-record, jump-undo): the migration chain
 * leaves service_role select only on exercise_variant_parts, no video file is tracked by git, and
 * Python never names video_clips or session_order.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = fileURLToPath(new URL("../..", import.meta.url));

/** Applies every grant/revoke on `table` for `role` in migration order; returns the privileges left. */
function privilegesAfterMigrations(table: string, role: string): Set<string> {
  const dir = join(repo, "supabase/migrations");
  const privs = new Set<string>();
  const all = ["select", "insert", "update", "delete", "truncate", "references", "trigger"];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).toSorted()) {
    const sql = readFileSync(join(dir, file), "utf8").replace(/--[^\n]*/g, "");
    for (const stmt of sql.split(";")) {
      const m = /^\s*(grant|revoke)\s+([a-z ,]+?)\s+on\s+(?:table\s+)?([a-z_.]+)\s+(?:to|from)\s+([a-z_, ]+)$/i.exec(stmt.trim());
      if (m === null || m[3].replace(/^public\./, "") !== table) continue;
      if (!m[4].split(",").map((r) => r.trim()).includes(role)) continue;
      const list = m[2].trim().toLowerCase() === "all" ? all : m[2].split(",").map((p) => p.trim().toLowerCase());
      for (const p of list) {
        if (m[1].toLowerCase() === "grant") privs.add(p);
        else privs.delete(p);
      }
    }
  }
  return privs;
}

test("exercise_variant_parts: after every migration, service_role may only select (insert revoked)", () => {
  assert.deepEqual([...privilegesAfterMigrations("exercise_variant_parts", "service_role")], ["select"]);
});

test("video_clips: service_role has select, insert and delete; update only through the column grant", () => {
  assert.deepEqual([...privilegesAfterMigrations("video_clips", "service_role")].toSorted(), ["delete", "insert", "select"]);
  const sql = readFileSync(join(repo, "supabase/migrations/20261017120000_jump_undo_video.sql"), "utf8");
  assert.match(sql, /grant update \(starred, clip_in_s, clip_out_s\) on table public\.video_clips to service_role;/);
});

// The one exception (slice clip-cut): the cut's fixture, Chrome's fake-camera test pattern (no personal data).
const VIDEO_FIXTURES = ["web/tests/fixtures/video/fake-kf.mp4"];

test("git tracks no video file except the cut's fake-camera fixture", () => {
  const files = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).split("\n");
  assert.deepEqual(files.filter((f) => /\.(mp4|webm|mov|mkv)$/i.test(f) && !VIDEO_FIXTURES.includes(f)), []);
});

test("python/src names neither video_clips nor session_order", () => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/video_clips|session_order/.test(readFileSync(path, "utf8"))) hits.push(path);
    }
  };
  walk(join(repo, "python/src"));
  assert.deepEqual(hits, []);
});
