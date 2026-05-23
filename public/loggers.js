const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const LEVEL_RANK = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const DAY_MS = 24 * 60 * 60 * 1000;
let NODE_MODULES_PROMISE = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runtimeProcess() {
  return typeof process !== "undefined" && process ? process : null;
}

function normalizeEndpoint(value) {
  const raw =
    typeof value === "string" && value.trim()
      ? value.trim()
      : "https://loggers.dev";
  return raw.replace(/\/+$/, "");
}

function normalizeLevel(value, fallback = "info") {
  if (!value) return fallback;
  const level = String(value).toLowerCase();
  assert(
    Object.prototype.hasOwnProperty.call(LEVEL_RANK, level),
    "Invalid level; expected debug, info, warn, or error",
  );
  return level;
}

function parseConfiguredLevel(value) {
  if (typeof value !== "string") return null;
  const level = value.trim().toLowerCase();
  if (!level) return null;
  return Object.prototype.hasOwnProperty.call(LEVEL_RANK, level) ? level : null;
}

function envString(env, key) {
  const value = env?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeData(value) {
  if (value === null || value === undefined) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  return { value };
}

function nowMs() {
  return Date.now();
}

function normalizeUlid(raw, context = "logger ULID") {
  const ulid = String(raw ?? "").trim().toUpperCase();
  assert(ULID_RE.test(ulid), `Invalid ${context}`);
  return ulid;
}

function isValidUlid(raw) {
  return ULID_RE.test(String(raw ?? "").trim().toUpperCase());
}

function parseMaybeInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function parseYamlScalar(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  return value;
}

function parseSimpleLoggersYaml(text) {
  const out = {
    timezone: null,
    default_level: null,
    loggers: {},
  };
  let inLoggers = false;
  let currentName = null;

  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = line.match(/^ */)[0].length;
    const trimmed = line.trim();

    if (indent === 0) {
      inLoggers = trimmed === "loggers:";
      currentName = null;
      const topMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!topMatch) continue;
      if (topMatch[1] === "timezone") {
        out.timezone = String(parseYamlScalar(topMatch[2]) || "");
      } else if (topMatch[1] === "default_level") {
        out.default_level = String(parseYamlScalar(topMatch[2]) || "");
      }
      continue;
    }
    if (!inLoggers) continue;

    if (indent === 2) {
      const m = trimmed.match(/^([A-Za-z0-9._-]+):\s*(.*)$/);
      if (!m) continue;
      currentName = m[1];
      const inline = m[2];
      if (inline) {
        out.loggers[currentName] = { ulid: String(parseYamlScalar(inline) || "") };
        currentName = null;
      } else {
        out.loggers[currentName] = {};
      }
      continue;
    }

    if (indent >= 4 && currentName) {
      const m = trimmed.match(/^([A-Za-z0-9._-]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const value = parseYamlScalar(m[2]);
      const row = out.loggers[currentName] || {};
      row[key] = value;
      out.loggers[currentName] = row;
    }
  }
  return out;
}

async function getNodeModules() {
  if (NODE_MODULES_PROMISE) return NODE_MODULES_PROMISE;
  NODE_MODULES_PROMISE = (async () => {
    try {
      const [fs, path] = await Promise.all([
        import("node:fs/promises"),
        import("node:path"),
      ]);
      return { fs, path };
    } catch {
      return null;
    }
  })();
  return NODE_MODULES_PROMISE;
}

async function readLoggersConfig() {
  const proc = runtimeProcess();
  const modules = await getNodeModules();
  if (!proc || !modules) return null;

  const cwd =
    typeof proc.cwd === "function" ? proc.cwd() : "";
  const env = proc.env || {};
  const home = typeof env.HOME === "string" ? env.HOME.trim() : "";
  const configOverride =
    typeof env.LOGGERS_CONFIG_PATH === "string" ? env.LOGGERS_CONFIG_PATH.trim() : "";

  const candidates = [
    configOverride || null,
    cwd ? modules.path.join(cwd, "loggers.yaml") : null,
    home ? modules.path.join(home, ".config", "loggers", "loggers.yaml") : null,
  ].filter((value, idx, arr) => value && arr.indexOf(value) === idx);

  for (const path of candidates) {
    try {
      const body = await modules.fs.readFile(path, "utf-8");
      return { path, config: parseSimpleLoggersYaml(body), modules };
    } catch {
      // keep checking next candidate path
    }
  }
  return { path: null, config: null, modules };
}

function dayKey(ms, timezone) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

class LoggerHandle {
  constructor(options) {
    assert(
      options && typeof options === "object",
      "Loggers.create(...) requires options",
    );
    const name = String(options.name ?? "").trim() || null;
    const ulidRaw = String(options.ulid ?? "").trim();
    assert(name || ulidRaw, "Either name or ulid is required");

    const component = String(options.component ?? "app").trim();
    assert(component.length > 0, "component is required");

    const flushIntervalMs = Number(options.flushIntervalMs ?? 20_000);
    const batchSize = Number(options.batchSize ?? 500);

    this.endpoint = normalizeEndpoint(options.endpoint);
    this.name = name;
    this.ulid = null;
    this.initWarnings = [];
    if (ulidRaw) {
      if (ULID_RE.test(ulidRaw.toUpperCase())) {
        this.ulid = normalizeUlid(ulidRaw);
      } else {
        this.initWarnings.push({
          msg: "invalid ULID in Loggers.create({ ulid })",
          provided_ulid: ulidRaw,
        });
      }
    }
    this.component = component;
    this.minLevel = normalizeLevel(options.level, "info");
    // Until initialize() resolves, minLevel may be raised or lowered by
    // env (LOGGERS_LEVEL) or config. Gate the synchronous level fast-drop
    // on this flag so lines logged before init aren't filtered against a
    // stale level — the async sinks re-check once init settles.
    this.initDone = false;
    this.flushIntervalMs = Number.isFinite(flushIntervalMs)
      ? Math.max(10_000, Math.floor(flushIntervalMs))
      : 20_000;
    this.batchSize =
      Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : 500;
    this.queue = [];
    this.closed = false;
    this.inFlight = null;
    this.localWriteChain = Promise.resolve();
    this.remoteEnabled = Boolean(this.ulid);
    this.localState = {
      enabled: false,
      dir: "",
      name: this.name || this.ulid || "logger",
      timezone: "UTC",
      retentionDays: 0,
      lastCleanupDay: null,
      modules: null,
    };
    this.options = options;
    this.initPromise = this.initialize();

    this.timer = setInterval(() => {
      this.flush().catch(() => {
        // Keep lines queued; caller can inspect flush()/close() rejections.
      });
    }, this.flushIntervalMs);
  }

  async initialize() {
    const cfg = await readLoggersConfig();
    const config = cfg?.config || null;
    const modules = cfg?.modules || null;
    const proc = runtimeProcess();
    const env = proc?.env || {};
    const envNameRaw = envString(env, "LOGGERS_NAME");
    const envUlidRaw = envString(env, "LOGGERS_ULID");
    const envLevel = parseConfiguredLevel(envString(env, "LOGGERS_LEVEL"));
    const loggerRow =
      this.name && config && config.loggers
        ? config.loggers[this.name] || null
        : null;

    if (
      !this.ulid &&
      this.name &&
      envNameRaw &&
      envNameRaw === this.name
    ) {
      if (envUlidRaw && isValidUlid(envUlidRaw)) {
        this.ulid = normalizeUlid(envUlidRaw, "LOGGERS_ULID");
        this.remoteEnabled = true;
      } else {
        this.initWarnings.push({
          msg: "LOGGERS_NAME matched but LOGGERS_ULID was missing/invalid",
          name: this.name,
          provided_ulid: envUlidRaw || null,
        });
      }
    }

    if (!this.ulid && loggerRow) {
      const fromConfig =
        typeof loggerRow === "string"
          ? loggerRow
          : typeof loggerRow.ulid === "string"
            ? loggerRow.ulid
            : "";
      if (fromConfig && isValidUlid(fromConfig)) {
        this.ulid = normalizeUlid(fromConfig, "logger ULID from config");
        this.remoteEnabled = true;
      } else if (fromConfig) {
        this.initWarnings.push({
          msg: "invalid ULID for name in loggers.yaml",
          name: this.name,
          provided_ulid: String(fromConfig),
        });
      }
    }

    if (!this.ulid) {
      // Missing alias should not throw; local sink can still run.
      this.remoteEnabled = false;
      if (this.name) {
        this.initWarnings.push({
          msg: "name did not resolve to a valid ULID; remote disabled",
          name: this.name,
        });
      }
    }

    const levelFromConfig = parseConfiguredLevel(
      this.name && loggerRow && typeof loggerRow.level === "string"
        ? loggerRow.level
        : typeof config?.default_level === "string"
          ? config.default_level
          : null,
    );
    if (this.options.level !== undefined) {
      this.minLevel = normalizeLevel(this.options.level, "info");
    } else {
      this.minLevel = envLevel ?? levelFromConfig ?? "info";
    }

    const localOption =
      this.options.local && typeof this.options.local === "object"
        ? this.options.local
        : {};
    const explicitLocalRequested =
      this.options.local === true ||
      (this.options.local &&
        typeof this.options.local === "object" &&
        this.options.local.enabled !== false);
    const explicitRetention = parseMaybeInt(
      this.options.fileRetentionDays ?? localOption.retentionDays,
    );
    const configRetention = parseMaybeInt(loggerRow?.file_retention_days);
    let retentionDays =
      explicitRetention ?? configRetention ?? (explicitLocalRequested ? 7 : 0);
    if (retentionDays < 0) retentionDays = 0;

    const localEnabled =
      retentionDays > 0 && (explicitLocalRequested || configRetention !== null);
    const localTimezone =
      String(localOption.timezone ?? config?.timezone ?? "UTC").trim() || "UTC";

    let localDir = String(localOption.dir ?? "").trim();
    if (!localDir && modules && proc && typeof proc.cwd === "function") {
      localDir = modules.path.join(proc.cwd(), "loggers");
    }
    if (!localDir) localDir = "loggers";

    this.localState = {
      enabled: localEnabled,
      dir: localDir,
      name: this.name || this.ulid || "logger",
      timezone: localTimezone,
      retentionDays,
      lastCleanupDay: null,
      modules,
    };

    for (const warning of this.initWarnings) {
      await this.writeDiagnosticWarning(warning);
    }

    this.initDone = true;
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
    // Only fast-drop once init has settled minLevel from env/config. Before
    // that, defer to the async sinks below, which re-check after init.
    if (this.initDone && !this.isEnabled(level)) return;

    const component =
      componentOverride === undefined
        ? this.component
        : String(componentOverride).trim();
    assert(component.length > 0, "component is required");

    const line = {
      level,
      component,
      data: normalizeData(data),
      logged_at: nowMs(),
    };
    this.queue.push(line);
    this.queueLocalWrite(line);

    if (this.queue.length >= this.batchSize) {
      this.flush().catch(() => {
        // Keep lines queued for a later flush attempt.
      });
    }
  }

  queueLocalWrite(line) {
    this.localWriteChain = this.localWriteChain
      .then(async () => {
        await this.initPromise;
        if (!this.isEnabled(line.level)) return;
        await this.appendLocalLine(line, false);
      })
      .catch(() => {
        // Local write failures should not crash ingestion.
      });
  }

  async appendLocalLine(line, forceLocal) {
    const state = this.localState;
    const modules = state.modules;
    if (!modules) return;
    if (!forceLocal && !state.enabled) return;

    const day = dayKey(line.logged_at, state.timezone);
    const baseDir = modules.path.join(state.dir, state.name);
    const filePath = modules.path.join(baseDir, `${day}.log`);
    await modules.fs.mkdir(baseDir, { recursive: true });
    await modules.fs.appendFile(filePath, `${JSON.stringify(line)}\n`, "utf-8");

    if (state.retentionDays > 0 && state.lastCleanupDay !== day) {
      state.lastCleanupDay = day;
      const cutoff = Date.now() - state.retentionDays * DAY_MS;
      const files = await modules.fs.readdir(baseDir);
      for (const file of files) {
        const m = file.match(/^(\d{4}-\d{2}-\d{2})\.log$/);
        if (!m) continue;
        const ts = Date.parse(`${m[1]}T00:00:00.000Z`);
        if (!Number.isFinite(ts) || ts >= cutoff) continue;
        await modules.fs
          .unlink(modules.path.join(baseDir, file))
          .catch(() => {});
      }
    }
  }

  async writeDiagnosticWarning(extraData) {
    const line = {
      level: "warn",
      component: "loggers.js",
      data: {
        msg: "logger configured for local-only fallback",
        ...extraData,
      },
      logged_at: nowMs(),
    };
    try {
      await this.appendLocalLine(line, true);
    } catch {
      // Diagnostics must never throw from initialization.
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
    await this.initPromise;
    if (this.inFlight) return this.inFlight;

    if (!this.remoteEnabled) {
      this.queue.length = 0;
      await this.localWriteChain;
      return;
    }
    // Drop lines enqueued before init that fall below the now-resolved
    // minimum level (enqueue couldn't decide yet).
    this.queue = this.queue.filter((line) => this.isEnabled(line.level));
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
    assert(this.ulid, "Remote ingest is disabled: no ULID resolved");
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
      throw new Error(
        `Loggers ingest failed (${res.status}): ${body || res.statusText}`,
      );
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    await this.flush();
    await this.localWriteChain;
  }
}

export const Loggers = {
  create(options) {
    return new LoggerHandle(options ?? {});
  },
};
