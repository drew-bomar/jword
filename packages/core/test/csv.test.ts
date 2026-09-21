import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/import/csv";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "../src/validation/schemas";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    const parsed = parseCsv("Company,Title\nIBM,SWE\nDatadog,Backend\n");
    expect(parsed.headers).toEqual(["Company", "Title"]);
    expect(parsed.rows).toEqual([
      ["IBM", "SWE"],
      ["Datadog", "Backend"],
    ]);
    expect(parsed.blankRowsSkipped).toBe(0);
  });

  it("handles quotes, escaped quotes, commas and newlines inside quotes", () => {
    const parsed = parseCsv('Company,Notes\n"Acme, Inc.","She said ""hi""\nsecond line"\n');
    expect(parsed.rows).toEqual([["Acme, Inc.", 'She said "hi"\nsecond line']]);
  });

  it("handles CRLF line endings and a BOM", () => {
    const parsed = parseCsv("﻿Company,Title\r\nIBM,SWE\r\n");
    expect(parsed.headers).toEqual(["Company", "Title"]);
    expect(parsed.rows).toEqual([["IBM", "SWE"]]);
  });

  it("skips blank rows and pads/truncates ragged rows", () => {
    const parsed = parseCsv("A,B,C\n1,2\n,,\n4,5,6,7\n");
    expect(parsed.rows).toEqual([
      ["1", "2", ""],
      ["4", "5", "6"],
    ]);
    expect(parsed.blankRowsSkipped).toBe(1);
  });

  it("names blank headers", () => {
    expect(parseCsv("A,,C\n1,2,3").headers).toEqual(["A", "Column 2", "C"]);
  });

  it("errors on missing header, unterminated quote, and limits", () => {
    expect(() => parseCsv("")).toThrow(/header/);
    expect(() => parseCsv(",,\n")).toThrow(/header/);
    expect(() => parseCsv('A,B\n"open,x')).toThrow(/unterminated/);
    const many = ["A"]
      .concat(Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `r${i}`))
      .join("\n");
    expect(() => parseCsv(many)).toThrow(/limit/);
    expect(() => parseCsv("x".repeat(IMPORT_MAX_BYTES + 1))).toThrow(/too large/);
  });
});
