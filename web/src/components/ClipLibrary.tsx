"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { deleteClip, saveClip, starClip } from "@/app/actions";
import { Icon } from "@/components/icons";
import { MonoCaption } from "@/components/MonoCaption";
import { SectionTitle } from "@/components/SectionTitle";
import { WarningLine } from "@/components/WarningLine";
import type { IsoDate } from "@/lib/db/rows";
import type { VideoClipRow } from "@/lib/video/clips";
import { cleanupPlan } from "@/lib/video/cleanup";
import { type ClipIndex, type ClipIndexEntry, memoryClipIndex } from "@/lib/video/index-store";
import { indexedDbClipIndex } from "@/lib/video/index-store-browser";
import { FIXTURE_CLIP_BYTES } from "@/lib/video/library-fixture";
import {
  cleanupDue,
  cleanupLine,
  type ClipNames,
  clipCount,
  FIRST_ROWS,
  type LibraryRow,
  libraryRows,
  pendingStars,
  shownName,
  unsyncedClips,
  usedBytes,
} from "@/lib/video/library-view";
import { type ClipFiles, memoryClipFiles } from "@/lib/video/opfs";
import { opfsClipFiles } from "@/lib/video/opfs-browser";
import { shareClip, shareData, shareFileName } from "@/lib/video/share";
import { formatBytes } from "@/lib/video/space";

const CLEANUP_KEY = "famprove.clips.cleanup";
const BTN = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const DARK_BTN = `inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-track px-4 font-sans text-14 font-medium text-text ${BTN}`;

type Props = {
  readonly today: IsoDate;
  /** null: the rows could not be read (Error, rows). */
  readonly rows: readonly VideoClipRow[] | null;
  readonly names: ClipNames;
  /** Recording possible on this host (not a preview URL). */
  readonly canRecord: boolean;
  /** DEV_FIXTURE=clips: the fake index; nothing is written, deleted or shared. */
  readonly fixture: { readonly local: readonly ClipIndexEntry[] } | null;
};

type Store = { readonly index: ClipIndex; readonly files: ClipFiles };
type Local = { kind: "loading" } | { kind: "none" } | { kind: "error" } | { kind: "ready"; entries: ClipIndexEntry[] };

/** A browser that has recorded has an index database; one without (the desktop) lists rows read-only (R2). */
async function hasIndex(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  if (typeof indexedDB.databases !== "function") return true;
  const dbs = await indexedDB.databases();
  return dbs.length > 0;
}

/** The Optagelser card on Træning (design/specs/video-library.md). */
export function ClipLibrary({ today, rows: initialRows, names, canRecord, fixture }: Props) {
  const store = useRef<Store | null>(null);
  const [local, setLocal] = useState<Local>({ kind: "loading" });
  const [rows, setRows] = useState<readonly VideoClipRow[] | null>(initialRows);
  const [space, setSpace] = useState<{ quota: number | undefined; persisted: boolean | null }>({ quota: undefined, persisted: null });
  const [sizes, setSizes] = useState<Record<string, number | null>>({});
  const [cleaned, setCleaned] = useState<number>(0);
  const [status, setStatus] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<LibraryRow | null>(null);
  const [slowLoad, setSlowLoad] = useState(false);
  const [files, setFiles] = useState<ClipFiles | null>(null);
  const [canRecordHere, setCanRecordHere] = useState<boolean | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    await Promise.resolve(); // never set state synchronously inside the effect
    try {
      if (fixture !== null) {
        store.current = { index: memoryClipIndex(fixture.local), files: memoryClipFiles() };
        setFiles(store.current.files);
        setLocal({ kind: "ready", entries: await store.current.index.all() });
        setSizes(Object.fromEntries(fixture.local.map((e) => [e.id, FIXTURE_CLIP_BYTES])));
        return;
      }
      if (!(await hasIndex())) {
        setLocal({ kind: "none" });
        return;
      }
      const s: Store = { index: indexedDbClipIndex(), files: opfsClipFiles() };
      store.current = s;
      setFiles(s.files);
      let entries = await s.index.all();
      // Retries: unsynced clips (video-record §8) and unconfirmed stars (§6), then the daily cleanup.
      for (const e of unsyncedClips(entries)) {
        const r = await saveClip({ id: e.id, date: e.setKey.date, sessionNo: e.setKey.sessionNo, row: e.setKey.row, set: e.setKey.set, durationS: e.durationS });
        if (r.ok) await s.index.put({ ...e, synced: true });
      }
      for (const e of pendingStars(entries)) {
        const r = await starClip({ id: e.id, starred: e.starred });
        if (r.ok && r.found) await s.index.put({ ...e, starSynced: true });
      }
      const last = window.localStorage.getItem(CLEANUP_KEY);
      if (initialRows !== null && cleanupDue(last, today)) {
        const plan = cleanupPlan(entries, initialRows, new Date());
        for (const e of plan.deleteLocal) {
          await s.files.remove(e.id, e.ext);
          await s.index.remove(e.id);
          await deleteClip({ id: e.id });
        }
        for (const id of plan.deleteServerOnly) await deleteClip({ id });
        const gone = new Set([...plan.deleteLocal.map((e) => e.id), ...plan.deleteServerOnly]);
        setRows(initialRows.filter((r) => !gone.has(r.id)));
        setCleaned(plan.deleteLocal.length);
        window.localStorage.setItem(CLEANUP_KEY, today);
      }
      entries = await s.index.all();
      setLocal({ kind: "ready", entries });
      const sz: Record<string, number | null> = {};
      for (const e of entries) sz[e.id] = (await s.files.read(e.id, e.ext))?.size ?? null;
      setSizes(sz);
    } catch (error) {
      console.error("optagelser: reading the clip index failed", error);
      setLocal({ kind: "error" });
    }
  }, [fixture, initialRows, today]);

  useEffect(() => {
    const t = setTimeout(() => setSlowLoad(true), 300);
    void load();
    void Promise.resolve().then(() => setCanRecordHere(canRecord && typeof MediaRecorder !== "undefined"));
    const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
    if (storage !== undefined) {
      void Promise.all([storage.estimate(), fixture !== null ? Promise.resolve(false) : storage.persisted()]).then(([est, persisted]) =>
        setSpace({ quota: est.quota, persisted }),
      );
    }
    return () => clearTimeout(t);
  }, [load, canRecord, fixture]);

  const entries = local.kind === "ready" ? local.entries : null;
  const list = local.kind === "ready" || local.kind === "none" ? libraryRows(entries, rows, names) : [];

  async function toggleStar(row: LibraryRow) {
    const s = store.current;
    const e = entries?.find((x) => x.id === row.id);
    if (s === null || e === undefined || local.kind !== "ready") return;
    const next = { ...e, starred: !e.starred, starSynced: false };
    await s.index.put(next); // the local ★ first (§6)
    setLocal({ kind: "ready", entries: local.entries.map((x) => (x.id === e.id ? next : x)) });
    if (open?.id === row.id) setOpen({ ...row, starred: next.starred });
    if (fixture !== null) return;
    const r = await starClip({ id: e.id, starred: next.starred });
    if (r.ok && r.found) {
      await s.index.put({ ...next, starSynced: true });
      setRows((rs) => rs?.map((x) => (x.id === e.id ? { ...x, starred: next.starred } : x)) ?? rs);
    }
    setLocal({ kind: "ready", entries: await s.index.all() });
  }

  async function remove(row: LibraryRow) {
    const s = store.current;
    if (fixture === null) {
      if (s !== null && row.ext !== null) {
        await s.files.remove(row.id, row.ext);
        await s.index.remove(row.id);
      }
      const r = await deleteClip({ id: row.id });
      if (!r.ok && row.kind !== "missing") {
        setLocal({ kind: "ready", entries: s === null ? [] : await s.index.all() }); // the row stays as fil mangler (§12)
        setStatus("Videoen er slettet.");
        return;
      }
      if (s !== null) setLocal({ kind: "ready", entries: await s.index.all() });
      setRows((rs) => rs?.filter((x) => x.id !== row.id) ?? rs);
    }
    setStatus(row.kind === "missing" ? "Oplysningen er slettet." : "Videoen er slettet.");
  }

  function close() {
    setOpen(null);
    opener.current?.focus();
  }

  // §9: no rows and recording not possible here: no card.
  if (canRecordHere === false && list.length === 0 && local.kind !== "loading") return null;

  const used = usedBytes((entries ?? []).filter((e) => e.state !== "recording").map((e) => sizes[e.id] ?? null));
  const usedText = formatBytes(used ?? undefined);
  const quotaText = formatBytes(space.quota);
  const shown = showAll ? list : list.slice(0, FIRST_ROWS);
  const line = cleanupLine(cleaned);

  return (
    <section aria-labelledby="optagelser-title" className="rounded-card border border-border bg-card p-4.5 lg:col-start-1">
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle id="optagelser-title">Optagelser</SectionTitle>
        {list.length > 0 && <MonoCaption uppercase={false}>{clipCount(list.length)}</MonoCaption>}
      </div>
      {usedText !== null && quotaText !== null && entries !== null && (
        <p className="mt-1 font-mono text-12 text-text-muted tabular-nums">
          {usedText} af {quotaText} · ældre end 8 uger slettes automatisk (
          <Icon name="star" size={16} className="inline size-3 align-[-1px]" />
          <span className="sr-only">stjernemarkerede</span> beholdes)
        </p>
      )}
      {space.persisted === false && entries !== null && (
        <div className="mt-2">
          <WarningLine>
            Chrome har ikke lovet at beholde optagelserne. Mangler telefonen plads, kan de blive slettet.{" "}
            <span className="text-text-muted">Læg Famprove på startskærmen for at beskytte dem.</span>
          </WarningLine>
        </div>
      )}
      {line !== null && <p className="mt-2 font-sans text-13 text-text-muted">{line}</p>}
      {rows === null && (
        <div className="mt-2">
          <WarningLine>Kunne ikke hente oplysningerne om optagelserne. Stjerner gemmes, når forbindelsen er tilbage.</WarningLine>
        </div>
      )}
      {canRecordHere === false && list.length > 0 && (
        <p className="mt-2 font-sans text-13 text-text-muted">Denne browser kan ikke optage video.</p>
      )}
      {local.kind === "loading" ? (
        slowLoad ? (
          <div aria-hidden="true" className="mt-3 flex flex-col gap-2">
            <div className="h-14 animate-pulse rounded-lg bg-track motion-reduce:animate-none" />
            <div className="h-14 animate-pulse rounded-lg bg-track motion-reduce:animate-none" />
          </div>
        ) : null
      ) : local.kind === "error" ? (
        <div className="mt-3 flex flex-col gap-2" role="alert">
          <p className="font-sans text-14 text-text">Kunne ikke læse optagelserne på telefonen.</p>
          <p className="font-sans text-13 text-text-muted">Browserens lager svarede ikke.</p>
          <button type="button" className={`${DARK_BTN} self-start`} onClick={() => {
              setLocal({ kind: "loading" });
              void load();
            }}>
            Prøv igen
          </button>
        </div>
      ) : list.length === 0 ? (
        <p className="mt-3 font-sans text-14 text-text-muted">
          Ingen optagelser endnu. Tryk Optag på et arbejdssæt i Fokus. Videoen bliver på telefonen.
        </p>
      ) : (
        <ul className="mt-3">
          {shown.map((row) => (
            <ClipRow
              key={row.id}
              row={row}
              onOpen={(el) => {
                opener.current = el;
                setOpen(row);
              }}
              onStar={() => void toggleStar(row)}
              onDelete={() => void remove(row)}
            />
          ))}
        </ul>
      )}
      {!showAll && list.length > FIRST_ROWS && (
        <button type="button" className={`mt-2 min-h-11 font-sans text-14 text-text underline-offset-4 hover:underline ${BTN}`} onClick={() => setShowAll(true)}>
          Vis alle {list.length}
        </button>
      )}
      <p role="status" className="sr-only">
        {status}
      </p>
      {open !== null && (
        <Player
          row={open}
          files={files}
          fixture={fixture !== null}
          onClose={close}
          onStar={() => void toggleStar(open)}
          onDelete={() => {
            void remove(open);
            setOpen(null);
            opener.current = null;
          }}
        />
      )}
    </section>
  );
}

function NameStack({ row }: { readonly row: LibraryRow }) {
  return (
    <span className="flex flex-col">
      <span className="font-sans text-15 font-medium text-text">{shownName(row)}</span>
      {row.variant !== null && <span className="font-sans text-13 text-text-muted">{row.exercise}</span>}
    </span>
  );
}

function ClipRow({
  row,
  onOpen,
  onStar,
  onDelete,
}: {
  readonly row: LibraryRow;
  readonly onOpen: (el: HTMLElement) => void;
  readonly onStar: () => void;
  readonly onDelete: () => void;
}) {
  const meta = (
    <MonoCaption uppercase={false} className="tabular-nums">
      {row.meta}
      {row.starUnsynced && <span className="text-11"> · ikke synkroniseret</span>}
    </MonoCaption>
  );
  const playable = row.kind === "clip" || row.kind === "afbrudt";
  return (
    <li className="flex min-h-14 items-center gap-3 border-t border-border">
      {playable ? (
        <button type="button" aria-label={row.sr} className={`flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 text-left ${BTN}`} onClick={(e) => onOpen(e.currentTarget)}>
          <Icon name="play" size={18} className="text-text-muted" />
          <span className="flex min-w-0 flex-col">
            <NameStack row={row} />
            {meta}
          </span>
        </button>
      ) : (
        <div className="flex min-h-14 min-w-0 flex-1 flex-col justify-center py-2 pl-[30px]">
          <NameStack row={row} />
          {meta}
        </div>
      )}
      {row.kind === "clip" && (
        <button type="button" aria-label="Behold altid" aria-pressed={row.starred} className={`flex size-11 shrink-0 items-center justify-center rounded-full text-text ${BTN}`} onClick={onStar}>
          <Icon name="star" size={20} filled={row.starred} />
        </button>
      )}
      {row.kind === "missing" && (
        <button type="button" aria-label={row.sr} className={`${DARK_BTN} shrink-0`} onClick={onDelete}>
          Slet
        </button>
      )}
    </li>
  );
}

function Player({
  row,
  files,
  fixture,
  onClose,
  onStar,
  onDelete,
}: {
  readonly row: LibraryRow;
  readonly files: ClipFiles | null;
  readonly fixture: boolean;
  readonly onClose: () => void;
  readonly onStar: () => void;
  readonly onDelete: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [shareText, setShareText] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const keepBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let made: string | null = null;
    let live = true;
    if (!fixture && files !== null && row.ext !== null) {
      void files.read(row.id, row.ext).then((b) => {
        if (!live || b === null) return;
        made = URL.createObjectURL(b);
        setBlob(b);
        setUrl(made);
      });
    }
    return () => {
      live = false;
      if (made !== null) URL.revokeObjectURL(made); // revoked on close (§10)
    };
  }, [files, fixture, row.ext, row.id]);

  useEffect(() => {
    closeBtn.current?.focus();
    const main = document.querySelector("main");
    main?.setAttribute("inert", "");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && dialog.current !== null) {
        const f = dialog.current.querySelectorAll<HTMLElement>("button, video[controls]");
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.history.pushState({ clipPlayer: true }, "");
    const onPop = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    return () => {
      main?.removeAttribute("inert");
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
    };
  }, [onClose]);

  useEffect(() => {
    if (confirm) keepBtn.current?.focus();
  }, [confirm]);

  const canShare =
    !fixture && typeof navigator !== "undefined" && typeof navigator.canShare === "function" && row.ext !== null;

  async function share() {
    if (blob === null || row.ext === null) return;
    setPreparing(true);
    const name = shareFileName({ exerciseName: shownName(row), date: row.date, set: row.set, ext: row.ext });
    const outcome = await shareClip(navigator, shareData(blob, name, row.ext));
    setPreparing(false);
    setShareText(outcome === "failed" ? "Kunne ikke dele videoen. Prøv igen." : outcome === "unsupported" ? "Deling af video virker ikke i denne browser." : null);
  }

  return createPortal(
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={`${shownName(row)}, sæt ${row.set}`} style={{ backgroundColor: "#000" }} className="fixed inset-0 z-[100] flex flex-col text-text">
      <div className="flex items-center gap-2 p-2">
        <button ref={closeBtn} type="button" aria-label="Luk" className={`flex size-11 items-center justify-center rounded-full ${BTN}`} onClick={onClose}>
          <Icon name="x" size={20} />
        </button>
        <div className="flex min-w-0 flex-col">
          <NameStack row={row} />
          <MonoCaption uppercase={false}>{row.meta}</MonoCaption>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2">
        {fixture || (url === null && files === null) ? (
          <div className="flex aspect-[9/16] max-h-full w-full max-w-xs items-center justify-center rounded-card bg-track">
            <MonoCaption uppercase={false}>Testvisning: ingen video</MonoCaption>
          </div>
        ) : url === null ? null : (
          <video src={url} controls playsInline muted className="max-h-full max-w-full object-contain" />
        )}
      </div>
      <div className="flex flex-col gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {confirm ? (
          <>
            <p className="font-sans text-14 text-text">
              Slet videoen fra telefonen? Den kan ikke hentes igen.{row.starred ? " Den er markeret til at blive beholdt." : ""}
            </p>
            <div className="flex gap-2">
              <button type="button" className={DARK_BTN} onClick={onDelete}>
                Slet video
              </button>
              <button ref={keepBtn} type="button" className={DARK_BTN} onClick={() => setConfirm(false)}>
                Behold
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {row.kind === "clip" && (
                <button type="button" aria-pressed={row.starred} className={DARK_BTN} onClick={onStar}>
                  <Icon name="star" size={18} filled={row.starred} />
                  {row.starred ? "Beholdes" : "Behold altid"}
                </button>
              )}
              {canShare && (
                <button type="button" className={DARK_BTN} disabled={blob === null || preparing} onClick={() => void share()}>
                  <Icon name="share" size={18} />
                  {preparing ? "Forbereder …" : "Del"}
                </button>
              )}
              <button type="button" className={DARK_BTN} onClick={() => setConfirm(true)}>
                <Icon name="trash" size={18} />
                Slet
              </button>
            </div>
            {!canShare && <p className="font-sans text-13 text-text-muted">Deling af video virker ikke i denne browser.</p>}
            {shareText !== null && <p role="status" className="font-sans text-13 text-text-muted">{shareText}</p>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
