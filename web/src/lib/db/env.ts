import "server-only";

/**
 * Supabase settings for the server-side data layer. Same variable names as the Python jobs.
 * Local: web/.env.local (Next only loads .env* from the project root, i.e. web/).
 * Prod: Vercel server environment. Never NEXT_PUBLIC_ (that would inline them into JS).
 */
export type SupabaseEnv = {
  readonly url: string; // e.g. https://<ref>.supabase.co (no trailing slash required)
  readonly serviceKey: string; // sb_secret_... or a legacy JWT (eyJ...)
};

/** Missing/invalid configuration. The message names the variable, never its value. */
export class EnvError extends Error {}

/**
 * Reads and validates SUPABASE_URL (must parse as an https URL) and SUPABASE_SERVICE_KEY
 * (non-empty after trim). `env` is injectable for tests.
 *
 * Call only after `await connection()` (see queries.ts) so it runs at request time, never
 * during `next build` (CI builds without secrets).
 */
export function readSupabaseEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SupabaseEnv {
  const problems: string[] = [];
  const url = (env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const serviceKey = (env.SUPABASE_SERVICE_KEY ?? "").trim();
  if (!url) {
    problems.push("SUPABASE_URL is missing");
  } else if (!URL.canParse(url) || new URL(url).protocol !== "https:") {
    problems.push("SUPABASE_URL must be an https URL");
  }
  if (!serviceKey) problems.push("SUPABASE_SERVICE_KEY is missing");
  if (problems.length > 0) throw new EnvError(`invalid configuration: ${problems.join("; ")}`);
  return { url, serviceKey };
}
