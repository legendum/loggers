import { describe, expect, test } from "bun:test";

describe("smoke", () => {
  test("loads constants", async () => {
    const { PORT, loggersDbDir } = await import("../src/lib/constants.js");
    expect(PORT).toBeGreaterThan(0);
    expect(loggersDbDir()).toContain("loggers");
  });
});
