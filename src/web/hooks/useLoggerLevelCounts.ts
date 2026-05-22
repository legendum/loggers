import { useEffect, useState } from "react";
import {
  indexLevelCountsByLogger,
  type LoggerLevelCountRow,
} from "../levelCountsClient.js";
import type { LevelCounts } from "../types.js";

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
    fetch("/api/loggers/level-counts", {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setRows(data as LoggerLevelCountRow[]);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return {
    countsByLogger: indexLevelCountsByLogger(rows),
    loading,
  };
}
