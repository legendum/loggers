import { Legendum } from "pues/base/auth";
import { FilterBar } from "pues/base/objects";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import InstallDialog from "./InstallDialog";

type Props = {
  filterQuery: string;
  setFilterQuery: Dispatch<SetStateAction<string>>;
  filterInputRef: RefObject<HTMLInputElement | null>;
  /** Hide Legendum billing widget in self-hosted mode. */
  showLegendum?: boolean;
};

export default function TopBar({
  filterQuery,
  setFilterQuery,
  filterInputRef,
  showLegendum = true,
}: Props) {
  const headerRef = useRef<HTMLElement | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const el = headerRef.current;
      if (el) el.style.transform = `translateY(${vv.offsetTop}px)`;
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <header className="topbar" ref={headerRef}>
      <div className="topbar-left">
        <button
          type="button"
          className="topbar-logo-btn"
          onClick={() => setShowInstall(true)}
          aria-label="About Loggers"
        >
          <img src="/loggers.png" alt="" />
        </button>
        <FilterBar
          query={filterQuery}
          setQuery={setFilterQuery}
          inputRef={filterInputRef}
          placeholder="Filter…"
          ariaLabel="Filter loggers by name or slug"
          id="loggers-filter"
          className="topbar-search-filter"
        />
      </div>
      {showLegendum ? (
        <div className="topbar-right">
          <Legendum className="btn btn-compact" />
        </div>
      ) : null}
      {showInstall && <InstallDialog onClose={() => setShowInstall(false)} />}
    </header>
  );
}
