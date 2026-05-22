import { Legendum, useUser } from "pues/base/auth";
import { Pues } from "pues/base/core";
import { useFilterQuery, useResource } from "pues/base/objects";
import { useEffect, useRef, useState } from "react";
import LoggerDetail from "./components/LoggerDetail";
import Loggers from "./components/Loggers";
import TopBar from "./components/TopBar";
import { useLoggerLevelCounts } from "./hooks/useLoggerLevelCounts.js";
import { EMPTY_LEVEL_COUNTS, type LoggerEntry } from "./types.js";

function getSlugFromPath(): string | null {
  const path = window.location.pathname;
  if (path === "/" || path === "") return null;
  const slug = path.slice(1);
  if (
    slug.startsWith("api/") ||
    slug.startsWith("pues/") ||
    slug.startsWith("logger/") ||
    slug.startsWith("dist/")
  ) {
    return null;
  }
  return slug || null;
}

export default function App() {
  const { user, loading: authLoading, refetch } = useUser();
  const [selfHosted, setSelfHosted] = useState<boolean | null>(null);
  const [sessionBootstrapping, setSessionBootstrapping] = useState(false);
  const [selectedLogger, setSelectedLogger] = useState<LoggerEntry | null>(
    null,
  );
  const [filterQuery, setFilterQuery] = useFilterQuery(
    selectedLogger?.id ?? null,
  );
  const filterInputRef = useRef<HTMLInputElement>(null);

  const resource = useResource<LoggerEntry>("loggers", { enabled: !!user });
  const { countsByLogger } = useLoggerLevelCounts(!!user);

  useEffect(() => {
    fetch("/api/mode", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : { self_hosted: false }))
      .then((body: { self_hosted?: boolean }) =>
        setSelfHosted(!!body.self_hosted),
      )
      .catch(() => setSelfHosted(false));
  }, []);

  // Self-hosted: mint session cookie via SPA shell GET, then re-fetch user.
  useEffect(() => {
    if (authLoading || user || selfHosted !== true) return;
    let cancelled = false;
    setSessionBootstrapping(true);
    fetch("/", { credentials: "include", headers: { Accept: "text/html" } })
      .then(() => refetch())
      .finally(() => {
        if (!cancelled) setSessionBootstrapping(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, selfHosted, refetch]);

  const rowsRef = useRef(resource.rows);
  rowsRef.current = resource.rows;

  // Resolve the URL slug into a selected logger row.
  //
  // Re-runs on: initial user load, every resource.rows change (so rename
  // via SSE flows through), and every selectedLogger.id change. We
  // prefer matching by id when a selection already exists — that way a
  // rename (slug changed but id stable) still tracks the same row, and
  // we replaceState the URL to the new slug. Without a selection, fall
  // back to slug match against rows.
  //
  // Holds the last selection through transient empty-rows states (no
  // setSelectedLogger(null) here) — that's the bug rows-watching fixes
  // vs. the loading-watching version this replaced.
  useEffect(() => {
    if (!user) return;
    const slug = getSlugFromPath();
    if (!slug) {
      setSelectedLogger(null);
      return;
    }
    const byId = selectedLogger
      ? resource.rows.find((r) => r.id === selectedLogger.id)
      : undefined;
    const found = byId ?? resource.rows.find((r) => r.slug === slug);
    if (!found) return;
    setSelectedLogger(found);
    if (found.slug !== slug) {
      window.history.replaceState(null, "", `/${found.slug}`);
    }
  }, [user, resource.rows, selectedLogger?.id]);

  // Browser back/forward — re-resolve from the new URL.
  useEffect(() => {
    const onPopState = () => {
      const slug = window.location.pathname.slice(1);
      if (!slug) {
        setSelectedLogger(null);
        return;
      }
      const found = rowsRef.current.find((r) => r.slug === slug);
      setSelectedLogger(found ?? null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const selectLogger = (entry: LoggerEntry) => {
    setSelectedLogger(entry);
    window.history.pushState(null, "", `/${entry.slug}`);
  };

  const goBack = () => {
    setSelectedLogger(null);
    window.history.pushState(null, "", "/");
  };

  const waitingForAuth =
    authLoading || sessionBootstrapping || selfHosted === null;

  return (
    <Pues user={waitingForAuth ? undefined : user}>
      {waitingForAuth ? (
        <p className="screen-loading">Loading…</p>
      ) : !user ? (
        selfHosted ? (
          <div className="login-screen">
            <p className="screen-empty">
              Could not start a local session.{" "}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => window.location.reload()}
              >
                Retry
              </button>
            </p>
          </div>
        ) : (
          <div className="login-screen">
            <img src="/loggers.png" alt="Loggers" className="login-logo" />
            <h1>Loggers</h1>
            <p>Structured log streams for apps and agents.</p>
            <Legendum className="btn" />
          </div>
        )
      ) : (
        <>
          <TopBar
            filterQuery={filterQuery}
            setFilterQuery={setFilterQuery}
            filterInputRef={filterInputRef}
            showLegendum={user.hosted}
          />
          <div
            className={selectedLogger ? "app-root-panel--hidden" : undefined}
          >
            <Loggers
              resource={resource}
              countsByLogger={countsByLogger}
              onSelect={selectLogger}
              filterQuery={filterQuery}
            />
          </div>
          {selectedLogger ? (
            <LoggerDetail
              key={selectedLogger.id}
              logger={selectedLogger}
              counts={countsByLogger[selectedLogger.id] ?? EMPTY_LEVEL_COUNTS}
              resource={resource}
              onBack={goBack}
              filterQuery={filterQuery}
            />
          ) : null}
        </>
      )}
    </Pues>
  );
}
