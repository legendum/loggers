import { Dialog } from "pues/base/objects";
import { useEffect, useRef, useState } from "react";
import CopyIcon from "./CopyIcon";

const INSTALL_CMD = "curl -fsSL https://loggers.dev/install.sh | sh";
const COPY_ACK_MS = 850;

type Props = {
  onClose: () => void;
};

export default function InstallDialog({ onClose }: Props) {
  const [installCopiedFlash, setInstallCopiedFlash] = useState(false);
  const copyFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyFlashTimer.current) clearTimeout(copyFlashTimer.current);
    },
    [],
  );

  async function copyInstallCommand() {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
      if (copyFlashTimer.current) clearTimeout(copyFlashTimer.current);
      setInstallCopiedFlash(true);
      copyFlashTimer.current = setTimeout(() => {
        setInstallCopiedFlash(false);
        copyFlashTimer.current = null;
      }, COPY_ACK_MS);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <Dialog title="Install the loggers CLI" onClose={onClose}>
      <section className="pues-dialog-section">
        <div className="pues-dialog-section-head">
          <h3>1. Install</h3>
          {installCopiedFlash ? (
            <span className="pues-dialog-copy-hint" role="status">
              Copied
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className={`pues-dialog-code-install-wrap${installCopiedFlash ? " pues-dialog-code--flash" : ""}`}
          onClick={copyInstallCommand}
          aria-label="Copy install command"
        >
          <span className="pues-dialog-code-install-scroll">{INSTALL_CMD}</span>
          <span className="pues-dialog-code-install-icon" aria-hidden="true">
            <CopyIcon />
          </span>
        </button>
      </section>

      <section className="pues-dialog-section">
        <h3>2. Configure your project</h3>
        <p>
          Open any logger on the dashboard and tap the ULID in its header to
          copy it. In your project folder, run <code>loggers</code> and paste
          that ULID when prompted. The CLI saves <code>LOGGERS_ULID</code> in
          your <code>.env</code> file automatically.
        </p>
        <pre className="pues-dialog-code">{`cd your-project
loggers
# Paste your copied logger ULID when prompted`}</pre>
      </section>

      <section className="pues-dialog-section">
        <h3>3. Use it</h3>
        <pre className="pues-dialog-code">
          {`loggers sdk                  # writes ./loggers.js in this folder
loggers alias app 01... warn # save alias + level in ~/.config/loggers/loggers.yaml
loggers level app error      # change saved level later
loggers log --info "hello"   # emit one log line from CLI
loggers show                 # latest logs for LOGGERS_ULID
loggers grep "error timeout" # search logger text
loggers tail                 # follow new logs
loggers -l <ulid|name> show  # override target by ULID or name`}
        </pre>
      </section>

      <section className="pues-dialog-section">
        <h3>4. Teach your AI agent</h3>
        <p>
          Install the skill file so Claude Code and Cursor know how to use your
          loggers:
        </p>
        <pre className="pues-dialog-code">loggers skill</pre>
      </section>
    </Dialog>
  );
}
