const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const LEVEL_RANK = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeEndpoint(value) {
  const raw =
    typeof value === "string" && value.trim()
      ? value.trim()
      : "https://loggers.dev";
  return raw.replace(/\/+$/, "");
}

function normalizeLevel(value) {
  if (!value) return "debug";
  const level = String(value).toLowerCase();
  assert(
    Object.prototype.hasOwnProperty.call(LEVEL_RANK, level),
    "Invalid level; expected debug, info, warn, or error",
  );
  return level;
}

function normalizeData(value) {
  if (value === null || value === undefined) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  return { value };
}

function nowMs() {
  return Date.now();
}

class LoggerHandle {
  constructor(options) {
    assert(options && typeof options === "object", "Loggers.create(...) requires options");
    const ulid = String(options.ulid ?? "").trim();
    assert(ULID_RE.test(ulid), "Invalid logger ULID");

    const component = String(options.component ?? "app").trim();
    assert(component.length > 0, "component is required");

    const flushIntervalMs = Number(options.flushIntervalMs ?? 20_000);
    const batchSize = Number(options.batchSize ?? 500);
    this.endpoint = normalizeEndpoint(options.endpoint);
    this.ulid = ulid.toUpperCase();
    this.component = component;
    this.minLevel = normalizeLevel(options.level);
    this.flushIntervalMs = Number.isFinite(flushIntervalMs)
      ? Math.max(10_000, Math.floor(flushIntervalMs))
      : 20_000;
    this.batchSize =
      Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : 500;
    this.queue = [];
    this.closed = false;
    this.inFlight = null;
    this.timer = setInterval(() => {
      this.flush().catch(() => {
        // Keep lines queued; caller can inspect flush()/close() rejections.
      });
    }, this.flushIntervalMs);
  }

  isEnabled(level) {
    return LEVEL_RANK[level] >= LEVEL_RANK[this.minLevel];
  }

  enqueue(level, data, componentOverride) {
    assert(!this.closed, "Logger is closed");
    assert(
      Object.prototype.hasOwnProperty.call(LEVEL_RANK, level),
      "Invalid level; expected debug, info, warn, or error",
    );
    if (!this.isEnabled(level)) return;

    const component =
      componentOverride === undefined
        ? this.component
        : String(componentOverride).trim();
    assert(component.length > 0, "component is required");

    this.queue.push({
      level,
      component,
      data: normalizeData(data),
      logged_at: nowMs(),
    });
    if (this.queue.length >= this.batchSize) {
      this.flush().catch(() => {
        // Keep lines queued for a later flush attempt.
      });
    }
  }

  debug(data, componentOverride) {
    this.enqueue("debug", data, componentOverride);
  }

  info(data, componentOverride) {
    this.enqueue("info", data, componentOverride);
  }

  warn(data, componentOverride) {
    this.enqueue("warn", data, componentOverride);
  }

  error(data, componentOverride) {
    this.enqueue("error", data, componentOverride);
  }

  async flush() {
    if (this.inFlight) return this.inFlight;
    if (this.queue.length === 0) return;

    this.inFlight = (async () => {
      while (this.queue.length > 0) {
        const lines = this.queue.splice(0, this.batchSize);
        try {
          await this.postBatch(lines);
        } catch (err) {
          this.queue.unshift(...lines);
          throw err;
        }
      }
    })();

    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  async postBatch(lines) {
    const f = globalThis.fetch;
    assert(typeof f === "function", "global fetch is unavailable");
    const res = await f(`${this.endpoint}/logger/${this.ulid}/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
    });
    if (!res.ok) {
      let body = "";
      try {
        body = await res.text();
      } catch {
        // ignore read failures
      }
      throw new Error(`Loggers ingest failed (${res.status}): ${body || res.statusText}`);
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    await this.flush();
  }
}

export const Loggers = {
  create(options) {
    return new LoggerHandle(options ?? {});
  },
};

export function createLogger(options) {
  return Loggers.create(options);
}
