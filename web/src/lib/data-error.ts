import "server-only";

import { EnvError } from "./db/env.ts";
import { PostgrestError } from "./db/postgrest.ts";
import { RowError } from "./db/rows.ts";

/** The data layer's own failures. Anything else (incl. Next's control-flow errors) is rethrown. */
export type DataError = EnvError | PostgrestError | RowError;

export function isDataError(error: unknown): error is DataError {
  return error instanceof EnvError || error instanceof PostgrestError || error instanceof RowError;
}

/** What failed, in one sentence for ErrorState (names the table, never values or secrets). */
export function describeDataError(error: DataError): string {
  if (error instanceof EnvError) return "The server is missing its database settings.";
  if (error instanceof PostgrestError) return `Reading ${error.table} from the database failed.`;
  return "The database returned data in an unexpected shape.";
}
