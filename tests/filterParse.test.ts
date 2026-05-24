import { describe, expect, test } from "bun:test";
import { parseTerms } from "../src/lib/logsQuery.js";

describe("parseTerms", () => {
  test("mixes key:value and bare terms", () => {
    expect(parseTerms("route:POST blah")).toEqual([
      { key: "route", value: "POST" },
      { free: "blah" },
    ]);
  });

  test('key:"quoted value" keeps spaces', () => {
    expect(parseTerms('msg:"two words"')).toEqual([
      { key: "msg", value: "two words" },
    ]);
  });

  test('"bare phrase" is one free term', () => {
    expect(parseTerms('"bare phrase"')).toEqual([{ free: "bare phrase" }]);
  });

  test("underscore key parses (escaping happens at LIKE time)", () => {
    expect(parseTerms("user_id:5")).toEqual([{ key: "user_id", value: "5" }]);
  });

  test("dotted/dashed keys are identifiers", () => {
    expect(parseTerms("req.headers-x:1")).toEqual([
      { key: "req.headers-x", value: "1" },
    ]);
  });

  test("url is a free term, not key 'http'", () => {
    expect(parseTerms("http://example.com")).toEqual([
      { free: "http://example.com" },
    ]);
  });

  test("a single bare word is one free term", () => {
    expect(parseTerms("alpha")).toEqual([{ free: "alpha" }]);
  });

  test("multiple field terms", () => {
    expect(parseTerms("route:POST status:200")).toEqual([
      { key: "route", value: "POST" },
      { key: "status", value: "200" },
    ]);
  });
});
