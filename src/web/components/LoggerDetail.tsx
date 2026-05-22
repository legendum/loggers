import {
  Dialog,
  ObjectDetail,
  RenameTitle,
  type UseResourceResult,
  useEscape,
} from "pues/base/objects";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LevelCounts,
  LoggerEntry,
  LogLevel,
  LogLine,
  LogWindow,
} from "../types.js";
import { usePageTitle } from "../hooks/usePageTitle";
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
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<LogLine | null>(null);
  const [resyncFlag, setResyncFlag] = useState(0);
  const reqIdRef = useRef(0);
  const ulidClipboard = useClipboardFeedback();

  usePageTitle(`${logger.label} — Loggers`);

  useEscape(!!expanded, () => setExpanded(null));

  const tz = useMemo(() => getTimezone(), []);
  const isSearching = filterQuery.trim().length > 0;

  // Load first page (and reload on filter / window / level / search change).
  useEffect(() => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setNextCursor(null);
    setLogs([]);

    const params = new URLSearchParams();
    params.set("limit", String(PAGE_LIMIT));
    params.set("tz", tz);
    if (activeLevel) params.set("level", activeLevel);
    if (componentFilter) params.set("component", componentFilter);

    params.set("window", windowKey);
    const q = filterQuery.trim();
    if (q) params.set("q", q);
    const path = q ? "search" : "logs";

    fetch(`/logger/${logger.id}/${path}?${params.toString()}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then((r) => (r.ok ? r.json() : { items: [], next_cursor: null }))
      .then((body: { items: LogLine[]; next_cursor?: string | null }) => {
        if (reqIdRef.current !== myReq) return;
        setLogs(body.items ?? []);
        setNextCursor(body.next_cursor ?? null);
      })
      .catch(() => {
        if (reqIdRef.current === myReq) setLogs([]);
      })
      .finally(() => {
        if (reqIdRef.current === myReq) setLoading(false);
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

  // Live tail via SSE — only when no search/filter is active so we don't
  // mix unfiltered tail items into a filtered view.
  const liveTailEnabled = !isSearching;
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
        if (filtered.length) setLogs((prev) => mergeRows(prev, filtered));
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

  const loadMore = useCallback(() => {
    if (!nextCursor || isSearching) return;
    const myReq = ++reqIdRef.current;
    const params = new URLSearchParams();
    params.set("window", windowKey);
    params.set("limit", String(PAGE_LIMIT));
    params.set("tz", tz);
    params.set("cursor", nextCursor);
    if (activeLevel) params.set("level", activeLevel);
    if (componentFilter) params.set("component", componentFilter);
    fetch(`/logger/${logger.id}/logs?${params.toString()}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then((r) => (r.ok ? r.json() : { items: [], next_cursor: null }))
      .then((body: { items: LogLine[]; next_cursor?: string | null }) => {
        if (reqIdRef.current !== myReq) return;
        setLogs((prev) => mergeRows(prev, body.items ?? []));
        setNextCursor(body.next_cursor ?? null);
      });
  }, [
    activeLevel,
    componentFilter,
    isSearching,
    logger.id,
    nextCursor,
    tz,
    windowKey,
  ]);

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
              className={`chip${activeLevel === null ? " chip--active" : ""}`}
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
                {l.label} <span className="chip-count">{counts[l.key]}</span>
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

        <div className="logger-detail-scroll">
        <ul className="log-list">
          {logs.map((row) => (
            <li
              key={row.id}
              className={`log-row log-row--${row.level}`}
              onClick={() => setExpanded(row)}
            >
              <span className="log-row-time">{fmtTime(row.logged_at)}</span>
              <span className={`log-row-level log-row-level--${row.level}`}>
                {row.level.charAt(0).toUpperCase()}
              </span>
              <button
                type="button"
                className="log-row-component"
                onClick={(e) => {
                  e.stopPropagation();
                  setComponentFilter(row.component);
                }}
                title={`Filter by ${row.component}`}
              >
                {row.component}
              </button>
              <span className="log-row-msg">{summarizeData(row.data)}</span>
            </li>
          ))}
        </ul>

        {logs.length === 0 && !loading && (
          <p className="empty-state-hint">
            {isSearching ? "No matches." : EMPTY_BY_WINDOW[windowKey]}
          </p>
        )}

        {loading && <p className="screen-loading">Loading…</p>}

        {nextCursor && !isSearching && (
          <div className="form-button-row form-button-row--end">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={loadMore}
            >
              Load more
            </button>
          </div>
        )}
        </div>
      </ObjectDetail>
      </div>

      {expanded && (
        <Dialog
          title={`${fmtTime(expanded.logged_at)} · ${expanded.level}`}
          onClose={() => setExpanded(null)}
        >
          <div className="logger-expand-meta">
            <span className="logger-expand-component">
              {expanded.component}
            </span>
            <span className="logger-expand-id">#{expanded.id}</span>
          </div>
          <pre className="dialog-code dialog-code--pre-wrap">
            {JSON.stringify(expanded.data, null, 2)}
          </pre>
          {Object.keys(expanded.meta).length > 0 && (
            <>
              <p className="logger-expand-label">meta</p>
              <pre className="dialog-code dialog-code--pre-wrap">
                {JSON.stringify(expanded.meta, null, 2)}
              </pre>
            </>
          )}
        </Dialog>
      )}
    </div>
  );
}
