/**
 * The OPFS adapter of lib/video/opfs.ts (navigator.storage.getDirectory()). One writable stream per
 * recording, committed on close. Thin: no logic beyond the File System Access calls.
 */
import { CLIPS_DIR, clipFileName, type ClipFiles } from "./opfs.ts";

async function dir(): Promise<FileSystemDirectoryHandle> {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(CLIPS_DIR, { create: true });
}

function notFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

export function opfsClipFiles(): ClipFiles {
  return {
    create: async (id, ext) => {
      const handle = await (await dir()).getFileHandle(clipFileName(id, ext), { create: true });
      const stream = await handle.createWritable();
      return {
        append: (chunk) => stream.write(chunk),
        close: () => stream.close(),
        abort: () => stream.abort(),
      };
    },
    read: async (id, ext) => {
      try {
        return await (await (await dir()).getFileHandle(clipFileName(id, ext))).getFile();
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    remove: async (id, ext) => {
      try {
        await (await dir()).removeEntry(clipFileName(id, ext));
      } catch (error) {
        if (!notFound(error)) throw error;
      }
    },
    names: async () => {
      const names: string[] = [];
      for await (const name of (await dir()).keys()) names.push(name);
      return names;
    },
  };
}

/** Ask the browser to keep the clips under storage pressure (navigator.storage.persist()); false when refused. */
export async function persistStorage(): Promise<boolean> {
  if (typeof navigator.storage?.persist !== "function") return false;
  return (await navigator.storage.persisted()) || navigator.storage.persist();
}
