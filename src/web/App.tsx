import { LoginScreen, useUser } from "pues/base/auth";
import { Pues } from "pues/base/core";
import { useResource, useSlugRouting } from "pues/base/objects";
import { useEffect, useRef, useState } from "react";
import LoggerDetail from "./components/LoggerDetail";
import Loggers from "./components/Loggers";
import TopBar from "./components/TopBar";
import { useLoggerLevelCounts } from "./hooks/useLoggerLevelCounts.js";
import { EMPTY_LEVEL_COUNTS, type LoggerEntry } from "./types.js";

const EXCLUDE_PREFIXES = ["api/", "pues/", "logger/", "dist/"];

export default function App() {
  const { user, loading: authLoading, refetch } = useUser();
  const [selfHosted, setSelfHosted] = useState<boolean | null>(null);
  const [sessionBootstrapping, setSessionBootstrapping] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);

  const resource = useResource<LoggerEntry>("loggers", { enabled: !!user });
  const { countsByLogger } = useLoggerLevelCounts(!!user);

  const {
    selected: selectedLogger,
    select: selectLogger,
    goBack,
    filterQuery,
    setFilterQuery,
  } = useSlugRouting<LoggerEntry>({
    resource,
    enabled: !!user,
    excludePathPrefixes: EXCLUDE_PREFIXES,
  });

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
          <LoginScreen tagline="Structured logging for apps and agents." />
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
