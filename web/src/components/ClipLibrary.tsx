"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";

import { deleteClip, saveClip, starClip, trimClip } from "@/app/actions";
import {
  batchTimers,
  cleanupRemoveLocal,
  DELETE_ANNOUNCE,
  type DeleteDeps,
  deleteDoneLine,
  deleteFailedLine,
  deleteUndoneLine,
  deleteWindowText,
  finishDelete,
  finishDueDeletes,
  markSaved,
  notPendingDelete,
  pendingBatches,
  savedDeletable,
  secondsLeft as deleteSecondsLeft,
  shareMarksSaved,
  startDelete,
  undoDelete,
} from "@/lib/video/delete";
import { type CutResult, finishDueTrims, finishTrim, startTrim, type StartTrimResult, type TrimDeps, undoTrim, type UndoTrimResult } from "@/lib/video/trim";
import {
  CUTTING_LINE,
  cutPoints,
  doneAnnouncement,
  doneLine,
  endAt,
  failedLine,
  finishedLine,
  REFUSED_LINE,
  GEM_KLIP,
  NO_POINTS,
  OUT_CLEARED_LINE,
  type Points,
  pointsLine,
  secondsLeft,
  startAt,
  storedLine,
  storedPoints,
  type TrimState,
  trimStep,
  undoneLine as trimUndoneLine,
} from "@/lib/video/trim-flow";
import { Icon } from "@/components/icons";
import { MonoCaption } from "@/components/MonoCaption";
import { SectionTitle } from "@/components/SectionTitle";
import { WarningLine } from "@/components/WarningLine";
import type { IsoDate } from "@/lib/db/rows";
import { type DeleteClipResult, PERMANENT_SAVE_REFUSALS, type VideoClipRow } from "@/lib/video/clips";
import { cleanupPlan } from "@/lib/video/cleanup";
import { type ClipIndex, type ClipIndexEntry, clipFile, clipFiles, memoryClipIndex } from "@/lib/video/index-store";
import { indexedDbClipIndex } from "@/lib/video/index-store-browser";
import { FIXTURE_CLIP_BYTES, FIXTURE_SAVED, fixturePlayhead } from "@/lib/video/library-fixture";
import {
  cleanupDue,
  cleanupLine,
  type ClipNames,
  type RunSets,
  clipCount,
  type LibraryRow,
  libraryRows,
  MISSING_DELETE_FAILED,
  pendingStars,
  PLAYER_HISTORY_STATE,
  playerCloseVia,
  playerShouldPush,
  shownName,
  unsyncedClips,
  usedBytes,
} from "@/lib/video/library-view";
import { type ClipFiles, memoryClipFiles } from "@/lib/video/opfs";
import { opfsClipFiles } from "@/lib/video/opfs-browser";
import {
  browserDownload,
  clipFileNames,
  clipLabel,
  doneLine as saveAllDoneLine,
  PROMPT_LINE,
  progressLine,
  type SaveClip,
  type SaveResult,
  saveSequence,
  todaysClips,
  type UrlKeeper,
  urlKeeper,
} from "@/lib/video/save";
import { shareClip, shareData } from "@/lib/video/share";
import { type CutRange, cutClip, cutRange } from "@/lib/video/cut";
import { busyText, cutFileName, cutLine, failedCutsLine, formatSeconds, prepareClip, type Prepared, saveDoneLine, shareCutLine, splitCount } from "@/lib/video/cut-lines";
import { formatBytes } from "@/lib/video/space";
import { type ClipRangeS, rangeErrorLine, type StoredRange } from "@/lib/video/clip-range";
import { markPoint, pendingLine, refusedLine, START_CLEARED_LINE, startLabel, startLine } from "@/lib/video/clip-mark";
import { FIXTURE_FAILING_RANGE_ID } from "@/lib/video/clip-range";
import { ClipEditor, sendClipRange } from "./ClipEditor";
import { autoMetaWord, type ClipLiftMeta, editLabel, inPickupWindow, pickupQueue, playerAutoLine } from "@/lib/video/auto-lines";
import { type AutoOutcome, analyseClip } from "@/lib/video/auto-run";
import { browserStore, readAutoVersions } from "@/lib/video/auto-version";
import { autoClipOn, setAutoClipOn, subscribeAutoClip, switchStore } from "@/lib/video/auto-switch";
import { type AutoLast, readAutoLast, recordRun } from "@/lib/video/auto-last";
import { ClipSummary, type SummaryItem } from "@/components/ClipSummary";
import { isSummaryEntry } from "@/lib/video/clip-summary";
import { useWakeLock } from "@/components/fokus/useWakeLock";
import { ClipDebug } from "@/components/ClipDebug";
import { usePublishClips } from "@/components/ClipPlayerHost";
import { isDebugToggle } from "@/lib/video/debug-log";
import { browserAutoDeps } from "@/lib/video/auto-run-browser";
import { allLabel, type LinePart, lineParts, sheetCloseVia, sheetShouldPush, sheetStaysOnPop, SHEET_HISTORY_STATE } from "@/lib/video/clip-line";

const NO_LIFTS: Readonly<Record<string, ClipLiftMeta>> = {};

const CLEANUP_KEY = "famprove.clips.cleanup";
const BTN = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Resolves once the page is visible again, or the signal aborts. */
function untilVisible(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      if (document.visibilityState !== "visible" && !signal.aborted) return;
      document.removeEventListener("visibilitychange", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    document.addEventListener("visibilitychange", done);
    signal.addEventListener("abort", done, { once: true });
    done();
  });
}
const DARK_BTN = `inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-track px-4 font-sans text-14 font-medium text-text ${BTN}`;
/** Gem and Del keep their width while they read `Klipper …` / `Forbereder …` (clip-cut §7). */
const BUSY_WIDTH = "min-w-[7.5rem]";
/** clip-mark §1: the two marks, half the row each, Ember's 56px stepper height. */
/** clip-trim §2.3: Gem klip, Ember's filled primary, full width, the stepper height. */
const CUT_BTN = `inline-flex min-h-14 w-full items-center justify-center rounded-full bg-inverse-bg px-5 font-sans text-button text-inverse-text aria-disabled:opacity-60 ${BTN}`;
const MARK_BTN = `inline-flex min-h-14 flex-1 items-center justify-center gap-1 rounded-full px-4 font-sans text-button text-text aria-disabled:opacity-60 ${BTN}`;
/** clip-line §1: a quiet text button on the line (Geist 13 --text, icon --text-muted, no fill). */
const QUIET_BTN = `inline-flex min-h-11 min-w-11 items-center gap-2 whitespace-nowrap font-sans text-13 text-text ${BTN}`;
const TEXT_LINK = `inline-flex min-h-11 items-center text-text underline underline-offset-4 ${BTN}`;

/** The status line's button: Fjern klip's Fortryd (never focused by a tap, clip-mark §3). */
type RangeAction = { readonly kind: "undo-remove"; readonly old: ClipRangeS };
type RangeText = { readonly text: string; readonly warn: boolean; readonly action: RangeAction | null };
const keptUndo = (t: RangeText | null): RangeAction | null => t?.action ?? null;

/** DEV_FIXTURE=clips (clip-trim §6): the simulated cut, no file and no write; the keyframe 0,5 s before in, clip 3 fails. */
function fixtureCut(id: string) {
  return async (_file: Blob, inS: number, outS: number): Promise<CutResult> => {
    if (id === FIXTURE_FAILING_RANGE_ID) throw new Error("fixture: the failing clip");
    return { blob: new Blob([new Uint8Array(16)]), actual: { startS: Math.max(0, Math.round((inS - 0.5) * 10) / 10), endS: outS } };
  };
}

type Props = {
  readonly today: IsoDate;
  /** null: the rows could not be read (Error, rows). */
  readonly rows: readonly VideoClipRow[] | null;
  readonly names: ClipNames;
  readonly runSets: RunSets; // the clips' run set numbers (Fokus's "Sæt n"); {} = set_no
  /** Recording possible on this host (not a preview URL). */
  readonly canRecord: boolean;
  /** DEV_FIXTURE=clips: the fake index; nothing is written, deleted or shared. */
  readonly fixture: { readonly local: readonly ClipIndexEntry[] } | null;
  /** clip-auto's pickup: each recent clip's lift family and reps (readClipLifts); a clip without one is never picked up. */
  readonly lifts?: Readonly<Record<string, ClipLiftMeta>>;
};

/** clip-auto: the clip analysed on this phone right now and its frame %. */
type Running = { readonly id: string; readonly pct: number };

type Store = { readonly index: ClipIndex; readonly files: ClipFiles };
/** clip-delete §3: Fortryd's window for one batch, or a finished line. */
type DelLine =
  | { readonly kind: "window"; readonly batch: string; readonly ids: readonly string[]; readonly deadline: string; readonly count: number; readonly label: string }
  | { readonly kind: "text"; readonly text: string };
type Local = { kind: "loading" } | { kind: "none" } | { kind: "error" } | { kind: "ready"; entries: ClipIndexEntry[] };

/** deleteClip that never throws: a thrown call (the network) is a failed one, so the caller goes on. */
async function tryDeleteClip(id: string): Promise<DeleteClipResult> {
  try {
    return await deleteClip({ id });
  } catch (error) {
    console.error("optagelser: deleting a clip's row failed", error);
    return { ok: false, reason: "failed" };
  }
}

/** A browser that has recorded has an index database; one without (the desktop) lists rows read-only (R2). */
async function hasIndex(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  if (typeof indexedDB.databases !== "function") return true;
  const dbs = await indexedDB.databases();
  return dbs.length > 0;
}

/** clip-summary: the list's rows, newest first, with the server's status and this phone's last outcome. */
function summaryItems(list: readonly LibraryRow[], server: ReadonlyMap<string, VideoClipRow>, last: Readonly<Record<string, AutoLast>>): SummaryItem[] {
  return list.map((r) => ({
    id: r.id,
    clip: { name: shownName(r), set: r.set, durationS: r.durationS, serverStatus: server.get(r.id)?.autoStatus ?? null },
    last: last[r.id] ?? null,
  }));
}

/** The Optagelser line on Træning and its Alle klip sheet (design/specs/clip-line.md; video-library.md). */
export function ClipLibrary({ today, rows: initialRows, names, runSets, canRecord, fixture, lifts = NO_LIFTS }: Props) {
  const store = useRef<Store | null>(null);
  const [local, setLocal] = useState<Local>({ kind: "loading" });
  const [rows, setRows] = useState<readonly VideoClipRow[] | null>(initialRows);
  const [space, setSpace] = useState<{ quota: number | undefined; persisted: boolean | null }>({ quota: undefined, persisted: null });
  const [sizes, setSizes] = useState<Record<string, number | null>>({});
  const [cleaned, setCleaned] = useState<number>(0);
  const [status, setStatus] = useState("");
  /** clip-line §2: the Alle klip sheet. */
  const [sheet, setSheet] = useState(false);
  const allBtn = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState<LibraryRow | null>(null);
  const [slowLoad, setSlowLoad] = useState(false);
  const [files, setFiles] = useState<ClipFiles | null>(null);
  const [canRecordHere, setCanRecordHere] = useState<boolean | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const keeper = useRef<UrlKeeper | null>(null);
  const stop = useRef(false);
  const [saving, setSaving] = useState<{ k: number; total: number } | null>(null);
  const [saveLine, setSaveLine] = useState("");
  const [rest, setRest] = useState<readonly SaveClip[]>([]);
  const [running, setRunning] = useState<Running | null>(null);
  const pickupStarted = useRef(false);
  /** clip-trim §3: each pending cut's finish timer (kept here, so closing the player never ends a window), and the bytes it freed. */
  const trimTimers = useRef(new Map<string, number>());
  const trimBefore = useRef(new Map<string, { readonly row: VideoClipRow | null; readonly bytes: number | null }>());
  const [finishedTrims, setFinishedTrims] = useState<Readonly<Record<string, number | null | "refused">>>({}); // "refused": rolled back at 0
  /** clip-summary: the hidden overview, with this phone's last outcomes read when it opened; null = closed. */
  const [overview, setOverview] = useState<Readonly<Record<string, AutoLast>> | null>(null);
  /** clip-delete §3: the delete line (a Fortryd window, or its outcome); null = none. */
  const [delLine, setDelLine] = useState<DelLine | null>(null);
  const [nowMs, setNowMs] = useState(0);
  /** clip-delete: one finish timer per batch (a reload or the page visible again re-arms them grouped by batch). */
  const deleteTimersRef = useRef<ReturnType<typeof batchTimers> | null>(null);
  const delTimers = useCallback(() => {
    deleteTimersRef.current ??= batchTimers(
      { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (h) => window.clearTimeout(h as number) }, // the handle is setTimeout's number
      (batch, ids) => void finishDeleteRef.current(batch, ids),
    );
    return deleteTimersRef.current;
  }, []);
  const currentBatch = useRef<string | null>(null);
  /** clip-delete §3 Focus: where focus goes when the player closes after Slet (a row id, "heading"); null = the opener. */
  const focusAfter = useRef<string | null>(null);
  const sizesRef = useRef(sizes);
  useEffect(() => {
    sizesRef.current = sizes;
  });
  const titlePress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endTitlePress = () => {
    if (titlePress.current !== null) clearTimeout(titlePress.current);
    titlePress.current = null;
  };
  useEffect(() => endTitlePress, []);
  const closeOverview = useCallback(() => setOverview(null), []);
  // Shift+D on Træning while no player is open (the player's own Shift+D opens its panel). Closing
  // goes the way Luk does: back over the overview's history entry, whose popstate closes it (review).
  const overviewOpen = overview !== null;
  useEffect(() => {
    if (open !== null || sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isDebugToggle(e, e.target instanceof HTMLElement ? e.target : null)) return;
      if (!overviewOpen) setOverview(readAutoLast(browserStore()));
      else if (isSummaryEntry(window.history.state)) window.history.back();
      else setOverview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, overviewOpen, sheet]);

  const load = useCallback(async () => {
    await Promise.resolve(); // never set state synchronously inside the effect
    try {
      if (fixture !== null) {
        store.current = { index: memoryClipIndex(fixture.local), files: memoryClipFiles() };
        for (const e of fixture.local) await store.current.files.writeFile(clipFile(e), new Blob([new Uint8Array(32)])); // clip-trim §6: the simulated cut reads a placeholder
        setFiles(store.current.files);
        await markSaved({ index: store.current.index }, FIXTURE_SAVED); // clip-delete §4: through Gem's own setter
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
      await finishDueTrims({ index: s.index, files: s.files, trim: trimClip }, new Date()); // clip-trim §3: originals past their deadline
      const dueDeletes = await finishDueDeletes({ index: s.index, files: s.files, del: (i) => tryDeleteClip(i.id) }, new Date()); // clip-delete: deletes past their deadline
      if (dueDeletes.finished.length > 0) {
        const gone = new Set(dueDeletes.finished);
        setRows((rs) => rs?.filter((r) => !gone.has(r.id)) ?? rs);
      }
      if (dueDeletes.failed.length > 0) {
        setDelLine({ kind: "text", text: deleteFailedLine(dueDeletes.failed.length) });
        setStatus(deleteFailedLine(dueDeletes.failed.length));
      }
      for (const b of pendingBatches(dueDeletes.pending)) delTimers().schedule(b.batch, b.ids, b.deadline, new Date().getTime()); // a reload inside the window: hidden, one timer per batch finishes all its clips at the deadline, no Fortryd
      let entries = await s.index.all();
      // Retries: unsynced clips (video-record §8) and unconfirmed stars (§6), then the daily cleanup.
      for (const e of notPendingDelete(unsyncedClips(entries))) {
        const r = await saveClip({ id: e.id, date: e.setKey.date, sessionNo: e.setKey.sessionNo, row: e.setKey.row, set: e.setKey.set, durationS: e.durationS });
        if (r.ok) await s.index.put({ ...e, synced: true });
        else if (PERMANENT_SAVE_REFUSALS.has(r.reason)) await s.index.put({ ...e, syncRefused: r.reason }); // never retried
      }
      for (const e of pendingStars(entries)) {
        const r = await starClip({ id: e.id, starred: e.starred });
        if (r.ok && r.found) await s.index.put({ ...e, starSynced: true });
      }
      const last = window.localStorage.getItem(CLEANUP_KEY);
      if (initialRows !== null && cleanupDue(last, today)) {
        const plan = cleanupPlan(entries, initialRows, new Date());
        const removed: string[] = [];
        for (const e of notPendingDelete(plan.deleteLocal)) {
          if (!(await cleanupRemoveLocal(s, e.id))) continue; // under the clip's lock: a delete or cut in flight wins
          removed.push(e.id);
          await tryDeleteClip(e.id); // a failed row is tomorrow's deleteServerOnly; the cleanup goes on
        }
        for (const id of plan.deleteServerOnly) await tryDeleteClip(id);
        const gone = new Set([...removed, ...plan.deleteServerOnly, ...dueDeletes.finished]);
        setRows(initialRows.filter((r) => !gone.has(r.id)));
        setCleaned(removed.length);
        window.localStorage.setItem(CLEANUP_KEY, today);
      }
      entries = await s.index.all();
      setLocal({ kind: "ready", entries });
      for (const e of entries) if (e.pendingTrim !== undefined) scheduleFinishRef.current(e.id, e.pendingTrim.deadline); // a window still open from before: its finish
      const sz: Record<string, number | null> = {};
      for (const e of entries) sz[e.id] = (await s.files.readFile(clipFile(e)))?.size ?? null;
      setSizes(sz);
    } catch (error) {
      console.error("optagelser: reading the clip index failed", error);
      setLocal({ kind: "error" });
    }
  }, [fixture, initialRows, today, delTimers]);

  useEffect(() => {
    const t = setTimeout(() => setSlowLoad(true), 1000); // clip-line §4: the space figure pulses after 1 s
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

  // §6, §9: blob URLs revoked 60 s after their click, or all on pagehide and unmount; a run stops when the page is hidden.
  useEffect(() => {
    const k = urlKeeper((url) => URL.revokeObjectURL(url), { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (h) => window.clearTimeout(h as number) });
    keeper.current = k;
    stop.current = false;
    const onHide = () => {
      stop.current = true;
      k.revokeAll();
    };
    const onVisible = () => {
      if (document.visibilityState === "hidden") stop.current = true;
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisible);
      onHide();
    };
  }, []);

  // clip-auto §1 Pickup: clips Fokus left unanalysed or analysed with an older ALGO_VERSION (MP4, a
  // local file, the last 7 days), one at a time, newest first, through the same analyseClip. Unmount aborts
  // the run (nothing written for that clip); the fixture never runs one.
  // Keyed on the index being read, never on rows: the run's own outcome updates rows.
  // clip-auto-park: the switch (off by default), read after hydration (the server's snapshot is off).
  const autoOn = useSyncExternalStore(subscribeAutoClip, readAutoClip, () => false);
  const readyEntries = local.kind === "ready" ? local.entries : null;
  const ready = readyEntries !== null;
  const entriesNow = useRef<readonly ClipIndexEntry[] | null>(null);
  useEffect(() => {
    entriesNow.current = readyEntries;
  }, [readyEntries]);
  useEffect(() => {
    const found = entriesNow.current;
    if (!autoOn || fixture !== null || !ready || found === null || initialRows === null || store.current === null || pickupStarted.current) return;
    const queue = pickupQueue(found, initialRows, new Date(), readAutoVersions(browserStore()), autoOn).filter((r) => lifts[r.id] !== undefined);
    if (queue.length === 0) return;
    pickupStarted.current = true;
    const s = store.current;
    const ctrl = new AbortController();
    void (async () => {
      for (let i = 0; i < queue.length; i++) {
        const r = queue[i];
        if (ctrl.signal.aborted) return;
        const lift = lifts[r.id];
        let blob: Blob | null = null;
        try {
          const e = found.find((x) => x.id === r.id);
          blob = e === undefined || e.pendingTrim !== undefined ? null : await s.files.readFile(clipFile(e)); // clip-trim §5
        } catch {
          blob = null;
        }
        if (blob === null || lift === undefined || ctrl.signal.aborted) continue;
        setRunning({ id: r.id, pct: 0 });
        const out = await analyseClip(r.id, blob, { ext: "mp4", durationS: r.durationS, family: lift.family, expected: lift.expected }, {
          signal: ctrl.signal,
          onProgress: (p) => setRunning({ id: r.id, pct: p.kind === "running" ? p.pct : 0 }),
          deps: browserAutoDeps,
        });
        setRunning(null);
        recordRun(browserStore(), r.id, out, new Date().getTime());
        if (out.kind === "aborted" && !ctrl.signal.aborted) {
          // clip-auto-3: a hidden page aborts the run (nothing written; the pickup's own abort is the
          // only other cause, excluded above); the same clip again once visible, even if the page is
          // visible again by now (review 2026-10-20)
          await untilVisible(ctrl.signal);
          i--;
          continue;
        }
        if (out.kind === "clipped" || out.kind === "low_confidence" || out.kind === "failed") {
          const auto = out.kind === "clipped" ? { autoStatus: out.kind, autoInS: out.inS, autoOutS: out.outS } : { autoStatus: out.kind, autoInS: null, autoOutS: null };
          setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, ...auto } : x)) ?? rs);
        }
      }
    })();
    return () => {
      ctrl.abort();
      pickupStarted.current = false;
    };
  }, [autoOn, fixture, ready, initialRows, lifts]);

  // clip-auto-3: the screen stays on while a pickup run is on (released after it; the hook re-requests when visible).
  useWakeLock(running !== null);

  const entries = local.kind === "ready" ? local.entries : null;
  const list = useMemo(
    () => (local.kind === "ready" || local.kind === "none" ? libraryRows(local.kind === "ready" ? local.entries : null, rows, names, runSets) : []),
    [local, rows, names, runSets],
  );
  // clip-at-set: Træning's list and the week card open this one Player through the tabs shell's host.
  const listNow = useRef(list);
  useEffect(() => {
    listNow.current = list;
  }, [list]);
  /** Set when the open Player came from a ▶ outside the card: where focus goes after its Slet (§3). */
  const externalAfter = useRef<(() => HTMLElement | null) | null>(null);
  const openExternal = useCallback((id: string, el: HTMLElement, afterDelete: () => HTMLElement | null) => {
    const row = listNow.current.find((r) => r.id === id);
    if (row === undefined) return;
    opener.current = el;
    focusAfter.current = null;
    externalAfter.current = afterDelete;
    setOpen(row);
  }, []);
  usePublishClips(local.kind === "ready" ? list : null, openExternal);

  const fileNames = clipFileNames(list);
  const serverById = new Map((rows ?? []).map((r) => [r.id, r]));
  /** The clip's cut (clip-cut): the user's in/out, else the automatic one, else none; WebM never. */
  const cutOf = (r: Pick<LibraryRow, "id" | "ext">): CutRange => {
    const server = serverById.get(r.id);
    if (r.ext === null || server === undefined) return { reason: "none", range: null };
    return cutRange(server, r.ext, { auto: autoOn });
  };
  const today_ = todaysClips(list, today);
  const testPrefix = fixture !== null ? "Testvisning: " : "";

  /** clip-trim: the cut's deps; the fixture's cut and trim are fakes (no file, no write). */
  function trimDeps(id: string): TrimDeps | null {
    const s = store.current;
    if (s === null) return null;
    if (fixture !== null) return { index: s.index, files: s.files, trim: async (i) => ({ ok: true, dev: true, durationS: i.durationS }), cut: fixtureCut(id) };
    return { index: s.index, files: s.files, trim: trimClip };
  }

  async function fileBytes(id: string, toS?: number, fromS?: number | null): Promise<number | null> {
    if (fixture !== null) return toS !== undefined && fromS !== undefined && fromS !== null && fromS > 0 ? Math.round((FIXTURE_CLIP_BYTES * toS) / fromS) : FIXTURE_CLIP_BYTES;
    const s = store.current;
    const e = s === null ? null : await s.index.get(id);
    return s === null || e === null ? null : ((await s.files.readFile(clipFile(e)))?.size ?? null);
  }

  function clearTrimTimer(id: string) {
    const t = trimTimers.current.get(id);
    if (t !== undefined) window.clearTimeout(t);
    trimTimers.current.delete(id);
  }

  /** §3 at 0: finishTrim (the one server write), then the space line and the player's frigjort line. */
  async function finishNow(id: string) {
    trimTimers.current.delete(id);
    const deps = trimDeps(id);
    const s = store.current;
    if (deps === null || s === null) return;
    const r = await finishTrim(deps, id, new Date());
    if (r === "waiting") {
      const e = await s.index.get(id);
      if (e?.pendingTrim !== undefined) scheduleFinishRef.current(id, e.pendingTrim.deadline);
      return;
    }
    if (r === "failed") return; // pendingTrim stays: the next load's finishDueTrims retries
    const before = trimBefore.current.get(id);
    trimBefore.current.delete(id);
    if (r === "refused") {
      // refused for good: the original is the clip again (finishTrim rolled back), so is its row
      if (before?.row != null) {
        const prev = before.row;
        setRows((rs) => rs?.map((x) => (x.id === id ? prev : x)) ?? rs);
      }
      setSizes((sz) => ({ ...sz, [id]: before?.bytes ?? null }));
      setLocal({ kind: "ready", entries: await s.index.all() });
      setFinishedTrims((f) => ({ ...f, [id]: "refused" }));
      return;
    }
    const e = await s.index.get(id);
    const after = await fileBytes(id, e?.durationS ?? undefined, before?.row?.durationS ?? null);
    setSizes((sz) => ({ ...sz, [id]: after }));
    setLocal({ kind: "ready", entries: await s.index.all() });
    const freed = before?.bytes !== null && before?.bytes !== undefined && after !== null ? Math.max(0, before.bytes - after) : null;
    setFinishedTrims((f) => ({ ...f, [id]: freed }));
  }
  const finishRef = useRef(finishNow);
  useEffect(() => {
    finishRef.current = finishNow;
  });

  /** One finish timer per pending cut, at its deadline. */
  const scheduleFinishRef = useRef((id: string, deadline: string) => {
    const old = trimTimers.current.get(id);
    if (old !== undefined) window.clearTimeout(old);
    const ms = Math.max(0, Date.parse(deadline) - Date.now()) + 50;
    trimTimers.current.set(id, window.setTimeout(() => void finishRef.current(id), ms));
  });

  useEffect(() => () => delTimers().clearAll(), [delTimers]); // unmount: the next load's finishDueDeletes finishes them
  // §3: Fortryd's text countdown (10 → 1) while a window is open.
  // clip-line §3: a cut's window on the line, only while its deadline is ahead (a finish that failed
  // leaves pendingTrim set; it retries on the next load and must not keep the 250 ms tick alive; review).
  const trimWaiting =
    local.kind === "ready" &&
    local.entries.some((e) => e.pendingTrim !== undefined && e.id !== open?.id && (nowMs === 0 || secondsLeft(e.pendingTrim.deadline, nowMs) > 0));
  const windowOpen = delLine?.kind === "window" || trimWaiting;
  useEffect(() => {
    if (!windowOpen) return;
    const first = window.setTimeout(() => setNowMs(Date.now()), 0);
    const t = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [windowOpen]);

  // §3 lifecycle (cuts and deletes alike): the finish timers go on unmount and while hidden; visible
  // again re-arms every pending window from the index (past its deadline it finishes at once; deletes
  // one timer per batch); a next mount's finishDueTrims / finishDueDeletes covers the rest.
  useEffect(() => {
    const timers = trimTimers.current;
    const clearAll = () => {
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
      delTimers().clearAll();
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        clearAll();
        return;
      }
      const s = store.current;
      if (s === null) return;
      void s.index.all().then((all) => {
        for (const e of all) if (e.pendingTrim !== undefined) scheduleFinishRef.current(e.id, e.pendingTrim.deadline);
        for (const b of pendingBatches(all)) delTimers().schedule(b.batch, b.ids, b.deadline, new Date().getTime());
      });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearAll();
    };
  }, [delTimers]);

  /** §2.3 Gem klip: startTrim; done updates the row (new file, length, no stored range) and times the finish. */
  async function runTrim(id: string, inS: number, outS: number): Promise<StartTrimResult> {
    const deps = trimDeps(id);
    const s = store.current;
    if (deps === null || s === null) return { kind: "failed", space: false };
    setFinishedTrims((f) => {
      const next = { ...f };
      delete next[id];
      return next;
    });
    const bytes = sizes[id] ?? null;
    const row = serverById.get(id) ?? null;
    const r = await startTrim(deps, id, inS, outS, new Date());
    if (r.kind !== "done") return r;
    if (!trimBefore.current.has(id)) trimBefore.current.set(id, { row, bytes });
    setLocal({ kind: "ready", entries: await s.index.all() });
    setRows((rs) => rs?.map((x) => (x.id === id ? { ...x, durationS: r.toS, clipInS: null, clipOutS: null, autoInS: null, autoOutS: null, autoStatus: null } : x)) ?? rs);
    scheduleFinishRef.current(id, r.deadline);
    return r;
  }

  /** §3 Fortryd: undoTrim (local only); the row gets its length and stored range back. */
  async function runUndoTrim(id: string): Promise<UndoTrimResult> {
    const s = store.current;
    if (s === null) return { kind: "failed" };
    const r = await undoTrim({ index: s.index, files: s.files }, id, new Date());
    if (r.kind !== "undone") return r;
    clearTrimTimer(id);
    const before = trimBefore.current.get(id);
    trimBefore.current.delete(id);
    if (before?.row != null) {
      const prev = before.row;
      setRows((rs) => rs?.map((x) => (x.id === id ? prev : x)) ?? rs);
    }
    setLocal({ kind: "ready", entries: await s.index.all() });
    return r;
  }

  /** One clip to Downloads (the player's Gem, §1). Fixture: no file, no URL. */
  function download(blob: Blob, name: string) {
    if (fixture !== null || keeper.current === null) return;
    browserDownload(keeper.current)(blob, name);
  }

  /** A clip whose file is gone (§10): its index entry goes, so the row turns fil mangler. Fixture: nothing written. */
  async function forgetMissing(ids: readonly string[]) {
    const s = store.current;
    if (fixture !== null || s === null || ids.length === 0) return;
    for (const id of ids) {
      const e = await s.index.get(id);
      if (e?.pendingTrim !== undefined) for (const f of clipFiles(e)) await s.files.removeFile(f); // a pending cut: the original and the cut both go
      clearTrimTimer(id);
      await s.index.remove(id);
    }
    setLocal({ kind: "ready", entries: await s.index.all() });
  }

  async function saveAll(clips: readonly SaveClip[]) {
    if (clips.length === 0 || saving !== null) return;
    stop.current = false;
    const s = store.current;
    const byId = new Map(list.map((r) => [r.id, r]));
    let cutCount = 0;
    let failedCuts = 0;
    let preparing: string | null = null;
    const sentIds: string[] = [];
    setDelLine((l) => (l?.kind === "window" ? l : null)); // an open Fortryd stays (its own slot); only an old outcome line goes
    const result: SaveResult = await saveSequence(clips, {
      read: async (id) => {
        if (fixture !== null) return new Blob([]);
        const r = byId.get(id);
        if (s === null || r === undefined || r.file === null) return null;
        return s.files.readFile(r.file);
      },
      download,
      sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
      onProgress: (k, total) => {
        setSaving({ k, total });
        setSaveLine(`${testPrefix}${progressLine(k, total)}${total >= 2 ? ` ${PROMPT_LINE}` : ""}`);
      },
      aborted: () => stop.current,
      prepare: async (clip, blob) => {
        preparing = clip.id;
        const r = byId.get(clip.id);
        const cut = r === undefined ? ({ reason: "none", range: null } as const) : cutOf(r);
        if (fixture !== null) return { blob, name: cut.range === null ? clip.name : cutFileName(clip.name), cut: cut.range !== null };
        const p = await prepareClip(blob, clip.name, cut, cutClip);
        if (p.kind === "failed") failedCuts += 1;
        return { blob: p.blob, name: p.name, cut: p.kind === "cut" };
      },
      onSent: (cut) => {
        if (cut) cutCount += 1;
        if (preparing !== null) sentIds.push(preparing);
      },
    });
    setSaving(null);
    setRest(result.remaining);
    const failedLine = failedCutsLine(failedCuts);
    setSaveLine(`${testPrefix}${saveAllDoneLine(result, splitCount(result.sent, cutCount))}${failedLine === null ? "" : ` ${failedLine}`}`);
    await forgetMissing(result.missing.map((c) => c.id));
    await markSavedNow(sentIds);
  }

  /** clip-delete §2: `gemt ✓` after Gem, Gem alle or a share that resolved (local only). */
  async function markSavedNow(ids: readonly string[]) {
    const s = store.current;
    if (s === null || ids.length === 0) return;
    await markSaved({ index: s.index }, ids);
    setLocal({ kind: "ready", entries: await s.index.all() });
  }

  function deleteDeps(): DeleteDeps | null {
    const s = store.current;
    if (s === null) return null;
    if (fixture !== null) return { index: s.index, files: s.files, del: async () => ({ ok: true, dev: true }) }; // dev switches: no server DELETE
    return { index: s.index, files: s.files, del: (i) => tryDeleteClip(i.id) };
  }

  /** §3 Focus after a delete: the next row's play button, else the previous row's, else the heading. */
  function focusTargetAfter(ids: ReadonlySet<string>): string {
    const at = shown.findIndex((r) => ids.has(r.id));
    const kept = (r: LibraryRow) => !ids.has(r.id) && (r.kind === "clip" || r.kind === "afbrudt");
    const next = at < 0 ? undefined : shown.slice(at + 1).find(kept);
    const prev = at < 0 ? undefined : [...shown.slice(0, at)].reverse().find(kept);
    return (next ?? prev)?.id ?? "heading";
  }

  function focusClip(target: string) {
    setTimeout(() => {
      // clip-line §3: the sheet's heading or its row while it is open; else Alle klip on the line.
      const el = (target === "heading" ? document.getElementById("alle-klip-title") : document.querySelector<HTMLElement>(`[data-clip-play="${target}"]`)) ?? allBtn.current;
      el?.focus();
    }, 0);
  }

  /**
   * Slet (one clip) and Slet gemte (a batch): mark, hide, open Fortryd's window, time the finish.
   * "starred": nothing marked because ★ was set after the render (the player then shows its confirm).
   */
  async function startDeleteRows(targets: readonly LibraryRow[], viaPlayer: boolean, allowStarred = false): Promise<"started" | "starred" | "none"> {
    const deps = deleteDeps();
    const s = store.current;
    if (deps === null || s === null || targets.length === 0) return "none";
    const ids = targets.map((r) => r.id);
    const focus = focusTargetAfter(new Set(ids));
    if (viaPlayer) focusAfter.current = focus;
    const batch = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${new Date().toISOString()}-${ids.join(",")}`;
    const { marked, starred, deadline } = await startDelete(deps, ids, batch, new Date(), { allowStarred });
    setLocal({ kind: "ready", entries: await s.index.all() });
    if (marked.length === 0) {
      if (viaPlayer) focusAfter.current = null;
      return starred.length > 0 ? "starred" : "none";
    }
    const first = targets.find((r) => r.id === marked[0]?.id) ?? targets[0];
    const label = first === undefined ? "" : `${shownName(first)} · sæt ${first.set}`;
    currentBatch.current = batch;
    setSaveLine("");
    setNowMs(new Date().getTime());
    setDelLine({ kind: "window", batch, ids: marked.map((e) => e.id), deadline, count: marked.length, label });
    setStatus(DELETE_ANNOUNCE);
    delTimers().schedule(batch, marked.map((e) => e.id), deadline, new Date().getTime());
    if (!viaPlayer) focusClip(focus);
    return "started";
  }

  /** Fortryd: the batch's marks go (no server write); focus to the first restored row. */
  async function undoDeleteBatch(line: Extract<DelLine, { kind: "window" }>) {
    const deps = deleteDeps();
    const s = store.current;
    if (deps === null || s === null) return;
    const restored = await undoDelete(deps, line.ids, line.batch, new Date());
    if (restored.length === 0) return; // the window closed first: the finish goes on
    delTimers().cancel(line.batch);
    setLocal({ kind: "ready", entries: await s.index.all() });
    const text = deleteUndoneLine(restored.length, line.label);
    setDelLine({ kind: "text", text });
    setStatus(text);
    const firstId = line.ids.find((id) => restored.some((e) => e.id === id));
    if (firstId !== undefined) focusClip(firstId);
  }

  /** At 0: finishDelete per clip (DELETE → files → entry), then the frigjort or failure line. */
  async function finishDeleteBatch(batch: string, ids: readonly string[]) {
    const deps = deleteDeps();
    const s = store.current;
    if (deps === null || s === null) return;
    const done: string[] = [];
    const waiting: ClipIndexEntry[] = [];
    let failed = 0;
    for (const id of ids) {
      const r = await finishDelete(deps, id, new Date());
      if (r === "done") done.push(id);
      else if (r === "failed") failed += 1;
      else if (r === "waiting") {
        const e = await s.index.get(id);
        if (e !== null) waiting.push(e);
      } // "none": a Fortryd landed first; the clip is listed again and its line stays
    }
    for (const b of pendingBatches(waiting)) delTimers().schedule(b.batch, b.ids, b.deadline, new Date().getTime()); // once for the batch
    if (done.length === 0 && failed === 0) return;
    const gone = new Set(done);
    const freed = done.reduce<number | null>((sum, id) => {
      const b = sizesRef.current[id];
      return sum === null || b === null || b === undefined ? null : sum + b;
    }, 0);
    setRows((rs) => rs?.filter((r) => !gone.has(r.id)) ?? rs);
    setSizes((sz) => Object.fromEntries(Object.entries(sz).filter(([id]) => !gone.has(id))));
    setLocal({ kind: "ready", entries: await s.index.all() });
    if (currentBatch.current !== batch) return; // an older batch: the line shows the newest
    const text = failed > 0 ? deleteFailedLine(failed) : deleteDoneLine(done.length, done.length > 0 ? formatBytes(freed ?? undefined) : null);
    setDelLine({ kind: "text", text });
    setStatus(text);
  }
  const finishDeleteRef = useRef(finishDeleteBatch);
  useEffect(() => {
    finishDeleteRef.current = finishDeleteBatch;
  });

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
    clearTrimTimer(row.id); // a pending cut's finish never runs on a deleted clip
    if (fixture === null) {
      if (s !== null && row.ext !== null) {
        for (const f of row.files) await s.files.removeFile(f);
        await s.index.remove(row.id);
      }
      const r = await tryDeleteClip(row.id);
      if (!r.ok && row.kind === "missing") {
        setStatus(MISSING_DELETE_FAILED); // the row stays
        return;
      }
      if (!r.ok) {
        setLocal({ kind: "ready", entries: s === null ? [] : await s.index.all() }); // the row stays as fil mangler (§12)
        setStatus("Videoen er slettet.");
        return;
      }
      if (s !== null) setLocal({ kind: "ready", entries: await s.index.all() });
      setRows((rs) => rs?.filter((x) => x.id !== row.id) ?? rs);
    }
    setStatus(row.kind === "missing" ? "Oplysningen er slettet." : "Videoen er slettet.");
  }

  /** Closes the player now (the back gesture's popstate, or no entry of ours on top). Stable, so the Player's effect runs once. */
  const close = useCallback(() => {
    const el = opener.current;
    const after = focusAfter.current;
    focusAfter.current = null;
    setOpen(null);
    setTimeout(() => {
      if (after === null) {
        el?.focus();
        return;
      }
      const target = (after === "heading" ? document.getElementById("alle-klip-title") : document.querySelector<HTMLElement>(`[data-clip-play="${after}"]`)) ?? allBtn.current;
      target?.focus();
    }, 0); // after the Player's cleanup lifts inert from <main>
  }, []);

  /** Luk and Escape: back over our history entry when it is on top; its popstate then closes (§10). */
  const requestClose = useCallback(() => {
    if (playerCloseVia(window.history.state) === "back") window.history.back();
    else close();
  }, [close]);

  /** clip-line §2: the sheet closes now (back's popstate, or no entry of ours on top); focus back to Alle klip. */
  const closeSheet = useCallback(() => {
    setSheet(false);
    setTimeout(() => allBtn.current?.focus(), 0); // after the sheet's cleanup lifts inert from <main>
  }, []);

  /** Luk and Escape: back over the sheet's history entry when it is on top; its popstate then closes. */
  const requestCloseSheet = useCallback(() => {
    if (sheetCloseVia(window.history.state) === "back") window.history.back();
    else closeSheet();
  }, [closeSheet]);

  /** clip-line §3: a cut's Fortryd on the line (the player's own undo, moved); focus to Alle klip or the restored row. */
  async function undoTrimOnLine(id: string) {
    const r = await runUndoTrim(id);
    if (r.kind !== "undone") return;
    setStatus(trimUndoneLine(r.durationS));
    focusClip(id);
  }

  const used = usedBytes((entries ?? []).filter((e) => e.state !== "recording").map((e) => sizes[e.id] ?? null));
  const usedText = formatBytes(used ?? undefined);
  const quotaText = formatBytes(space.quota);
  const shown = list; // clip-line §2: the sheet lists every row (no Vis alle)
  /** The open clip as the list has it now (a cut changes its file and length, clip-trim §2.3). */
  const openRow = open === null ? null : (list.find((r) => r.id === open.id) ?? open);
  const line = cleanupLine(cleaned);
  const deletable = entries === null ? [] : savedDeletable(entries);
  const saveCount = rest.length > 0 ? rest.length : today_.length;
  /** clip-line §3: a cut's Fortryd once its player has closed. */
  const trimsOpen = (entries ?? []).filter((e) => e.pendingTrim !== undefined && e.id !== open?.id && nowMs > 0 && secondsLeft(e.pendingTrim.deadline, nowMs) > 0);
  const parts = lineParts({
    loading: local.kind === "loading",
    error: local.kind === "error",
    clips: list.length,
    save: entries === null ? 0 : saveCount,
    deletable: deletable.length,
    pending: delLine !== null || saveLine !== "" || trimsOpen.length > 0,
    sheetOpen: sheet,
  });
  const warn = (space.persisted === false && entries !== null) || rows === null;

  const statusRow = (
    <div className="flex flex-col gap-1">
      {delLine?.kind === "window" ? (
        <p className="flex flex-wrap items-center gap-x-1 font-sans text-13 text-text-muted">
          <span>{deleteWindowText(delLine.count, delLine.label)}</span>
          <button type="button" className={`${DARK_BTN} tabular-nums`} aria-label={delLine.count === 1 ? "Fortryd sletningen" : `Fortryd sletningen af ${delLine.count} klip`} onClick={() => void undoDeleteBatch(delLine)}>
            Fortryd <span aria-hidden="true">{deleteSecondsLeft(delLine.deadline, nowMs)}</span>
          </button>
        </p>
      ) : delLine?.kind === "text" ? (
        <p className="font-sans text-13 text-text-muted">{delLine.text}</p>
      ) : null}
      {trimsOpen.map((e) =>
        e.pendingTrim === undefined ? null : (
          <p key={e.id} className="flex flex-wrap items-center gap-x-3 font-sans text-13 text-text-muted">
            <span className="tabular-nums">{doneLine(e.pendingTrim.newDurationS, e.pendingTrim.originalDurationS)} ·</span>
            <button type="button" className={`${DARK_BTN} min-h-11`} aria-label="Fortryd klippet" onClick={() => void undoTrimOnLine(e.id)}>
              Fortryd <span aria-hidden="true" className="font-mono tabular-nums">{secondsLeft(e.pendingTrim.deadline, nowMs)}</span>
            </button>
          </p>
        ),
      )}
      <p role="status" className="font-sans text-13 text-text-muted empty:hidden">
        {saveLine}
      </p>
    </div>
  );

  const spaceFigure = (
    <span
      className="flex min-h-11 select-none items-center font-mono text-12 text-text-muted tabular-nums [-webkit-touch-callout:none]"
      onPointerDown={() => {
        endTitlePress();
        titlePress.current = setTimeout(() => setOverview(readAutoLast(browserStore())), 600);
      }}
      onPointerUp={endTitlePress}
      onPointerLeave={endTitlePress}
      onPointerCancel={endTitlePress}
      onContextMenu={(e) => e.preventDefault()}
    >
      {local.kind === "loading" || usedText === null ? (
        <span aria-hidden="true" className={`inline-block h-3 w-12 rounded-sm ${slowLoad ? "animate-pulse bg-track motion-reduce:animate-none" : ""}`} />
      ) : (
        usedText
      )}
    </span>
  );

  const allButton = (
    <button
      ref={allBtn}
      id="alle-klip-btn"
      type="button"
      aria-haspopup="dialog"
      className={`ml-auto inline-flex min-h-11 min-w-11 items-center gap-1 whitespace-nowrap font-sans text-14 text-text ${BTN}`}
      onClick={() => setSheet(true)}
    >
      {warn && (
        <>
          <Icon name="warning" size={16} className="text-warning" />
          <span className="sr-only">– se advarsel</span>
        </>
      )}
      {allLabel(list.length)}
      <Icon name="chevron-right" size={16} />
    </button>
  );

  const part = (p: LinePart) => {
    switch (p) {
      case "space":
        return <span key={p}>{spaceFigure}</span>;
      case "switch":
        return <LineSwitch key={p} on={autoOn} />;
      case "all":
        return <span key={p} className="ml-auto">{allButton}</span>;
      case "empty":
        return (
          <span key={p} className="flex min-h-11 items-center font-sans text-13 text-text-muted">
            Ingen optagelser endnu
          </span>
        );
      case "save":
        return (
          <button
            key={p}
            type="button"
            className={`${QUIET_BTN} disabled:opacity-60`}
            disabled={saving !== null}
            onClick={() =>
              void saveAll(
                rest.length > 0 ? rest : today_.map((r) => ({ id: r.id, name: fileNames.get(r.id) ?? `${r.id}.${r.ext}`, label: clipLabel(r) })),
              )
            }
          >
            <Icon name="download" size={16} className="text-text-muted" />
            {saving !== null ? progressLine(saving.k, saving.total) : rest.length > 0 ? `Gem resten · ${rest.length}` : `Gem alle fra i dag · ${today_.length}`}
          </button>
        );
      case "delete":
        return (
          <button key={p} type="button" className={QUIET_BTN} onClick={() => void startDeleteRows(list.filter((r) => deletable.some((e) => e.id === r.id)), false)}>
            <Icon name="trash" size={16} className="text-text-muted" />
            {`Slet gemte · ${deletable.length}`}
          </button>
        );
      case "error":
        return (
          <div key={p} role="alert" className="flex flex-wrap items-center gap-x-3">
            <span className="font-sans text-13 text-text">Kunne ikke læse optagelserne på telefonen.</span>
            <button
              type="button"
              className={QUIET_BTN}
              onClick={() => {
                setLocal({ kind: "loading" });
                void load();
              }}
            >
              Prøv igen
            </button>
          </div>
        );
    }
  };

  return (
    <section aria-label="Optagelser" className="-mt-1 px-5 lg:col-start-1 lg:-mt-2">
      <div className="flex flex-wrap items-center gap-x-4">{parts.row1.map(part)}</div>
      {parts.row2.length > 0 && <div className="flex flex-wrap items-center gap-x-4">{parts.row2.map(part)}</div>}
      {parts.status === "line" && statusRow}
      {!autoOn && (
        <span id="auto-clip-off-line" className="sr-only">
          Slået fra. Klip med Start her og Slut her i afspilleren.
        </span>
      )}
      {overview !== null && <ClipSummary items={summaryItems(list, serverById, overview)} onClose={closeOverview} />}
      {sheet && (
        <ClipSheet count={list.length} onClose={requestCloseSheet} onPopped={closeSheet} playerOpen={open !== null} footer={parts.status === "sheet" ? statusRow : null}>
          {usedText !== null && quotaText !== null && entries !== null && (
            <p className="font-mono text-12 text-text-muted tabular-nums">
              {usedText} af {quotaText} · ældre end 8 uger slettes automatisk (
              <Icon name="star" size={16} className="inline size-3 align-[-1px]" />
              <span className="sr-only">stjernemarkerede</span> beholdes)
            </p>
          )}
          {list.length === 0 && local.kind === "ready" && <AutoClipSwitch on={autoOn} />}
          {list.length > 0 && !autoOn && <p className="mt-2 font-sans text-13 text-text-muted">Slået fra. Klip med Start her og Slut her i afspilleren.</p>}
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
          {canRecordHere === false && <p className="mt-2 font-sans text-13 text-text-muted">Denne browser kan ikke optage video.</p>}
          {local.kind === "loading" ? (
            slowLoad ? (
              <div aria-hidden="true" className="mt-3 flex flex-col gap-2">
                <div className="h-14 animate-pulse rounded-lg bg-track motion-reduce:animate-none" />
                <div className="h-14 animate-pulse rounded-lg bg-track motion-reduce:animate-none" />
              </div>
            ) : null
          ) : local.kind === "error" ? (
            <p className="mt-3 font-sans text-13 text-text-muted">Kunne ikke læse optagelserne på telefonen. Browserens lager svarede ikke.</p>
          ) : list.length === 0 ? (
            <p className="mt-3 font-sans text-14 text-text-muted">Tryk Optag på et arbejdssæt i Fokus. Videoen bliver på telefonen.</p>
          ) : (
            <ul className="mt-3">
              {shown.map((row) => (
                <ClipRow
                  key={row.id}
                  row={row}
                  word={row.kind === "clip" ? autoMetaWord(row.ext, serverById.get(row.id) ?? null, running?.id === row.id, inPickupWindow(row.recordedAt, new Date()), autoOn) : null}
                  onOpen={(el) => {
                    opener.current = el;
                    externalAfter.current = null;
                    setOpen(row);
                  }}
                  onStar={() => void toggleStar(row)}
                  onDelete={() => void remove(row)}
                />
              ))}
            </ul>
          )}
          {canRecord && (
            <Link href="/kamera" className={`mt-1 flex min-h-11 w-fit items-center font-sans text-13 text-text-muted underline-offset-4 hover:underline ${BTN}`}>
              Kameratest
            </Link>
          )}
        </ClipSheet>
      )}
      <p role="status" className="sr-only">
        {status}
      </p>
      {openRow !== null && open !== null && (
        <Player
          key={open.id}
          row={openRow}
          onTrim={(inS, outS) => runTrim(open.id, inS, outS)}
          onUndoTrim={() => runUndoTrim(open.id)}
          finished={open.id in finishedTrims ? (finishedTrims[open.id] ?? null) : undefined}
          files={files}
          fixture={fixture !== null}
          fileName={fileNames.get(open.id) ?? null}
          cut={cutOf(open)}
          server={serverById.get(open.id) ?? null}
          running={running?.id === open.id ? running : null}
          lift={lifts[open.id] ?? null}
          auto={autoOn}
          onAuto={(out) => {
            if (out.kind === "clipped" || out.kind === "low_confidence" || out.kind === "failed") {
              const auto = out.kind === "clipped" ? { autoStatus: out.kind, autoInS: out.inS, autoOutS: out.outS } : { autoStatus: out.kind, autoInS: null, autoOutS: null };
              setRows((rs) => rs?.map((x) => (x.id === open.id ? { ...x, ...auto } : x)) ?? rs);
            }
          }}
          onRange={(id, r) => setRows((rs) => rs?.map((x) => (x.id === id ? { ...x, clipInS: r.inS, clipOutS: r.outS } : x)) ?? rs)}
          onDownload={download}
          onMissing={() => void forgetMissing([open.id])}
          onClose={requestClose}
          onPopped={close}
          onStar={() => void toggleStar(open)}
          onSaved={() => void markSavedNow([open.id])}
          onDelete={async (allowStarred) => {
            // clip-at-set §3: from a ▶ outside the card, focus goes to the next ▶ in its row, else its exercise or session (read before the button goes).
            const external = externalAfter.current;
            const target = external === null ? null : external();
            const r = await startDeleteRows([openRow], true, allowStarred);
            if (r === "starred") return "starred"; // ★ set after the render: the player shows its confirm
            if (external !== null) focusAfter.current = null;
            opener.current = target;
            requestClose();
            return "started";
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
  word,
  onOpen,
  onStar,
  onDelete,
}: {
  readonly row: LibraryRow;
  /** clip-auto §2: the word after the duration (`klippet`, `auto-klippet`, `klip selv`, `venter på klip`, `klipper …`); null = none. */
  readonly word: string | null;
  readonly onOpen: (el: HTMLElement) => void;
  readonly onStar: () => void;
  readonly onDelete: () => void;
}) {
  const meta = (
    <MonoCaption uppercase={false} className="tabular-nums">
      {row.meta}
      {word !== null && ` ·\u00a0${word}`}{/* the dot wraps with its word (design-lead) */}
      {row.saved === true && " ·\u00a0gemt ✓"}
      {row.starUnsynced && <span className="text-11"> · ikke synkroniseret</span>}
    </MonoCaption>
  );
  const playable = row.kind === "clip" || row.kind === "afbrudt";
  return (
    <li className="flex min-h-14 items-center gap-3 border-t border-border">
      {playable ? (
        <button
          type="button"
          data-clip-play={row.id}
          aria-label={row.saved === true ? `${row.sr} Gemt eller delt fra appen.` : row.sr}
          className={`flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 text-left ${BTN}`}
          onClick={(e) => onOpen(e.currentTarget)}
        >
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

/** clip-auto-park: the switch's snapshot (this phone's localStorage). */
function readAutoClip(): boolean {
  return autoClipOn(browserStore());
}

/**
 * clip-auto-park: the parked automatic clip's switch, a native checkbox in a 44px label row, and
 * the muted line while it is off.
 */
function AutoClipSwitch({ on }: { readonly on: boolean }) {
  return (
    <div className="mt-2">
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
        <span className="font-sans text-15 text-text">Automatisk klip</span>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => setAutoClipOn(switchStore(), e.currentTarget.checked)}
          aria-describedby={on ? undefined : "auto-clip-off"}
          className="size-5 shrink-0 cursor-pointer accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
      </label>
      {!on && (
        <p id="auto-clip-off" className="font-sans text-13 text-text-muted">
          Slået fra. Klip med Start her og Slut her i afspilleren.
        </p>
      )}
    </div>
  );
}

/** clip-line §1: the switch on the line, labelled Auto-klip; while off, described by the sr-only sentence. */
function LineSwitch({ on }: { readonly on: boolean }) {
  return (
    <label className="flex min-h-11 min-w-11 cursor-pointer items-center gap-2 whitespace-nowrap font-sans text-13 text-text">
      Auto-klip
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => setAutoClipOn(switchStore(), e.currentTarget.checked)}
        aria-describedby={on ? undefined : "auto-clip-off-line"}
        className="size-5 shrink-0 cursor-pointer accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
    </label>
  );
}

/**
 * clip-line §2: Alle klip, full screen at 390 (a centred dialog at 1280), with its own history entry
 * like the player's. A player opened from it stacks on top; back closes the player first (its
 * popstate lands on the sheet's entry, so the sheet stays). Escape is the player's while it is open.
 */
function ClipSheet({
  count,
  onClose,
  onPopped,
  playerOpen,
  footer,
  children,
}: {
  readonly count: number;
  readonly onClose: () => void;
  readonly onPopped: () => void;
  readonly playerOpen: boolean;
  /** The status row (§3) while the sheet is open; null = none. */
  readonly footer: ReactNode;
  readonly children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement | null>(null);
  const playerOpenRef = useRef(playerOpen);
  useEffect(() => {
    playerOpenRef.current = playerOpen;
  });
  useEffect(() => {
    const title = document.getElementById("alle-klip-title");
    title?.setAttribute("tabindex", "-1");
    title?.focus();
    // Every tab's <main> (the shell mounts all three); only those it made inert are lifted.
    const mains = [...document.querySelectorAll("main")].filter((m) => !m.hasAttribute("inert"));
    for (const m of mains) m.setAttribute("inert", "");
    const onKey = (e: KeyboardEvent) => {
      if (playerOpenRef.current) return; // the player's Escape and Tab
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && dialog.current !== null) {
        const f = dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input");
        const first = f[0];
        const last = f[f.length - 1];
        if (first === undefined || last === undefined) return;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === title)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    if (sheetShouldPush(window.history.state)) window.history.pushState({ [SHEET_HISTORY_STATE]: true }, "");
    const onPop = () => {
      if (!sheetStaysOnPop(window.history.state)) onPopped();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    return () => {
      for (const m of mains) m.removeAttribute("inert");
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
    };
  }, [onClose, onPopped]);
  return createPortal(
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="alle-klip-title"
      className="clip-sheet fixed inset-0 z-[90] flex flex-col rounded-t-card bg-card text-text lg:inset-auto lg:top-1/2 lg:left-1/2 lg:max-h-[85vh] lg:w-full lg:max-w-140 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-card lg:border lg:border-border"
    >
      <div className="flex items-center gap-3 pt-2 pr-2 pl-5">
        <SectionTitle id="alle-klip-title">Alle klip</SectionTitle>
        <MonoCaption uppercase={false}>{clipCount(count)}</MonoCaption>
        <button type="button" aria-label="Luk" className={`ml-auto flex size-11 shrink-0 items-center justify-center rounded-full text-text ${BTN}`} onClick={onClose}>
          <Icon name="x" size={20} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
      {footer !== null && <div className="border-t border-border px-5 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">{footer}</div>}
    </div>,
    document.body,
  );
}

function Player({
  row,
  onTrim,
  onUndoTrim,
  finished,
  files,
  fixture,
  fileName,
  cut,
  server,
  running,
  lift,
  auto,
  onAuto,
  onRange,
  onDownload,
  onMissing,
  onClose,
  onPopped,
  onStar,
  onSaved,
  onDelete,
}: {
  readonly row: LibraryRow;
  /** clip-trim §2.3: Gem klip's cut (startTrim at the library); never throws. */
  readonly onTrim: (inS: number, outS: number) => Promise<StartTrimResult>;
  /** §3 Fortryd (undoTrim, local only). */
  readonly onUndoTrim: () => Promise<UndoTrimResult>;
  /** §3 at 0: the library's finish landed (the bytes freed, null = not measured); undefined = not finished. */
  readonly finished: number | null | "refused" | undefined;
  readonly files: ClipFiles | null;
  readonly fixture: boolean;
  /** Gem's (and Del's) file name; null without a local file. */
  readonly fileName: string | null;
  /** The clip's cut (clip-cut): Gem and Del hand it over; the line under the title shows it. */
  readonly cut: CutRange;
  /** The clip's row on the server (clip-handles: the editor needs its duration); null = none. */
  readonly server: VideoClipRow | null;
  /** clip-auto §2: this clip is being analysed on the phone (its frame %); null = not. */
  readonly running: Running | null;
  /** clip-debug: the lift's family and reps (null when the clip has none); Analysér igen's outcome. */
  readonly lift: ClipLiftMeta | null;
  /** clip-auto-park: the automatic clip's switch; off = no auto line, `Klip`, auto ranges ignored. */
  readonly auto: boolean;
  readonly onAuto: (out: AutoOutcome) => void;
  /** The user's range was stored (or removed): the row in memory follows the server's reply. */
  readonly onRange: (id: string, range: StoredRange) => void;
  readonly onDownload: (blob: Blob, name: string) => void;
  /** The file is gone (§10): the row turns fil mangler on close. */
  readonly onMissing: () => void;
  /** Luk and Escape (back over the player's entry when it is on top). */
  readonly onClose: () => void;
  /** The entry was popped (back gesture, or onClose's back): close without another back. */
  readonly onPopped: () => void;
  readonly onStar: () => void;
  /** clip-delete §2: Gem handed the file over, or a share resolved: `gemt ✓`. */
  readonly onSaved: () => void;
  /** Slet (allowStarred: Slet alligevel); "starred": refused, a ★ landed after the render. */
  readonly onDelete: (allowStarred: boolean) => Promise<"started" | "starred">;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [shareText, setShareText] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [saveText, setSaveText] = useState<string | null>(null);
  const [saveReading, setSaveReading] = useState(false);
  const [editing, setEditing] = useState(false);
  /** clip-handles §3 / clip-mark §2: the status line under the buttons, with its Fortryd or Prøv igen. */
  const [rangeText, setRangeText] = useState<RangeText | null>(null);
  /** clip-trim §2: the pending points (an old stored range opens as them, §5), and whether they still are that range. */
  const [points, setPoints] = useState<Points>(() => storedPoints(server));
  const [fromStored, setFromStored] = useState(() => storedPoints(server).inS !== null);
  const [trim, setTrim] = useState<TrimState>({ kind: "idle" });
  /** §3: the polite announcement, once per cut, Fortryd and failure (the countdown is not live). */
  const [announce, setAnnounce] = useState("");
  const lastCut = useRef<Points>(NO_POINTS);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const markBusy = trim.kind === "cutting";
  const pending = points.inS;
  const cutBtn = useRef<HTMLButtonElement>(null);
  const startBtn = useRef<HTMLButtonElement>(null);
  const endBtn = useRef<HTMLButtonElement>(null);
  const statusRow = useRef<HTMLDivElement>(null);
  const videoEl = useRef<HTMLVideoElement>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  const gone = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const keepBtn = useRef<HTMLButtonElement>(null);
  /** clip-debug: the hidden panel (long-press on the title, or Shift+D). */
  const [debug, setDebug] = useState(false);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endPress = () => {
    if (press.current !== null) clearTimeout(press.current);
    press.current = null;
  };
  useEffect(() => endPress, []);

  // §3: Fortryd's count, once a second; cleared on close, unmount, back (the player unmounts) and while hidden.
  const doneDeadline = trim.kind === "done" ? trim.deadline : null;
  useEffect(() => {
    if (doneDeadline === null) return;
    let h: number | null = null;
    const tick = () => setNowMs(Date.now());
    const arm = () => {
      if (h !== null) window.clearInterval(h);
      h = document.visibilityState === "hidden" ? null : window.setInterval(tick, 1000);
      if (h !== null) tick();
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      if (h !== null) window.clearInterval(h);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [doneDeadline]);
  /** The flow as shown: a done cut whose finish landed is finished (Fortryd went). */
  const view: TrimState =
    trim.kind === "done" && finished !== undefined ? trimStep(trim, finished === "refused" ? { kind: "refused" } : { kind: "finished", freed: finished }) : trim;
  const left = view.kind === "done" ? secondsLeft(view.deadline, nowMs) : 0;

  useEffect(() => {
    let made: string | null = null;
    let live = true;
    if (!fixture && files !== null && row.file !== null) {
      void files.readFile(row.file).then((b) => {
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
  }, [files, fixture, row.file]);

  useEffect(() => {
    closeBtn.current?.focus();
    // Every tab's <main> (the shell mounts all three; clip-at-set opens the Player from Belastning too); only those it made inert are lifted.
    const mains = [...document.querySelectorAll("main")].filter((m) => !m.hasAttribute("inert"));
    for (const m of mains) m.setAttribute("inert", "");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (isDebugToggle(e, e.target instanceof HTMLElement ? e.target : null)) setDebug((d) => !d);
      if (e.key === "Tab" && dialog.current !== null) {
        const f = dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), video[controls], [role=slider]");
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
    if (playerShouldPush(window.history.state)) window.history.pushState({ [PLAYER_HISTORY_STATE]: true }, "");
    const onPop = () => onPopped();
    window.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    return () => {
      for (const m of mains) m.removeAttribute("inert");
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
    };
  }, [onClose, onPopped]);

  useEffect(() => {
    if (confirm) keepBtn.current?.focus();
  }, [confirm]);

  const canShare =
    !fixture && typeof navigator !== "undefined" && typeof navigator.canShare === "function" && row.ext !== null;

  async function share() {
    if (blob === null || row.ext === null) return;
    setPreparing(true);
    setShareText(busyText(cut)); // §7: announced in the status line, then replaced by the outcome
    const name = fileName ?? clipFileNames([row]).get(row.id) ?? `${row.date} sæt ${row.set}.${row.ext}`;
    const p = await prepareClip(blob, name, cut, cutClip); // clip-cut: Del uses Gem's name
    const outcome = await shareClip(navigator, shareData(p.blob, p.name, row.ext));
    setPreparing(false);
    if (shareMarksSaved(outcome)) onSaved();
    setShareText(
      outcome === "failed"
        ? "Kunne ikke dele videoen. Prøv igen."
        : outcome === "unsupported"
          ? "Deling af video virker ikke i denne browser."
          : outcome === "shared"
            ? shareCutLine(p)
            : null,
    );
  }

  // §10: a file found gone turns the row fil mangler when the player closes.
  const missing = useRef(onMissing);
  useEffect(() => {
    missing.current = onMissing;
  }, [onMissing]);
  useEffect(() => () => {
    if (gone.current) missing.current();
  }, []);

  /** clip-auto §2: the player's line when there is no cut to show (running, waiting, low_confidence, failed); waiting needs a server row. */
  const autoLine = cut.range === null && cut.reason !== "webm" && (server !== null || running !== null) ? playerAutoLine(server?.autoStatus ?? null, running, inPickupWindow(row.recordedAt, new Date()), auto) : null;

  /** clip-handles §1: Klip / Ret klip on an MP4 clip with a server row; never WebM, afbrudt or missing. */
  const canEdit = row.kind === "clip" && row.ext === "mp4" && server !== null;

  function closeEditor() {
    setEditing(false);
    setTimeout(() => editBtn.current?.focus(), 0); // back on Klip / Ret klip once the row is back
  }

  /** §3: Fjern klip's Fortryd writes the old range back (until the player closes). */
  async function undoRemove(old: ClipRangeS) {
    const r = await sendClipRange(row.id, old);
    if (r.ok && r.inS !== null && r.outS !== null) {
      onRange(row.id, { inS: r.inS, outS: r.outS });
      setRangeText({ text: "Klip gemt.", warn: false, action: null });
    } else {
      setRangeText({ text: rangeErrorLine(r.ok ? "failed" : r.reason), warn: true, action: { kind: "undo-remove", old } });
    }
  }

  /** clip-mark: the playhead at tap time; the fixture (no video) reads §4's fixture playhead. */
  function playhead(): number {
    if (fixture) return fixturePlayhead(row.id, pending !== null);
    return videoEl.current?.currentTime ?? Number.NaN;
  }

  /** §2.1 Start her: a pending in point; no write, the video keeps playing. An out under 1,0 s after it is cleared. */
  function markStart() {
    if (markBusy || server === null || view.kind === "done") return; // inert during the cut's Fortryd window
    const t = playhead();
    if (!Number.isFinite(t)) return;
    const next = startAt(points, markPoint(t, server.durationS));
    setPoints(next.points);
    setFromStored(false);
    const inS = next.points.inS ?? 0;
    setRangeText((old) => ({ text: next.cleared ? OUT_CLEARED_LINE : startLine(inS), warn: false, action: keptUndo(old) }));
  }

  /** §2.2 Slut her: only a pending out point (in = the pending Start, else 0); it writes nothing. Refused: the ◆ line, nothing set. */
  function markEnd() {
    if (markBusy || server === null || view.kind === "done") return;
    const t = playhead();
    if (!Number.isFinite(t)) return;
    const m = endAt(points, t, server.durationS);
    if (m.kind === "refused") {
      setRangeText((old) => ({ text: refusedLine(m.inS), warn: true, action: keptUndo(old) }));
      return;
    }
    setPoints(m.points);
    setFromStored(false);
    setRangeText((old) => (old?.action != null ? { ...old, text: "", warn: false } : null)); // Start's line is spent; Fjern klip's Fortryd stays
  }

  /** The cut's outcome (the player's Gem klip or the editor's). */
  function cutDone(r: Extract<StartTrimResult, { kind: "done" }>) {
    setTrim({ kind: "done", fromS: r.fromS, toS: r.toS, deadline: r.deadline });
    setNowMs(Date.now());
    setPoints(NO_POINTS);
    setFromStored(false);
    setRangeText(null);
    setAnnounce(doneAnnouncement(r.toS));
  }

  /** §2.3 Gem klip: Klipper … at once, marks disabled, the video paused; then done or failed (the points stay). */
  async function cutNow() {
    if (markBusy || server === null) return;
    const c = cutPoints(points, server.durationS);
    if (c === null) return;
    videoEl.current?.pause();
    lastCut.current = { inS: c.inS, outS: c.outS };
    setTrim((st) => trimStep(st, { kind: "cut", inS: c.inS, outS: c.outS }));
    const r = await onTrim(c.inS, c.outS);
    if (r.kind === "done") {
      cutDone(r);
      setTimeout(() => endBtn.current?.focus(), 0); // Gem klip is gone; focus never lands on Fortryd (§7.12)
      return;
    }
    setTrim((st) => trimStep(st, { kind: "result", result: r }));
    setRangeText((old) => (old?.action != null ? { ...old, text: "", warn: false } : null));
    setAnnounce(failedLine(r.space));
  }

  /** §3 Fortryd: the original is the clip again; the points come back pending; focus → Gem klip. */
  async function undoCut() {
    const r = await onUndoTrim();
    if (r.kind !== "undone") return; // expired: the finish comes; failed: the window runs on
    setTrim((st) => trimStep(st, { kind: "undone", fromS: r.durationS }));
    setPoints(lastCut.current);
    setAnnounce(trimUndoneLine(r.durationS));
    setTimeout(() => cutBtn.current?.focus(), 0);
  }

  function runAction(a: RangeAction) {
    if (markBusy) return;
    void undoRemove(a.old);
  }

  /** Gem (§1): the blob the player loaded (as Del), else one read; fixture: no file, no URL. */
  async function save() {
    if (fileName === null || row.ext === null) return;
    if (fixture) {
      const shown: Prepared =
        cut.range === null
          ? { kind: "whole", blob: new Blob([]), name: fileName }
          : { kind: "cut", blob: new Blob([]), name: cutFileName(fileName), actual: { startS: cut.range.inS, endS: cut.range.outS } };
      setSaveText(`Testvisning: ${saveDoneLine(shown)}`);
      onSaved();
      return;
    }
    setSaveReading(true); // from the tap until the file is handed over (§7)
    setSaveText(busyText(cut)); // §7: announced in the status line, then replaced by the outcome
    let b: Blob | null = blob;
    if (b === null) {
      if (files === null) {
        setSaveReading(false);
        setSaveText(null);
        return;
      }
      try {
        b = row.file === null ? null : await files.readFile(row.file);
      } catch {
        setSaveReading(false);
        setSaveText("Videoen kunne ikke læses på telefonen.");
        return;
      }
    }
    if (b === null) {
      setSaveReading(false);
      gone.current = true;
      setSaveText("Videoen findes ikke længere på telefonen.");
      return;
    }
    const p = await prepareClip(b, fileName, cut, cutClip); // a failed cut gives the original, whole (§4)
    onDownload(p.blob, p.name);
    onSaved();
    setSaveReading(false);
    setSaveText(saveDoneLine(p));
  }

  return createPortal(
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={`${shownName(row)}, sæt ${row.set}`} style={{ backgroundColor: "#000" }} className="fixed inset-0 z-[100] flex flex-col text-text">
      <div className="flex items-center gap-2 p-2">
        <button ref={closeBtn} type="button" aria-label="Luk" className={`flex size-11 items-center justify-center rounded-full ${BTN}`} onClick={onClose}>
          <Icon name="x" size={20} />
        </button>
        <div
          className="flex min-w-0 select-none flex-col [-webkit-touch-callout:none]"
          onPointerDown={() => {
            endPress();
            press.current = setTimeout(() => setDebug(true), 600);
          }}
          onPointerUp={endPress}
          onPointerLeave={endPress}
          onPointerCancel={endPress}
          onContextMenu={(e) => e.preventDefault()}
        >
          <NameStack row={row} />
          <MonoCaption uppercase={false}>
            {row.meta}
            {row.saved === true && (
              <>
                <span aria-hidden="true"> ·&nbsp;gemt ✓</span>
                <span className="sr-only">, gemt eller delt fra appen</span>
              </>
            )}
          </MonoCaption>
        </div>
      </div>
      {(points.inS !== null || points.outS !== null) && !editing ? (
        <p className="flex flex-wrap items-center gap-x-3 pl-[60px] pr-3 font-mono text-13 text-text-muted">
          <span>
            {points.outS === null
              ? pendingLine(points.inS ?? 0)
              : fromStored
                ? storedLine(points.inS ?? 0, points.outS)
                : pointsLine(points.inS ?? 0, points.outS)}
          </span>
          <button
            type="button"
            aria-disabled={markBusy || undefined}
            className={`${TEXT_LINK} font-sans aria-disabled:opacity-60`}
            onClick={() => {
              if (markBusy) return; // Klipper … owns the line
              setPoints(NO_POINTS); // Ryd clears both points (clip-trim §2.2)
              setFromStored(false);
              setRangeText((old) =>
                old === null || old.warn ? old : old.action === null ? null : { text: START_CLEARED_LINE, warn: false, action: old.action },
              );
              startBtn.current?.focus();
            }}
          >
            Ryd
          </button>
        </p>
      ) : (
        cutLine(cut) !== null && <p className="pl-[60px] pr-3 font-mono text-13 text-text-muted">{cutLine(cut)}</p>
      )}
      {autoLine !== null && pending === null && points.outS === null && (
        <p className="pl-[60px] pr-3 font-sans text-13 text-text-muted">
          {autoLine.words}
          {autoLine.figure !== null && (
            <span aria-hidden="true" className="font-mono tabular-nums">
              {" "}
              {autoLine.figure}
            </span>
          )}
        </p>
      )}
      {debug && (
        <ClipDebug
          clipId={row.id}
          label={`${shownName(row)}, sæt ${row.set}`}
          blob={fixture ? null : blob}
          status={server?.autoStatus ?? null}
          durationS={server?.durationS ?? null}
          lift={row.ext === "mp4" ? lift : null}
          pickupBusy={running !== null}
          onAuto={onAuto}
          onClose={() => setDebug(false)}
        />
      )}
      <div className="flex min-h-0 flex-1 items-center justify-center p-2">
        {fixture || (url === null && files === null) ? (
          <div className="flex aspect-[9/16] max-h-full w-full max-w-xs items-center justify-center rounded-card bg-track">
            <MonoCaption uppercase={false}>Testvisning: ingen video</MonoCaption>
          </div>
        ) : url === null ? null : (
          <video ref={videoEl} src={url} controls={!editing} playsInline muted className="max-h-full max-w-full object-contain" />
        )}
      </div>
      <div className="flex flex-col gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {editing && server !== null ? (
          <ClipEditor
            clip={server}
            auto={auto}
            video={videoEl}
            onCancel={closeEditor}
            onCut={(r) => onTrim(r.inS, r.outS)}
            onCutDone={(r) => {
              cutDone(r);
              closeEditor();
            }}
            onRemoved={(old) => {
              onRange(row.id, { inS: null, outS: null });
              setRangeText({ text: "Dit klip er fjernet.", warn: false, action: { kind: "undo-remove", old } });
              closeEditor();
            }}
          />
        ) : confirm ? (
          <>
            <p className="font-sans text-14 text-text">Denne video er markeret Behold altid. Slet den alligevel?</p>
            <div className="flex gap-2">
              <button type="button" className={DARK_BTN} onClick={() => void onDelete(true)}>
                Slet alligevel
              </button>
              <button ref={keepBtn} type="button" className={`min-h-11 px-3 font-sans text-14 text-text underline-offset-4 hover:underline ${BTN}`} onClick={() => setConfirm(false)}>
                Behold
              </button>
            </div>
          </>
        ) : (
          <>
            {canEdit && (
              <div className="flex gap-2">
                <button
                  ref={startBtn}
                  type="button"
                  aria-disabled={markBusy || view.kind === "done" || undefined}
                  className={`${MARK_BTN} ${pending === null ? "bg-track" : "bg-raised"}`}
                  onClick={markStart}
                >
                  <span aria-hidden="true" className="font-mono">
                    [
                  </span>
                  {pending === null ? (
                    <span>{startLabel(null)}</span>
                  ) : (
                    <span className="tabular-nums">
                      Start <span className="normal-case">{formatSeconds(pending)}</span>
                    </span>
                  )}
                </button>
                <button ref={endBtn} type="button" aria-disabled={markBusy || view.kind === "done" || undefined} className={`${MARK_BTN} ${points.outS === null ? "bg-track" : "bg-raised"}`} onClick={markEnd}>
                  {points.outS === null ? (
                    <span>Slut her</span>
                  ) : (
                    <span className="tabular-nums">
                      Slut <span className="normal-case">{formatSeconds(points.outS)}</span>
                    </span>
                  )}
                  <span aria-hidden="true" className="font-mono">
                    ]
                  </span>
                </button>
              </div>
            )}
            {canEdit && server !== null && (markBusy || (cutPoints(points, server.durationS) !== null && view.kind !== "done")) && (
              <button ref={cutBtn} type="button" aria-disabled={markBusy || undefined} className={CUT_BTN} onClick={() => void cutNow()}>
                {markBusy ? CUTTING_LINE : GEM_KLIP}
              </button>
            )}
            <div className="flex flex-wrap gap-2">
              {row.kind === "clip" && (
                <button type="button" aria-pressed={row.starred} className={DARK_BTN} onClick={onStar}>
                  <Icon name="star" size={18} filled={row.starred} />
                  {row.starred ? "Beholdes" : "Behold altid"}
                </button>
              )}
              {canShare && (
                <button type="button" className={`${DARK_BTN} ${BUSY_WIDTH}`} disabled={blob === null || preparing} onClick={() => void share()}>
                  <Icon name="share" size={18} />
                  {preparing ? busyText(cut) : "Del"}
                </button>
              )}
              {fileName !== null && (
                <button type="button" className={`${DARK_BTN} ${BUSY_WIDTH}`} disabled={saveReading} onClick={() => void save()}>
                  <Icon name="download" size={18} />
                  {saveReading ? busyText(cut) : "Gem"}
                </button>
              )}
              {canEdit && (
                <button
                  ref={editBtn}
                  type="button"
                  className={DARK_BTN}
                  onClick={() => {
                    setRangeText(null);
                    setPoints(NO_POINTS); // clip-mark §1: opening the editor clears the pending points
                    setFromStored(false);
                    setEditing(true);
                  }}
                >
                  <Icon name="scissors" size={18} />
                  {server === null ? "Klip" : editLabel(server, auto)}
                </button>
              )}
              <button type="button" data-clip-delete="" className={DARK_BTN} onClick={() => (row.starred ? setConfirm(true) : void onDelete(false).then((r) => r === "starred" && setConfirm(true)))}>
                <Icon name="trash" size={18} />
                Slet
              </button>
            </div>
            {!canShare && <p className="font-sans text-13 text-text-muted">Deling af video virker ikke i denne browser.</p>}
            {shareText !== null && <p role="status" className="font-sans text-13 text-text-muted">{shareText}</p>}
            <p role="status" className="font-sans text-13 text-text-muted">
              {saveText}
            </p>
            {view.kind !== "idle" && view.kind !== "cutting" && (
              <p className="flex flex-wrap items-center gap-x-3 font-sans text-13 text-text-muted">
                {view.kind === "done" && (
                  <>
                    <span className="tabular-nums">
                      {doneLine(view.toS, view.fromS)}
                      {left > 0 ? " ·" : "."}
                    </span>
                    {left > 0 && (
                      <button type="button" className={`${DARK_BTN} min-h-11`} onClick={() => void undoCut()}>
                        Fortryd <span className="font-mono tabular-nums">{left}</span>
                      </button>
                    )}
                  </>
                )}
                {view.kind === "finished" && <span className="tabular-nums">{finishedLine(view.toS, view.freed)}</span>}
                {view.kind === "undone" && <span className="tabular-nums">{trimUndoneLine(view.fromS)}</span>}
                {view.kind === "refused" && (
                  <span role="status">
                    <span aria-hidden="true" className="text-warning">
                      ◆{" "}
                    </span>
                    {REFUSED_LINE}
                  </span>
                )}
                {view.kind === "failed" && (
                  <>
                    <span>
                      <span aria-hidden="true" className="text-warning">
                        ◆{" "}
                      </span>
                      {failedLine(view.space)}
                    </span>
                    <button type="button" className={`min-h-11 text-text underline underline-offset-4 ${BTN}`} onClick={() => void cutNow()}>
                      Prøv igen
                    </button>
                  </>
                )}
              </p>
            )}
            <p role="status" className="sr-only">
              {announce}
            </p>
            <div ref={statusRow} role="status" className="font-sans text-13 text-text-muted">
              {rangeText !== null && (
                <span className="flex flex-wrap items-center gap-x-3">
                  <span>
                    {rangeText.warn && (
                      <span aria-hidden="true" className="text-warning">
                        ◆{" "}
                      </span>
                    )}
                    {rangeText.text}
                  </span>
                  {rangeText.action !== null && (
                    <button
                      key="fortryd"
                      type="button"
                      aria-disabled={markBusy || undefined}
                      className={`min-h-11 text-text underline underline-offset-4 aria-disabled:opacity-60 ${BTN}`}
                      onClick={() => {
                        if (rangeText.action !== null) runAction(rangeText.action);
                      }}
                    >
                      Fortryd
                    </button>
                  )}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
