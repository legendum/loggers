import { Dialog } from "pues/base/objects";
import { useEffect, useRef, useState } from "react";
import CopyIcon from "./CopyIcon";

const SDK_URL = "https://loggers.dev/loggers.js";
const COPY_ACK_MS = 850;

type Props = {
  onClose: () => void;
};

export default function InstallDialog({ onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copySdkUrl() {
    try {
      await navigator.clipboard.writeText(SDK_URL);
      if (timer.current) clearTimeout(timer.current);
      setCopied(true);
      timer.current = setTimeout(() => {
        setCopied(false);
        timer.current = null;
      }, COPY_ACK_MS);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <Dialog title="Send logs to loggers.dev" onClose={onClose}>
      <section className="dialog-section">
        <div className="dialog-section-head">
          <h3>1. Grab the SDK</h3>
          {copied ? (
            <span className="dialog-copy-hint" role="status">
              Copied
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className={`dialog-code-install-wrap${copied ? " dialog-code--flash" : ""}`}
          onClick={copySdkUrl}
          aria-label="Copy SDK URL"
        >
          <span className="dialog-code-install-scroll">{SDK_URL}</span>
          <span className="dialog-code-install-icon" aria-hidden="true">
            <CopyIcon />
          </span>
        </button>
      </section>

      <section className="dialog-section">
        <h3>2. Copy your logger ULID</h3>
        <p>
          Open any logger on the dashboard and tap the ULID in its header to
          copy it. The UI shows a shortened preview.
        </p>
      </section>

      <section className="dialog-section">
        <h3>3. Browser usage</h3>
        <pre className="dialog-code dialog-code--pre-wrap">{`<script type="module">
  import { createLogger } from "${SDK_URL}";
  const log = createLogger({ ulid: "<YOUR_ULID>", component: "web" });
  log.info({ msg: "page loaded" });
</script>`}</pre>
      </section>

      <section className="dialog-section">
        <h3>4. Server / build-tool usage</h3>
        <pre className="dialog-code dialog-code--pre-wrap">{`import { createLogger } from "${SDK_URL}";
const log = createLogger({ ulid: "<YOUR_ULID>", component: "api" });
log.error({ msg: "boom", err });`}</pre>
      </section>
    </Dialog>
  );
}
