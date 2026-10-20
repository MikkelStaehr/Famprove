"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";

import { deleteClip, saveClip, starClip, trimClip } from "@/app/actions";
import { finishDueTrims } from "@/lib/video/trim";
import { Icon } from "@/components/icons";
import { MonoCaption } from "@/components/MonoCaption";
import { SectionTitle } from "@/components/SectionTitle";
import { WarningLine } from "@/components/WarningLine";
import type { IsoDate } from "@/lib/db/rows";
import { type DeleteClipResult, PERMANENT_SAVE_REFUSALS, type VideoClipRow } from "@/lib/video/clips";
import { cleanupPlan } from "@/lib/video/cleanup";
import { type ClipIndex, type ClipIndexEntry, clipFile, clipFiles, memoryClipIndex } from "@/lib/video/index-store";
import { indexedDbClipIndex } from "@/lib/video/index-store-browser";
import { FIXTURE_CLIP_BYTES, fixturePlayhead } from "@/lib/video/library-fixture";
import {
  cleanupDue,
  cleanupLine,
  type ClipNames,
  type RunSets,
  clipCount,
  FIRST_ROWS,
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
  doneLine,
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
import { markPoint, markRange, pendingLine, refusedLine, SAVING_LINE, savedLine, START_CLEARED_LINE, startLabel, startLine, UNDO_FAILED_LINE, undoInput, undoneLine } from "@/lib/video/clip-mark";
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
import { isDebugToggle } from "@/lib/video/debug-log";
import { browserAutoDeps } from "@/lib/video/auto-run-browser";

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
const MARK_BTN = `inline-flex min-h-14 flex-1 items-center justify-center gap-1 rounded-full px-4 font-sans text-button text-text aria-disabled:opacity-60 ${BTN}`;
const TEXT_LINK = `inline-flex min-h-11 items-center text-text underline underline-offset-4 ${BTN}`;

/** The status line's button: Fjern klip's and a mark's Fortryd, or a failed write's Prøv igen (never focused by a tap, §3). */
type RangeAction =
  | { readonly kind: "undo-remove"; readonly old: ClipRangeS }
  | { readonly kind: "undo-mark"; readonly prev: StoredRange }
  | { readonly kind: "retry-mark"; readonly range: ClipRangeS; readonly prev: StoredRange }
  | { readonly kind: "retry-undo"; readonly prev: StoredRange };
type RangeText = { readonly text: string; readonly warn: boolean; readonly action: RangeAction | null };
/** A mark's Fortryd stays until the player closes or the next mark saves (§2.3). */
const keptUndo = (t: RangeText | null): RangeAction | null => (t?.action?.kind === "undo-mark" ? t.action : null);

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

/** The Optagelser card on Træning (design/specs/video-library.md). */
export function ClipLibrary({ today, rows: initialRows, names, runSets, canRecord, fixture, lifts = NO_LIFTS }: Props) {
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
  const keeper = useRef<UrlKeeper | null>(null);
  const stop = useRef(false);
  const [saving, setSaving] = useState<{ k: number; total: number } | null>(null);
  const [saveLine, setSaveLine] = useState("");
  const [rest, setRest] = useState<readonly SaveClip[]>([]);
  const [running, setRunning] = useState<Running | null>(null);
  const pickupStarted = useRef(false);
  /** clip-summary: the hidden overview, with this phone's last outcomes read when it opened; null = closed. */
  const [overview, setOverview] = useState<Readonly<Record<string, AutoLast>> | null>(null);
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
    if (open !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isDebugToggle(e, e.target instanceof HTMLElement ? e.target : null)) return;
      if (!overviewOpen) setOverview(readAutoLast(browserStore()));
      else if (isSummaryEntry(window.history.state)) window.history.back();
      else setOverview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, overviewOpen]);

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
      await finishDueTrims({ index: s.index, files: s.files, trim: trimClip }, new Date()); // clip-trim §3: originals past their deadline
      let entries = await s.index.all();
      // Retries: unsynced clips (video-record §8) and unconfirmed stars (§6), then the daily cleanup.
      for (const e of unsyncedClips(entries)) {
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
        for (const e of plan.deleteLocal) {
          for (const f of clipFiles(e)) await s.files.removeFile(f);
          await s.index.remove(e.id);
          await tryDeleteClip(e.id); // a failed row is tomorrow's deleteServerOnly; the cleanup goes on
        }
        for (const id of plan.deleteServerOnly) await tryDeleteClip(id);
        const gone = new Set([...plan.deleteLocal.map((e) => e.id), ...plan.deleteServerOnly]);
        setRows(initialRows.filter((r) => !gone.has(r.id)));
        setCleaned(plan.deleteLocal.length);
        window.localStorage.setItem(CLEANUP_KEY, today);
      }
      entries = await s.index.all();
      setLocal({ kind: "ready", entries });
      const sz: Record<string, number | null> = {};
      for (const e of entries) sz[e.id] = (await s.files.readFile(clipFile(e)))?.size ?? null;
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
        recordRun(browserStore(), r.id, out, Date.now());
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
  const list = local.kind === "ready" || local.kind === "none" ? libraryRows(entries, rows, names, runSets) : [];

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

  /** One clip to Downloads (the player's Gem, §1). Fixture: no file, no URL. */
  function download(blob: Blob, name: string) {
    if (fixture !== null || keeper.current === null) return;
    browserDownload(keeper.current)(blob, name);
  }

  /** A clip whose file is gone (§10): its index entry goes, so the row turns fil mangler. Fixture: nothing written. */
  async function forgetMissing(ids: readonly string[]) {
    const s = store.current;
    if (fixture !== null || s === null || ids.length === 0) return;
    for (const id of ids) await s.index.remove(id);
    setLocal({ kind: "ready", entries: await s.index.all() });
  }

  async function saveAll(clips: readonly SaveClip[]) {
    if (clips.length === 0 || saving !== null) return;
    stop.current = false;
    const s = store.current;
    const byId = new Map(list.map((r) => [r.id, r]));
    let cutCount = 0;
    let failedCuts = 0;
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
        const r = byId.get(clip.id);
        const cut = r === undefined ? ({ reason: "none", range: null } as const) : cutOf(r);
        if (fixture !== null) return { blob, name: cut.range === null ? clip.name : cutFileName(clip.name), cut: cut.range !== null };
        const p = await prepareClip(blob, clip.name, cut, cutClip);
        if (p.kind === "failed") failedCuts += 1;
        return { blob: p.blob, name: p.name, cut: p.kind === "cut" };
      },
      onSent: (cut) => {
        if (cut) cutCount += 1;
      },
    });
    setSaving(null);
    setRest(result.remaining);
    const failedLine = failedCutsLine(failedCuts);
    setSaveLine(`${testPrefix}${doneLine(result, splitCount(result.sent, cutCount))}${failedLine === null ? "" : ` ${failedLine}`}`);
    await forgetMissing(result.missing.map((c) => c.id));
  }

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
    setOpen(null);
    setTimeout(() => el?.focus(), 0); // after the Player's cleanup lifts inert from <main>
  }, []);

  /** Luk and Escape: back over our history entry when it is on top; its popstate then closes (§10). */
  const requestClose = useCallback(() => {
    if (playerCloseVia(window.history.state) === "back") window.history.back();
    else close();
  }, [close]);

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
        <div
          className="select-none [-webkit-touch-callout:none]"
          onPointerDown={() => {
            endTitlePress();
            titlePress.current = setTimeout(() => setOverview(readAutoLast(browserStore())), 600);
          }}
          onPointerUp={endTitlePress}
          onPointerLeave={endTitlePress}
          onPointerCancel={endTitlePress}
          onContextMenu={(e) => e.preventDefault()}
        >
          <SectionTitle id="optagelser-title">Optagelser</SectionTitle>
        </div>
        {list.length > 0 && <MonoCaption uppercase={false}>{clipCount(list.length)}</MonoCaption>}
      </div>
      {usedText !== null && quotaText !== null && entries !== null && (
        <p className="mt-1 font-mono text-12 text-text-muted tabular-nums">
          {usedText} af {quotaText} · ældre end 8 uger slettes automatisk (
          <Icon name="star" size={16} className="inline size-3 align-[-1px]" />
          <span className="sr-only">stjernemarkerede</span> beholdes)
        </p>
      )}
      <AutoClipSwitch on={autoOn} />
      {overview !== null && <ClipSummary items={summaryItems(list, serverById, overview)} onClose={closeOverview} />}
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
      {entries !== null && (today_.length > 0 || rest.length > 0) && (
        <div className="mt-3 flex flex-col gap-1">
          <button
            type="button"
            className={`${DARK_BTN} self-start disabled:opacity-60`}
            disabled={saving !== null}
            onClick={() =>
              void saveAll(
                rest.length > 0 ? rest : today_.map((r) => ({ id: r.id, name: fileNames.get(r.id) ?? `${r.id}.${r.ext}`, label: clipLabel(r) })),
              )
            }
          >
            <Icon name="download" size={18} />
            {saving !== null ? progressLine(saving.k, saving.total) : rest.length > 0 ? `Gem resten · ${rest.length}` : `Gem alle fra i dag · ${today_.length}`}
          </button>
          <p role="status" className="font-sans text-13 text-text-muted">
            {saveLine}
          </p>
        </div>
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
              word={row.kind === "clip" ? autoMetaWord(row.ext, serverById.get(row.id) ?? null, running?.id === row.id, inPickupWindow(row.recordedAt, new Date()), autoOn) : null}
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
      {canRecord && (
        <Link href="/kamera" className={`mt-1 flex min-h-11 w-fit items-center font-sans text-13 text-text-muted underline-offset-4 hover:underline ${BTN}`}>
          Kameratest
        </Link>
      )}
      <p role="status" className="sr-only">
        {status}
      </p>
      {open !== null && (
        <Player
          key={open.id}
          row={open}
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
          onDelete={() => {
            void remove(open);
            opener.current = null;
            requestClose();
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

function Player({
  row,
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
  onDelete,
}: {
  readonly row: LibraryRow;
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
  readonly onDelete: () => void;
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
  /** clip-mark: the pending Start (s), and a mark's or its Fortryd's write in flight. */
  const [pending, setPending] = useState<number | null>(null);
  const [markBusy, setMarkBusy] = useState(false);
  const startBtn = useRef<HTMLButtonElement>(null);
  const endBtn = useRef<HTMLButtonElement>(null);
  const statusRow = useRef<HTMLDivElement>(null);
  /** Focus lost or about to be: on body, or on the status row's Prøv igen / Fortryd, which unmounts after this tap (review 2026-10-20). */
  const focusOffRow = () => {
    const a = document.activeElement;
    return a === null || a === document.body || (statusRow.current?.contains(a) ?? false);
  };
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
    const main = document.querySelector("main");
    main?.setAttribute("inert", "");
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
      main?.removeAttribute("inert");
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

  /** §2.1 Start her: a pending in point; no write, the video keeps playing. */
  function markStart() {
    if (markBusy || server === null) return;
    const t = playhead();
    if (!Number.isFinite(t)) return;
    const inS = markPoint(t, server.durationS);
    setPending(inS);
    setRangeText((old) => ({ text: startLine(inS), warn: false, action: keptUndo(old) }));
  }

  /** §2.2 Slut her: one setClipRange by the in rule, or the refused line and no write. */
  function markEnd() {
    if (markBusy || server === null) return;
    const t = playhead();
    if (!Number.isFinite(t)) return;
    const m = markRange(server, pending, t, auto);
    if (m.kind === "refused") {
      setRangeText((old) => ({ text: refusedLine(m.inS), warn: true, action: keptUndo(old) }));
      return;
    }
    void sendMark(m.range, undoInput(server));
  }

  /** A mark's write (and Prøv igen's, with the same values). */
  async function sendMark(range: ClipRangeS, prev: StoredRange) {
    setMarkBusy(true);
    setRangeText((old) => ({ text: SAVING_LINE, warn: false, action: old?.action?.kind === "retry-mark" ? old.action : null }));
    const r = await sendClipRange(row.id, range);
    setMarkBusy(false);
    setPending(null); // saved: the new range shows; failed: the old cut line keeps (§2.2)
    if (r.ok) {
      const stored: StoredRange = r.inS === null || r.outS === null ? { inS: null, outS: null } : { inS: r.inS, outS: r.outS };
      onRange(row.id, stored);
      setRangeText({ text: stored.inS === null ? "Klip gemt." : savedLine(stored), warn: false, action: { kind: "undo-mark", prev } });
      if (focusOffRow()) endBtn.current?.focus(); // Prøv igen is gone
      return;
    }
    const retry = r.reason === "failed" || r.reason === "network";
    setRangeText({ text: rangeErrorLine(r.reason), warn: true, action: retry ? { kind: "retry-mark", range, prev } : null });
  }

  /** §2.3 Fortryd: one setClipRange back to the range stored before the mark (null/null when none). */
  async function undoMark(prev: StoredRange) {
    setMarkBusy(true);
    setRangeText((old) => ({ text: SAVING_LINE, warn: false, action: old?.action?.kind === "retry-undo" ? old.action : null }));
    const r = await sendClipRange(row.id, prev);
    setMarkBusy(false);
    if (r.ok) {
      onRange(row.id, prev);
      setRangeText({ text: undoneLine(prev), warn: false, action: null });
      if (focusOffRow()) endBtn.current?.focus();
      return;
    }
    setRangeText({ text: UNDO_FAILED_LINE, warn: true, action: { kind: "retry-undo", prev } });
  }

  function runAction(a: RangeAction) {
    if (markBusy) return;
    if (a.kind === "undo-remove") void undoRemove(a.old);
    else if (a.kind === "undo-mark") {
      endBtn.current?.focus(); // Fortryd goes; focus never stays on it (§3)
      void undoMark(a.prev);
    } else if (a.kind === "retry-mark") void sendMark(a.range, a.prev);
    else void undoMark(a.prev);
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
          <MonoCaption uppercase={false}>{row.meta}</MonoCaption>
        </div>
      </div>
      {pending !== null && !editing ? (
        <p className="flex flex-wrap items-center gap-x-3 pl-[60px] pr-3 font-mono text-13 text-text-muted">
          <span>{pendingLine(pending)}</span>
          <button
            type="button"
            aria-disabled={markBusy || undefined}
            className={`${TEXT_LINK} font-sans aria-disabled:opacity-60`}
            onClick={() => {
              if (markBusy) return; // Gemmer … owns the line
              setPending(null);
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
      {autoLine !== null && pending === null && (
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
            onSaved={(r) => {
              onRange(row.id, r);
              setRangeText({ text: "Klip gemt.", warn: false, action: null });
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
            {canEdit && (
              <div className="flex gap-2">
                <button
                  ref={startBtn}
                  type="button"
                  aria-disabled={markBusy || undefined}
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
                <button ref={endBtn} type="button" aria-disabled={markBusy || undefined} className={`${MARK_BTN} bg-track`} onClick={markEnd}>
                  {markBusy ? (
                    SAVING_LINE
                  ) : (
                    <>
                      <span>Slut her</span>
                      <span aria-hidden="true" className="font-mono">
                        ]
                      </span>
                    </>
                  )}
                </button>
              </div>
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
                    setPending(null); // clip-mark §1: opening the editor clears a pending Start
                    setEditing(true);
                  }}
                >
                  <Icon name="scissors" size={18} />
                  {server === null ? "Klip" : editLabel(server, auto)}
                </button>
              )}
              <button type="button" className={DARK_BTN} onClick={() => setConfirm(true)}>
                <Icon name="trash" size={18} />
                Slet
              </button>
            </div>
            {!canShare && <p className="font-sans text-13 text-text-muted">Deling af video virker ikke i denne browser.</p>}
            {shareText !== null && <p role="status" className="font-sans text-13 text-text-muted">{shareText}</p>}
            <p role="status" className="font-sans text-13 text-text-muted">
              {saveText}
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
                      key={rangeText.action.kind.startsWith("undo") ? "fortryd" : "retry"}
                      type="button"
                      aria-disabled={markBusy || undefined}
                      className={`min-h-11 text-text underline underline-offset-4 aria-disabled:opacity-60 ${BTN}`}
                      onClick={() => {
                        if (rangeText.action !== null) runAction(rangeText.action);
                      }}
                    >
                      {rangeText.action.kind.startsWith("undo") ? "Fortryd" : "Prøv igen"}
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
