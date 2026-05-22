import { describe, expect, test } from "bun:test";
import { buildMeta } from "../src/lib/postProcess.js";

describe("buildMeta", () => {
  test("extracts hints and records redactions", () => {
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
    expect(meta.msg).toBe("failed");
    expect(meta.request_id).toBe("r1");
    expect(meta.redactions).toContain("password");
    expect(meta.redactions).toContain("nested.token");
    expect(typeof meta.ingested_at).toBe("number");
  });
});
