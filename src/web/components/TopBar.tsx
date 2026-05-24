import { Legendum } from "pues/base/auth";
import { FilterBar, LogoButton } from "pues/base/objects";
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

const LEGENDUM_ICON = <span className="legendum-icon">&#x2C60;</span>;

function formatCreditsBalance(cents: number): string {
  return `${cents.toLocaleString()} Credits`;
}

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
        <LogoButton
          logoSrc="/loggers.png"
          title="About Loggers"
          ariaLabel="About Loggers"
          onClick={() => setShowInstall(true)}
        />
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
          <Legendum
            className="legendum-btn"
            classNameLinked="legendum-linked"
            classNameUnlinked="legendum-link"
            classNameLowCredits="low-credits"
            iconSlot={LEGENDUM_ICON}
            linkLabel="Link Legendum"
            linkingLabel="Linking..."
            errorLabel="Retry"
            formatBalance={formatCreditsBalance}
            lowCreditsThreshold={50}
            pollIntervalMs={60_000}
            autoLogoutOnUnlink
          />
        </div>
      ) : null}
      {showInstall && <InstallDialog onClose={() => setShowInstall(false)} />}
    </header>
  );
}
