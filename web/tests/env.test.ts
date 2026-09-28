import assert from "node:assert/strict";
import { test } from "node:test";

import { EnvError, readSupabaseEnv } from "../src/lib/db/env.ts";

test("readSupabaseEnv trims and drops a trailing slash", () => {
  assert.deepEqual(
    readSupabaseEnv({ SUPABASE_URL: " https://ref.supabase.co/ ", SUPABASE_SERVICE_KEY: " k " }),
    { url: "https://ref.supabase.co", serviceKey: "k" },
  );
});

test("readSupabaseEnv reports every problem and never a value", () => {
  assert.throws(
    () => readSupabaseEnv({}),
    (err: unknown) =>
      err instanceof EnvError &&
      err.message.includes("SUPABASE_URL is missing") &&
      err.message.includes("SUPABASE_SERVICE_KEY is missing"),
  );
  assert.throws(
    () => readSupabaseEnv({ SUPABASE_URL: "http://leaky-host", SUPABASE_SERVICE_KEY: "top-secret" }),
    (err: unknown) =>
      err instanceof EnvError &&
      err.message.includes("https") &&
      !err.message.includes("leaky-host") &&
      !err.message.includes("top-secret"),
  );
});
