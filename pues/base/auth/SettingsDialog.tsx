import type { ReactNode } from "react";
import { Dialog } from "../objects";
import { Logout } from "./Logout";

export type SettingsDialogProps = {
  onClose: () => void;
  /** App-specific settings sections (e.g. a public-key form). Rendered above
   * the default Logout footer. */
  children?: ReactNode;
  /** Dialog heading. Defaults to "Settings". */
  title?: ReactNode;
  /** Passed through to the default <Logout>. */
  logoutEndpoint?: string;
};

/**
 * The "Settings" dialog — a `Dialog` shell whose footer carries a `Logout` at
 * the bottom-left **by default** (so a consumer gets logout for free and the
 * screen's bottom-left can be a `<Settings>` entry point instead — see
 * `Settings`). Consumer settings go in `children`, above the footer.
 *
 * The dialog chrome (`.pues-dialog-*`) and footer (`.pues-settings-footer`)
 * are styled by `base/style`.
 */
export function SettingsDialog({
  onClose,
  children,
  title = "Settings",
  logoutEndpoint,
}: SettingsDialogProps) {
  return (
    <Dialog title={title} onClose={onClose}>
      {children}
      <div className="pues-settings-footer">
        <Logout variant="inline" endpoint={logoutEndpoint} />
      </div>
    </Dialog>
  );
}
