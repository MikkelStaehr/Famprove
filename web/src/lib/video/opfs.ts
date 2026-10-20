/**
 * The clip files on the phone (slice video-record): one file per clip, `clips/<uuid>.<ext>` in the
 * origin private file system, appended chunk by chunk while recording, read back as a Blob,
 * deleted. Behind ClipFiles so tests use the in-memory fake; the OPFS adapter is
 * opfs-browser.ts. A recording's writer commits on close(): a page that dies mid-recording leaves
 * no file (its index entry becomes afbrudt).
 */
import type { ClipExt } from "./mime.ts";

export const CLIPS_DIR = "clips";

/** The file's name inside CLIPS_DIR: the uuid and the extension, nothing else. */
export function clipFileName(id: string, ext: ClipExt): string {
  return `${id}.${ext}`;
}

export function clipPath(id: string, ext: ClipExt): string {
  return `${CLIPS_DIR}/${clipFileName(id, ext)}`;
}

/** A manual cut's file (slice clip-trim): `<uuid>.cut.<ext>`, beside the original until Fortryd's window ends. */
export function cutFileName(id: string, ext: ClipExt): string {
  return `${id}.cut.${ext}`;
}

export interface ClipWriter {
  append(chunk: Blob): Promise<void>;
  close(): Promise<void>; // the file exists from here
  abort(): Promise<void>; // nothing is kept
}

export interface ClipFiles {
  create(id: string, ext: ClipExt): Promise<ClipWriter>;
  read(id: string, ext: ClipExt): Promise<Blob | null>; // null = no such file
  remove(id: string, ext: ClipExt): Promise<void>; // idempotent
  names(): Promise<string[]>; // file names in CLIPS_DIR
  /** By file name (slice clip-trim; the name from clipFile(entry)): the whole blob, committed on success only. */
  writeFile(name: string, blob: Blob): Promise<void>;
  readFile(name: string): Promise<Blob | null>; // null = no such file
  removeFile(name: string): Promise<void>; // idempotent
}

/** In-memory files for tests: same commit-on-close rule as OPFS. */
export function memoryClipFiles(): ClipFiles {
  const files = new Map<string, Blob>();
  return {
    create: async (id, ext) => {
      const chunks: Blob[] = [];
      return {
        append: async (chunk) => {
          chunks.push(chunk);
        },
        close: async () => {
          files.set(clipFileName(id, ext), new Blob(chunks));
        },
        abort: async () => {
          chunks.length = 0;
        },
      };
    },
    read: async (id, ext) => files.get(clipFileName(id, ext)) ?? null,
    remove: async (id, ext) => {
      files.delete(clipFileName(id, ext));
    },
    names: async () => [...files.keys()],
    writeFile: async (name, blob) => {
      files.set(name, blob);
    },
    readFile: async (name) => files.get(name) ?? null,
    removeFile: async (name) => {
      files.delete(name);
    },
  };
}
