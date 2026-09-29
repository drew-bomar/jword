import { describe, expect, it } from "vitest";
import { evaluatePosting, evaluationKey } from "../src/leads/evaluate";
import { parseLeadEvaluation } from "../src/leads/evaluation-schema";
import { NEUTRAL_PREFERENCES } from "../src/preferences/types";

const valid = evaluatePosting(
  { title: "Engineer", description: null, location: null },
  {
    preferences: NEUTRAL_PREFERENCES,
    graduationDate: null,
    key: evaluationKey(1, null),
  },
);
describe("persisted evaluation boundary", () => {
  it("accepts evaluator output", () => expect(parseLeadEvaluation(valid)).toEqual(valid));
  it.each([
    null,
    {},
    { ...valid, cities: null },
    { ...valid, flags: {} },
    { ...valid, cities: ["ATLANTIS"], cityRank: 1 },
    { ...valid, match: "EXCLUDED" },
    { ...valid, exclusions: [{ code: "SENIORITY", field: "title" }] },
    { ...valid, arrangement: "REMOTE", arrangementField: "secret" },
    { ...valid, roleFamilies: ["UNKNOWN"] },
  ])("tolerates malformed stored JSON without exposing it to rendering: %j", (value) => {
    expect(parseLeadEvaluation(value)).toBeNull();
  });
});
