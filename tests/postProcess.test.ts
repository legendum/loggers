import { describe, expect, test } from "bun:test";
import { buildMeta } from "../src/lib/postProcess.js";

describe("buildMeta", () => {
  test("holds server-owned fields and records redactions", () => {
    const meta = buildMeta(
      {
        msg: "failed",
        request_id: "r1",
        password: "x",
        nested: { token: "y" },
      },
      "api",
    );
    expect(meta.component).toBe("api");
    expect(typeof meta.ingested_at).toBe("number");
    expect(meta.redactions).toContain("password");
    expect(meta.redactions).toContain("nested.token");
    // Client fields are not promoted into meta — data stays the source of truth.
    expect(meta.msg).toBeUndefined();
    expect(meta.request_id).toBeUndefined();
  });
});
