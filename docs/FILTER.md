# Filter / search query rewrite (logger detail page)

**Status:** design, not yet implemented.

Make the detail-page search box friendly over JSON log lines: let users type
`key:value` and bare words instead of raw JSON punctuation. Keep the existing
dumb-simple `LIKE` substring scan (`src/lib/logsQuery.ts#searchLogs`) — this is
purely a **query rewrite** in front of it. No FTS.

## Grammar

Parse `q` into space-separated **terms**, AND-ed together (every term must match
the row — narrows results, like Gmail/GitHub search):

- `key:value` — JSON field match.
- bare word — plain substring anywhere (today's behavior, per term).
- `"quoted phrase"` — literal substring including spaces (phrases still work
  once we start splitting on spaces).
- `key:"quoted value"` — field match with a spaced value.

Example: `route:POST blah` = two terms — field `route` starting with `POST`
**AND** `blah` somewhere. Matches `…"route":"POST"…blah…`.

## Rewrite (per term → LIKE)

A field term injects the JSON punctuation and matches **both** string and scalar
values:

```
route:POST   →  data/meta LIKE '%"route":"POST%'   (string value)
             OR data/meta LIKE '%"route":POST%'    (number / bool / null)
status:404   →  …'%"status":"404%'  OR  …'%"status":404%'
```

Two properties fall out:

- **Key-boundary safety for free.** The leading `"` and trailing `":` anchor the
  key, so `user:x` does NOT match `"user_id":…`, and `status:404` does not match
  `"xstatus":…`. Injecting the JSON quotes is strictly better than a bare
  substring.
- **Value is prefix/substring, not exact.** `status:404` also matches
  `"status":4045`. That's the friendly "starts-with" behavior. Exact match would
  need to also anchor the trailing `,`/`}` — skip unless wanted.

Bare terms stay as today: `(component LIKE %w% OR data LIKE %w% OR meta LIKE %w%)`.

## Sketch (server-side in `logsQuery.ts`, so CLI `grep` benefits too)

```ts
type Term = { key: string; value: string } | { free: string };

// key must be an identifier; (?!/) stops http://… being read as key "http"
const TERM_RE = /(\w[\w.-]*):(?:"([^"]*)"|(?!\/)(\S+))|"([^"]*)"|(\S+)/g;

function parseTerms(q: string): Term[] {
  const out: Term[] = [];
  for (const m of q.matchAll(TERM_RE)) {
    if (m[1] !== undefined && (m[2] ?? m[3]) !== undefined)
      out.push({ key: m[1], value: m[2] ?? m[3] });
    else out.push({ free: (m[4] ?? m[5])! });
  }
  return out;
}

// reuse the existing likePattern() — it escapes \ % _, so a key like
// "user_id" gets its underscore escaped (otherwise _ is a LIKE wildcard!).
function clauseFor(t: Term, binds: string[]): string {
  if ("free" in t) {
    const p = likePattern(t.free);
    binds.push(p, p, p);
    return "(component LIKE ? ESCAPE '\\' OR data LIKE ? ESCAPE '\\' OR meta LIKE ? ESCAPE '\\')";
  }
  const str = likePattern(`"${t.key}":"${t.value}`);
  const scalar = likePattern(`"${t.key}":${t.value}`);
  binds.push(str, scalar, str, scalar);
  return "(data LIKE ? ESCAPE '\\' OR data LIKE ? ESCAPE '\\' OR meta LIKE ? ESCAPE '\\' OR meta LIKE ? ESCAPE '\\')";
}
```

`WHERE` becomes `clauses.join(" AND ")` plus the existing window/level/component
binds. Empty parse → `[]` (as today).

## Decisions

- **Multi-term = AND; spaces split terms.** One behavior change: today `foo bar`
  matches the literal `"foo bar"`; after, it means `foo` AND `bar` (any
  order/position). Quoting (`"foo bar"`) restores the literal phrase. A single
  bare word is unchanged → no regression for the common case.
- **Case-insensitive** (SQLite `LIKE` is, for ASCII) — `route:post` matches
  `"route":"POST"`. Flag if case-sensitive is wanted.
- **`_` in keys must be escaped** — handled by reusing `likePattern`. Easy to get
  wrong (`user_id`, `input_tokens` have underscores).
- **`component:` / `level:`** — left hitting the JSON like any field (they also
  have dedicated filter chips). Could special-case them to the real indexed
  columns with equality if `level:error` should use the column — small add.

## Tests to add

- Parser: `route:POST blah` → `[{key:route,value:POST},{free:blah}]`.
- `key:"two words"` and `"bare phrase"` quoting.
- `user_id:5` — underscore escaped; does NOT match `"userXid":5`.
- `http://example.com` — read as a free term, not key `http`.
- String vs scalar: `status:404` matches both `"status":404` and `"status":"404"`.
- AND semantics: `route:POST status:200` requires both.
- Backward compat: a single bare word behaves exactly as before.
