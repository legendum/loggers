import { Legendum } from "pues/base/auth";
import { TopBar as PuesTopBar } from "pues/base/objects";
import type { Dispatch, RefObject, SetStateAction } from "react";
import InstallDialog from "./InstallDialog";

type Props = {
  filterQuery: string;
  setFilterQuery: Dispatch<SetStateAction<string>>;
  filterInputRef: RefObject<HTMLInputElement | null>;
  /** Hide Legendum billing widget in self-hosted mode. */
  showLegendum?: boolean;
};

function formatCreditsBalance(cents: number): string {
  return `${cents.toLocaleString()} Credits`;
}

export default function TopBar({
  filterQuery,
  setFilterQuery,
  filterInputRef,
  showLegendum = true,
}: Props) {
  return (
    <PuesTopBar
      logoSrc="/loggers.png"
      logoTitle="About Loggers"
      filterQuery={filterQuery}
      setFilterQuery={setFilterQuery}
      filterInputRef={filterInputRef}
      filterPlaceholder="Filter…"
      filterAriaLabel="Filter loggers by name or slug"
      filterId="loggers-filter"
      right={
        showLegendum ? (
          <Legendum
            linkLabel="Link Legendum"
            linkingLabel="Linking..."
            errorLabel="Retry"
            formatBalance={formatCreditsBalance}
            lowCreditsThreshold={50}
            pollIntervalMs={60_000}
            autoLogoutOnUnlink
          />
        ) : undefined
      }
      renderInstallDialog={(close: () => void) => (
        <InstallDialog onClose={close} />
      )}
    />
  );
}
