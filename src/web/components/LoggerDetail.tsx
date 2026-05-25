import { usePageTitle } from "pues/base/core";
import {
  Dialog,
  ObjectDetail,
  RenameTitle,
  type UseResourceResult,
  useEscape,
} from "pues/base/objects";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  LevelCounts,
  LoggerEntry,
  LogLevel,
  LogLine,
  LogWindow,
} from "../types.js";
import { EMPTY_LEVEL_COUNTS } from "../types.js";
import CopyIcon from "./CopyIcon";

type Props = {
  logger: LoggerEntry;
  counts: LevelCounts;
  resource: UseResourceResult<LoggerEntry>;
  onBack: () => void;
  filterQuery: string;
};

const WINDOWS: ReadonlyArray<{ key: LogWindow; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last_7_days", label: "Last 7 days" },
];

const EMPTY_BY_WINDOW: Record<LogWindow, string> = {
  today: "No logs today.",
  yesterday: "No logs yesterday.",
  last_7_days: "No logs in the last 7 days.",
};

const LEVELS: ReadonlyArray<{ key: LogLevel; label: string }> = [
  { key: "debug", label: "debug" },
  { key: "info", label: "info" },
  { key: "warn", label: "warn" },
  { key: "error", label: "error" },
];

const PAGE_LIMIT = 100;
const COPY_FEEDBACK_MS = 850;
// Treat the viewport as "pinned to bottom" within this many pixels, so a
// live line auto-scrolls only when the user is already at the tail.
const STICK_THRESHOLD_PX = 80;

function useClipboardFeedback() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = useCallback((text: string) => {
    if (typeof navigator === "undefined") return;
    void navigator.clipboard?.writeText(text);
    if (timer.current) clearTimeout(timer.current);
    setCopied(true);
    timer.current = setTimeout(() => {
      setCopied(false);
      timer.current = null;
    }, COPY_FEEDBACK_MS);
  }, []);
  return { copied, copy };
}

function fmtTime(unixMs: number): string {
  const d = new Date(unixMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function summarizeData(data: Record<string, unknown>): string {
  if ("msg" in data && typeof data.msg === "string") return data.msg;
  if ("message" in data && typeof data.message === "string")
    return data.message;
  try {
    const s = JSON.stringify(data);
    return s === "{}" ? "" : s;
  } catch {
    return "";
  }
}

function getTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function mergeRows(existing: LogLine[], incoming: LogLine[]): LogLine[] {
  if (incoming.length === 0) return existing;
  const byId = new Map<number, LogLine>();
  for (const row of existing) byId.set(row.id, row);
  for (const row of incoming) byId.set(row.id, row);
  return Array.from(byId.values()).sort(
    (a, b) => a.logged_at - b.logged_at || a.id - b.id,
  );
}

/** A run of consecutive, identical log lines collapsed into one entry. */
type LogGroup = {
  /** Stable key — the id of the first line in the run. */
  key: number;
  /** Representative line for display + expansion: the most recent in the
   *  run, so the timestamp tracks the latest occurrence. */
  rep: LogLine;
  count: number;
  sig: string;
};

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    );
    for (const [k, v] of entries) out[k] = normalizeJson(v);
    return out;
  }
  return value;
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(normalizeJson(value));
  } catch {
    return "";
  }
}

function lineSignature(row: LogLine): string {
  return [
    row.level,
    row.component,
    stableStringify(row.data),
    stableStringify(row.meta),
  ].join("\u0000");
}

/** Collapse consecutive identical lines (same level/component/data/meta). */
function collapseRuns(rows: LogLine[]): LogGroup[] {
  const out: LogGroup[] = [];
  for (const row of rows) {
    const sig = lineSignature(row);
    const prev = out[out.length - 1];
    if (prev && prev.sig === sig) {
      prev.rep = row;
      prev.count += 1;
    } else {
      out.push({ key: row.id, rep: row, count: 1, sig });
    }
  }
  return out;
}

export default function LoggerDetail({
  logger,
  counts,
  resource,
  onBack,
  filterQuery,
}: Props) {
  const [windowKey, setWindowKey] = useState<LogWindow>("today");
  const [activeLevel, setActiveLevel] = useState<LogLevel | null>(null);
  const [componentFilter, setComponentFilter] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Cursor for the *older* page (scroll-up). null = no older logs / search.
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<LogLine | null>(null);
  const [resyncFlag, setResyncFlag] = useState(0);
  const [windowCounts, setWindowCounts] = useState<LevelCounts>(counts);

  const reqIdRef = useRef(0);
  const countsReqIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  // Scroll bookkeeping consumed by the layout effect after `logs` change:
  //  - prependHeightRef: scrollHeight captured before prepending older
  //    rows, so we can keep the viewport anchored (no jump).
  //  - stickBottomRef: pin to bottom (initial load / live append at tail).
  const prependHeightRef = useRef<number | null>(null);
  const stickBottomRef = useRef(false);
  const loadingOlderRef = useRef(false);

  const ulidClipboard = useClipboardFeedback();

  usePageTitle(`${logger.label} — Loggers`);

  useEscape(!!expanded, () => setExpanded(null));

  const tz = useMemo(() => getTimezone(), []);
  const isSearching = filterQuery.trim().length > 0;
  const groups = useMemo(() => collapseRuns(logs), [logs]);
  const displayCounts = windowKey === "today" ? counts : windowCounts;

  useEffect(() => {
    if (windowKey === "today") {
      setWindowCounts(counts);
      return;
    }
    const myReq = ++countsReqIdRef.current;
    setWindowCounts(EMPTY_LEVEL_COUNTS);
    const params = new URLSearchParams();
    params.set("window", windowKey);
    params.set("tz", tz);
    fetch(`/logger/${logger.id}/counts?${params.toString()}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then((r) => (r.ok ? r.json() : EMPTY_LEVEL_COUNTS))
      .then((body: Partial<LevelCounts>) => {
        if (countsReqIdRef.current !== myReq) return;
        setWindowCounts({
          debug: Number(body.debug ?? 0),
          info: Number(body.info ?? 0),
          warn: Number(body.warn ?? 0),
          error: Number(body.error ?? 0),
        });
      })
      .catch(() => {
        if (countsReqIdRef.current === myReq)
          setWindowCounts(EMPTY_LEVEL_COUNTS);
      });
  }, [counts, logger.id, tz, windowKey]);

  // Load the latest page (and reload on filter / window / level / search).
  useEffect(() => {
    const myReq = ++reqIdRef.current;
    setLoadingInitial(true);
    loadingOlderRef.current = false;
    setLoadingOlder(false);
    setOlderCursor(null);
    setLogs([]);

    const params = new URLSearchParams();
    params.set("limit", String(PAGE_LIMIT));
    params.set("tz", tz);
    if (activeLevel) params.set("level", activeLevel);
    if (componentFilter) params.set("component", componentFilter);

    const q = filterQuery.trim();
    const path = q ? "search" : "logs";
    // Search and tail are both scoped to the selected day window. The tail
    // asks for the newest page first (dir=backward); scroll-up loads older.
    params.set("window", windowKey);
    if (q) {
      params.set("q", q);
    } else {
      params.set("dir", "backward");
    }

    fetch(`/logger/${logger.id}/${path}?${params.toString()}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then((r) => (r.ok ? r.json() : { items: [], next_cursor: null }))
      .then((body: { items: LogLine[]; next_cursor?: string | null }) => {
        if (reqIdRef.current !== myReq) return;
        setLogs(body.items ?? []);
        // Search has no scroll-up pagination; the tail does.
        setOlderCursor(q ? null : (body.next_cursor ?? null));
        stickBottomRef.current = true; // open scrolled to the newest line
      })
      .catch(() => {
        if (reqIdRef.current === myReq) setLogs([]);
      })
      .finally(() => {
        if (reqIdRef.current === myReq) setLoadingInitial(false);
      });
  }, [
    logger.id,
    windowKey,
    activeLevel,
    componentFilter,
    filterQuery,
    tz,
    resyncFlag,
  ]);

  // Live tail via SSE — only for "today" with no search/filter, so we
  // never inject current logs into a past-window or filtered view.
  const liveTailEnabled = !isSearching && windowKey === "today";
  useEffect(() => {
    if (!liveTailEnabled) return;
    const es = new EventSource(`/logger/${logger.id}/events`);
    const onBatch = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as { items?: LogLine[] };
        if (!payload.items?.length) return;
        const filtered = payload.items.filter((row) => {
          if (activeLevel && row.level !== activeLevel) return false;
          if (componentFilter && row.component !== componentFilter)
            return false;
          return true;
        });
        if (!filtered.length) return;
        const el = scrollRef.current;
        const nearBottom = el
          ? el.scrollHeight - el.scrollTop - el.clientHeight <
            STICK_THRESHOLD_PX
          : true;
        stickBottomRef.current = nearBottom;
        setLogs((prev) => mergeRows(prev, filtered));
      } catch {
        /* ignore */
      }
    };
    const onResync = () => setResyncFlag((n) => n + 1);
    es.addEventListener("logs_batch", onBatch);
    es.addEventListener("resync", onResync);
    return () => {
      es.removeEventListener("logs_batch", onBatch);
      es.removeEventListener("resync", onResync);
      es.close();
    };
  }, [logger.id, liveTailEnabled, activeLevel, componentFilter]);

  // After each render, settle the scroll position: anchor on prepend so
  // the viewport doesn't jump, otherwise pin to the bottom when flagged.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prependHeightRef.current != null) {
      el.scrollTop += el.scrollHeight - prependHeightRef.current;
      prependHeightRef.current = null;
    } else if (stickBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      stickBottomRef.current = false;
    }
  }, [groups]);

  const loadOlder = useCallback(() => {
    if (isSearching || !olderCursor || loadingOlderRef.current) return;
    const myReq = reqIdRef.current;
    loadingOlderRef.current = true;
    setLoadingOlder(true);

    const params = new URLSearchParams();
    params.set("window", windowKey);
    params.set("limit", String(PAGE_LIMIT));
    params.set("tz", tz);
    params.set("dir", "backward");
    params.set("cursor", olderCursor);
    if (activeLevel) params.set("level", activeLevel);
    if (componentFilter) params.set("component", componentFilter);

    fetch(`/logger/${logger.id}/logs?${params.toString()}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then((r) => (r.ok ? r.json() : { items: [], next_cursor: null }))
      .then((body: { items: LogLine[]; next_cursor?: string | null }) => {
        if (reqIdRef.current !== myReq) return;
        // Capture height *before* the prepend so the layout effect can
        // restore the user's place once the older rows render in.
        const el = scrollRef.current;
        if (el) prependHeightRef.current = el.scrollHeight;
        setLogs((prev) => mergeRows(prev, body.items ?? []));
        setOlderCursor(body.next_cursor ?? null);
      })
      .finally(() => {
        loadingOlderRef.current = false;
        if (reqIdRef.current === myReq) setLoadingOlder(false);
      });
  }, [
    activeLevel,
    componentFilter,
    isSearching,
    logger.id,
    olderCursor,
    tz,
    windowKey,
  ]);

  // Keep an always-current reference so the IntersectionObserver (created
  // once) calls the latest loadOlder without re-subscribing each render.
  const loadOlderRef = useRef(loadOlder);
  useEffect(() => {
    loadOlderRef.current = loadOlder;
  }, [loadOlder]);

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadOlderRef.current();
      },
      { root, rootMargin: "200px 0px 0px 0px" },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, []);

  // If the sentinel is already within the top trigger zone when pagination
  // becomes available (e.g. initial render / short collapsed view), ask for
  // older rows once so rewind doesn't stall waiting on a new intersection.
  useEffect(() => {
    if (isSearching || !olderCursor || loadingInitial || loadingOlder) return;
    const sentinel = topSentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const rootTop = root.getBoundingClientRect().top;
    const distance = sentinel.getBoundingClientRect().top - rootTop;
    if (distance >= -200 && distance <= 200) loadOlderRef.current();
  }, [groups, isSearching, loadingInitial, loadingOlder, olderCursor]);

  return (
    <div className="screen screen--detail">
      <div className="logger-detail-body">
        <ObjectDetail
          onBack={onBack}
          backLabel="◀ Back"
          backClassName="back-btn"
          headerClassName="logger-detail-header"
          title={
            <RenameTitle
              resource={resource}
              resourceName="loggers"
              rowId={logger.id}
              label={logger.label}
              className="logger-detail-name"
            />
          }
          subtitle={
            <button
              type="button"
              className="logger-api-copy"
              onClick={() => ulidClipboard.copy(logger.id)}
              title={
                ulidClipboard.copied
                  ? "Copied to clipboard"
                  : "Click to copy logger ULID"
              }
            >
              <span className="logger-api-text">{logger.id.slice(0, -6)}…</span>
              {ulidClipboard.copied ? (
                <span className="copied-badge">Copied!</span>
              ) : (
                <CopyIcon />
              )}
            </button>
          }
          actions={
            <select
              className="window-select"
              value={windowKey}
              onChange={(e) => setWindowKey(e.target.value as LogWindow)}
              aria-label="Date window"
            >
              {WINDOWS.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.label}
                </option>
              ))}
            </select>
          }
        >
          <div className="logger-detail-fixed-top">
            <div className="logger-detail-toolbar">
              <div className="logger-level-chips">
                <button
                  type="button"
                  className={`chip chip--level-all${activeLevel === null ? " chip--active" : ""}`}
                  onClick={() => setActiveLevel(null)}
                >
                  All
                </button>
                {LEVELS.map((l) => (
                  <button
                    type="button"
                    key={l.key}
                    className={`chip chip--level-${l.key}${
                      activeLevel === l.key ? " chip--active" : ""
                    }`}
                    onClick={() =>
                      setActiveLevel(activeLevel === l.key ? null : l.key)
                    }
                  >
                    {l.label}{" "}
                    <span className="chip-count">{displayCounts[l.key]}</span>
                  </button>
                ))}
              </div>
              {componentFilter && (
                <button
                  type="button"
                  className="chip chip--component-active"
                  onClick={() => setComponentFilter(null)}
                  title="Clear component filter"
                >
                  {componentFilter} ✕
                </button>
              )}
            </div>
          </div>

          <div className="logger-detail-scroll" ref={scrollRef}>
            <div ref={topSentinelRef} aria-hidden="true" />

            {loadingOlder && <p className="screen-loading">Loading earlier…</p>}
            {!isSearching &&
              !loadingInitial &&
              !loadingOlder &&
              olderCursor === null &&
              logs.length > 0 && (
                <p className="empty-state-hint">Beginning of logs.</p>
              )}

            <ul className="log-list">
              {groups.map((g) => (
                <li
                  key={g.key}
                  className={`log-row log-row--${g.rep.level}`}
                  onClick={() => setExpanded(g.rep)}
                >
                  <span className="log-row-time">
                    {fmtTime(g.rep.logged_at)}
                  </span>
                  <span
                    className={`log-row-level log-row-level--${g.rep.level}`}
                  >
                    {g.rep.level.charAt(0).toUpperCase()}
                  </span>
                  <button
                    type="button"
                    className="log-row-component"
                    onClick={(e) => {
                      e.stopPropagation();
                      setComponentFilter(g.rep.component);
                    }}
                    title={`Filter by ${g.rep.component}`}
                  >
                    {g.rep.component}
                  </button>
                  <span className="log-row-msg">
                    {summarizeData(g.rep.data)}
                  </span>
                  {g.count > 1 && (
                    <span
                      className="log-row-count"
                      title={`${g.count} identical lines`}
                    >
                      ×{g.count}
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {logs.length === 0 && !loadingInitial && (
              <p className="empty-state-hint">
                {isSearching ? "No matches." : EMPTY_BY_WINDOW[windowKey]}
              </p>
            )}

            {loadingInitial && <p className="screen-loading">Loading…</p>}
          </div>
        </ObjectDetail>
      </div>

      {expanded && (
        <Dialog
          title={
            <>
              {fmtTime(expanded.logged_at)}
              {" · "}
              <span
                className={`log-level-pill log-level-pill--${expanded.level}`}
              >
                {expanded.level}
              </span>
            </>
          }
          onClose={() => setExpanded(null)}
        >
          <div className="logger-expand-meta">
            <span className="logger-expand-component">
              {expanded.component}
            </span>
            <span className="logger-expand-id">#{expanded.id}</span>
          </div>
          <pre className="pues-dialog-code dialog-code--pre-wrap">
            {JSON.stringify(expanded.data, null, 2)}
          </pre>
          {Object.keys(expanded.meta).length > 0 && (
            <>
              <p className="logger-expand-label">meta</p>
              <pre className="pues-dialog-code dialog-code--pre-wrap">
                {JSON.stringify(expanded.meta, null, 2)}
              </pre>
            </>
          )}
        </Dialog>
      )}
    </div>
  );
}
