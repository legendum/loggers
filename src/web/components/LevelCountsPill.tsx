import { Fragment } from "react";
import type { LevelCounts } from "../types.js";

const CELLS: Array<{
  letter: string;
  key: keyof LevelCounts;
  className: string;
}> = [
  { letter: "D", key: "debug", className: "level-count--debug" },
  { letter: "I", key: "info", className: "level-count--info" },
  { letter: "W", key: "warn", className: "level-count--warn" },
  { letter: "E", key: "error", className: "level-count--error" },
];

export default function LevelCountsPill({ counts }: { counts: LevelCounts }) {
  return (
    <span
      className="cat-count"
      title={CELLS.map((c) => `${c.key} ${counts[c.key]}`).join(" · ")}
    >
      {CELLS.map((c, i) => (
        <Fragment key={`l-${c.letter}`}>
          {i > 0 && <span className="cat-count-between" aria-hidden />}
          <span className="cat-count-letter" title={c.key}>
            {c.letter}
          </span>
        </Fragment>
      ))}
      {CELLS.map((c, i) => (
        <Fragment key={`v-${c.letter}`}>
          {i > 0 && (
            <span className="cat-count-between" aria-hidden>
              {"•"}
            </span>
          )}
          <span className={`cat-count-value ${c.className}`}>
            {counts[c.key]}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
