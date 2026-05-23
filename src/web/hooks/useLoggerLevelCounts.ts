import { useEffect, useState } from "react";
import {
  indexLevelCountsByLogger,
  type LoggerLevelCountRow,
} from "../levelCountsClient.js";
import type { LevelCounts } from "../types.js";

/** How often to refresh level counts so the chips track live ingest
 *  instead of freezing at their page-load values. */
const POLL_MS = 5_000;

export function useLoggerLevelCounts(enabled: boolean): {
  countsByLogger: Record<string, LevelCounts>;
  loading: boolean;
} {
  const [rows, setRows] = useState<LoggerLevelCountRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const load = () =>
      fetch("/api/loggers/level-counts", {
        credentials: "include",
        headers: { Accept: "application/json" },
      })
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          if (!cancelled) setRows(data as LoggerLevelCountRow[]);
        })
        .catch(() => {
          /* keep last-known counts on a transient failure */
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

    void load();
    const interval = setInterval(() => void load(), POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  return {
    countsByLogger: indexLevelCountsByLogger(rows),
    loading,
  };
}
