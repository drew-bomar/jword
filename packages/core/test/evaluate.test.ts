import { describe, expect, it } from "vitest";
import {
  evaluatePosting,
  evaluationKey,
  splitLocations,
  type EvaluationContext,
  type EvaluationPosting,
} from "../src/leads/evaluate";
import { NEUTRAL_PREFERENCES } from "../src/preferences/types";
import { citiesIn } from "../src/preferences/cities";

// The owner's confirmed preferences (decision 026), used here only as test data.
const ctx: EvaluationContext = {
  preferences: {
    targetLevel: "NEW_GRAD",
    employmentTarget: "FULL_TIME",
    preferredStartMonth: "2027-08",
    preferredCities: ["SAN_FRANCISCO", "NEW_YORK", "CHICAGO", "BOSTON"],
    hideRemoteOnly: true,
    preferredRoles: ["BACKEND"],
    deemphasizedRoles: ["FRONTEND"],
    maxPostingAgeDays: null,
  },
  graduationDate: "2027-05-15",
  key: evaluationKey(1, "2027-05-15"),
};

const posting = (overrides: Partial<EvaluationPosting>): EvaluationPosting => ({
  title: "Software Engineer",
  location: "New York, NY",
  description: null,
  ...overrides,
});
const evaluate = (overrides: Partial<EvaluationPosting>, context = ctx) =>
  evaluatePosting(posting(overrides), context);
const codes = (overrides: Partial<EvaluationPosting>, context = ctx) => {
  const result = evaluate(overrides, context);
  return {
    match: result.match,
    exclusions: result.exclusions.map((e) => e.code),
    flags: result.flags.map((f) => f.code),
  };
};

describe("hard rules", () => {
  it.each([
    "Software Engineer Intern",
    "Summer 2027 Internship - Backend",
    "Software Engineering Co-op",
  ])("excludes an explicit internship title: %s", (title) => {
    expect(codes({ title }).exclusions).toEqual(["INTERNSHIP"]);
  });

  it("excludes a structured intern employment type even with a plain title", () => {
    const result = evaluate({ title: "Software Engineer", employmentType: "INTERN" });
    expect(result.match).toBe("EXCLUDED");
    expect(result.exclusions[0]).toMatchObject({ code: "INTERNSHIP", field: "employmentType" });
  });

  it("does not read 'internal' or 'international' as an internship", () => {
    expect(codes({ title: "Software Engineer, Internal Tools" }).exclusions).toEqual([]);
    expect(codes({ title: "Backend Engineer, International Payments" }).exclusions).toEqual([]);
  });

  it.each([
    "Senior Software Engineer",
    "Sr. Backend Engineer",
    "Staff Engineer, Platform",
    "Principal ML Engineer",
    "Tech Lead, Infrastructure",
    "Lead Software Engineer",
    "Software Engineer IV",
  ])("excludes a clearly senior title: %s", (title) => {
    expect(codes({ title }).exclusions).toContain("SENIORITY");
  });

  it.each(["Engineering Manager, Payments", "Director of Engineering", "Head of AI"])(
    "excludes people management: %s",
    (title) => {
      expect(codes({ title }).exclusions).toContain("MANAGEMENT");
    },
  );

  it.each([
    "Account Executive",
    "Recruiter",
    "Product Manager",
    "Senior Counsel",
    "Product Designer",
  ])("excludes a clearly unrelated occupation: %s", (title) => {
    expect(codes({ title }).exclusions).toContain("UNRELATED_OCCUPATION");
  });

  it.each([
    "Software Engineer",
    "Software Engineer II",
    "Engineer II, Backend",
    "Backend Engineer",
    "Frontend Engineer",
    "Machine Learning Engineer, Agents",
    "Forward Deployed Engineer",
    "Sales Engineer",
    "Technical Program Manager",
  ])("keeps an unspecified or entry-level engineering title: %s", (title) => {
    expect(codes({ title }).exclusions).toEqual([]);
  });

  it("keeps an unfamiliar title and flags it", () => {
    expect(codes({ title: "Member of Technical Staff" }).match).not.toBe("EXCLUDED");
    expect(codes({ title: "Solutions Consultant" })).toEqual({
      match: "UNCERTAIN",
      exclusions: [],
      flags: ["OCCUPATION_UNCLEAR"],
    });
  });

  it("flags Engineer III as unclear instead of excluding it", () => {
    expect(codes({ title: "Software Engineer III" })).toMatchObject({
      match: "UNCERTAIN",
      flags: ["LEVEL_UNCLEAR"],
    });
  });

  it("ignores senior colleagues and project leadership in the description", () => {
    const result = evaluate({
      description:
        "You will pair with senior engineers and staff engineers, lead projects end to end, " +
        "and report to our engineering manager.",
    });
    expect(result.match).toBe("ELIGIBLE");
  });
});

describe("rules tuned on live boards (2026-09-27)", () => {
  it.each([
    "Account Executive, AI Startups (Hunter)",
    "Technical Recruiter | Engineering",
    "Program Manager, AI and Developer Community Content and Events",
    "Enterprise Security Sales Specialist",
    "Engineering Compensation Partner",
    "Customer Activation Manager | Enterprise",
    "Country Manager",
    "Data Foundations AE - Aerospace and Defense",
  ])("excludes a non-engineering title despite a weak technical word: %s", (title) => {
    expect(codes({ title }).exclusions).toEqual(["UNRELATED_OCCUPATION"]);
  });

  it.each([
    "Manager I, Engineering - Code Security",
    "Data Science Manager, Risk",
    "Engineering Manager of Managers, Service Infrastructure",
  ])("recognizes an engineering-team manager: %s", (title) => {
    expect(codes({ title }).exclusions).toEqual(["MANAGEMENT"]);
  });

  it.each([
    "Communities Partner Development Manager, SaaS Platforms",
    "Pricing Strategist",
    "Deal Team - Business Affairs",
    "People Consultant",
  ])("calls a business role unrelated, not management: %s", (title) => {
    expect(codes({ title }).exclusions).toEqual(["UNRELATED_OCCUPATION"]);
  });

  it("does not read an unrelated slash as an either-level title", () => {
    expect(
      codes({
        title:
          "Senior Manager, Technical Consulting -Telecom/Comms domain (Technical Architect exp mandatory)",
      }).exclusions,
    ).toContain("SENIORITY");
    expect(codes({ title: "Full Stack Engineer (Senior/Lead) - MeshMesh" }).exclusions).toEqual([
      "SENIORITY",
    ]);
  });

  it("treats N/A and placeholder locations as saying nothing", () => {
    expect(codes({ location: "N/A" }).flags).toEqual([]);
  });

  it("gives an engineering manager only the management reason", () => {
    expect(codes({ title: "Engineering Manager, Payments" }).exclusions).toEqual(["MANAGEMENT"]);
    expect(codes({ title: "SVP, Global Solution Engineering" }).exclusions).toEqual(["MANAGEMENT"]);
  });

  it.each([
    "Software Engineer (MTS), Identity",
    "Software Engineering AMTS (College Grad)",
    "Commercial Sales Engineer",
    "GTM Business Systems Engineer",
    "Member of Technical Staff — Machine Learning",
  ])("keeps a title with a strong engineering signal: %s", (title) => {
    expect(codes({ title }).exclusions).toEqual([]);
  });

  it("flags technical-adjacent titles instead of excluding them", () => {
    for (const title of ["Technical Program Manager II", "Technical Account Manager - East"]) {
      expect(codes({ title })).toMatchObject({ match: "UNCERTAIN", flags: ["OCCUPATION_UNCLEAR"] });
    }
  });

  it("treats Salesforce SMTS/LMTS/PMTS as senior levels", () => {
    expect(codes({ title: "Value Acceleration Engineer SMTS" }).exclusions).toEqual(["SENIORITY"]);
    expect(codes({ title: "Value Acceleration Engineer MTS" }).exclusions).toEqual([]);
  });

  it("flags an either-level title instead of excluding it", () => {
    expect(
      codes({ title: "Solution Architect/Senior Solution Architect - Data 360" }),
    ).toMatchObject({
      match: "UNCERTAIN",
      exclusions: [],
      flags: expect.arrayContaining(["LEVEL_UNCLEAR"]),
    });
  });

  it("does not call a location remote-only when it also names offices", () => {
    expect(evaluate({ location: "US-Remote, Chicago, Seattle, San Francisco" }).arrangement).toBe(
      "UNKNOWN",
    );
    expect(
      evaluate({ location: "District of Columbia, USA, Remote; North Carolina, USA, Remote" })
        .arrangement,
    ).toBe("REMOTE");
    expect(evaluate({ location: "California - Remote" }).arrangement).toBe("REMOTE");
    expect(evaluate({ location: "US Remote National" }).arrangement).toBe("REMOTE");
  });
});

describe("graduation window", () => {
  it("never excludes before preferences are saved, even with a profile graduation date", () => {
    expect(
      codes(
        { description: "Candidates must be graduating between January 2025 and December 2025." },
        { ...ctx, preferences: null },
      ),
    ).toMatchObject({ exclusions: [] });
  });

  it.each([
    "Candidates graduating between January 2025 and December 2025 are preferred, but other graduation dates are welcome.",
    "We hired graduates between January 2025 and December 2025. All experience levels are welcome.",
    "You must be graduating between January 2025 and December 2025 or have equivalent professional experience.",
    "You must be graduating between January 2025 and December 2025. Equivalent experience is also accepted.",
    "You are not required to be graduating between January 2025 and December 2025.",
    "Open to candidates graduating between January 2025 and December 2025.",
  ])("keeps a graduation mention that does not establish a mandatory window: %s", (description) => {
    expect(codes({ description })).toMatchObject({
      match: "UNCERTAIN",
      exclusions: [],
      flags: ["GRADUATION_UNCLEAR"],
    });
  });
  it("excludes only an explicit range that excludes the owner's graduation month", () => {
    const result = evaluate({
      description: "Candidates must be graduating between December 2025 and June 2026.",
    });
    expect(result.exclusions).toEqual([
      expect.objectContaining({ code: "GRADUATION_WINDOW", field: "description" }),
    ]);
  });

  it("keeps a range that includes May 2027", () => {
    expect(
      codes({ description: "Expected graduation between December 2026 and August 2027." }).match,
    ).toBe("ELIGIBLE");
    expect(codes({ description: "For Dec 2026 - Jun 2027 graduates." }).match).toBe("ELIGIBLE");
  });

  it("flags instead of excluding when the statement is not a clear range", () => {
    expect(codes({ description: "You must graduate by June 2026." }).flags).toEqual([
      "GRADUATION_UNCLEAR",
    ]);
  });

  it("flags conflicting ranges instead of guessing", () => {
    expect(
      codes({
        description:
          "Graduating between Dec 2025 and Jun 2026. Also open to those graduating from 2027 to 2028.",
      }),
    ).toMatchObject({ match: "UNCERTAIN", flags: ["GRADUATION_UNCLEAR"] });
  });

  it("flags when the profile has no graduation date", () => {
    const result = codes(
      { description: "Graduating between December 2025 and June 2026." },
      { ...ctx, graduationDate: null },
    );
    expect(result).toMatchObject({ match: "UNCERTAIN", flags: ["GRADUATION_UNCLEAR"] });
  });
});

describe("uncertainty flags", () => {
  it("flags a stated experience requirement but never excludes on it", () => {
    expect(codes({ description: "Requires 5+ years of professional experience." })).toEqual({
      match: "UNCERTAIN",
      exclusions: [],
      flags: ["EXPERIENCE_MENTIONED"],
    });
    expect(codes({ description: "0-2 years of experience welcome." }).match).toBe("ELIGIBLE");
  });

  it("flags non-US locations as eligibility unknown, never excluding them", () => {
    expect(codes({ location: "Paris, France" })).toMatchObject({
      match: "UNCERTAIN",
      flags: ["ELIGIBILITY_OUTSIDE_US"],
    });
    expect(codes({ location: "London" }).flags).toEqual(["ELIGIBILITY_OUTSIDE_US"]);
  });

  it("assumes US eligibility for US and placeless locations", () => {
    for (const location of ["Austin, TX", "Remote - US", "Seattle", "3 Locations", "Remote"]) {
      expect(codes({ location }).flags).toEqual([]);
    }
  });

  it("flags contract and temporary employment", () => {
    expect(codes({ employmentType: "CONTRACT" }).flags).toEqual(["EMPLOYMENT_TYPE_OTHER"]);
  });
});

describe("labels never exclude", () => {
  it.each([
    ["Not remote", "UNKNOWN"],
    ["Non-remote", "UNKNOWN"],
    ["Remote work is not available", "UNKNOWN"],
    ["Onsite (not remote)", "ONSITE"],
    ["Onsite / Remote", "UNKNOWN"],
    ["Onsite and remote options", "UNKNOWN"],
  ])("does not label negated or mixed remote text as remote-only: %s", (location, arrangement) => {
    expect(evaluate({ location }).arrangement).toBe(arrangement);
  });
  it("labels remote-only postings from a structured field or remote-only locations", () => {
    expect(evaluate({ workplaceType: "REMOTE" })).toMatchObject({
      match: "ELIGIBLE",
      arrangement: "REMOTE",
      arrangementField: "workplaceType",
    });
    expect(evaluate({ location: "Remote (US)" }).arrangement).toBe("REMOTE");
    expect(evaluate({ title: "Backend Engineer (Remote)", location: null }).arrangement).toBe(
      "REMOTE",
    );
  });

  it("does not infer remote from a passing mention or from a mixed location", () => {
    expect(
      evaluate({ description: "We collaborate with remote teammates across time zones." })
        .arrangement,
    ).toBe("UNKNOWN");
    expect(evaluate({ location: "New York, NY; Remote, US" }).arrangement).toBe("UNKNOWN");
    expect(evaluate({ location: "Remote or Chicago, IL" }).arrangement).toBe("UNKNOWN");
    expect(evaluate({ title: "Remote Sensing Engineer" }).arrangement).toBe("UNKNOWN");
  });

  it("prefers the structured workplace type over location words", () => {
    expect(
      evaluate({ workplaceType: "HYBRID", locations: ["New York, NY", "Remote (US)"] }).arrangement,
    ).toBe("HYBRID");
  });

  it("ranks the best preferred city across every listed location", () => {
    const result = evaluate({
      location: "Chicago, IL",
      locations: ["Chicago, IL", "San Francisco, CA", "Miami, FL"],
    });
    expect(result).toMatchObject({ cities: ["SAN_FRANCISCO", "CHICAGO"], cityRank: 1 });
    expect(evaluate({ location: "Denver, CO" }).cityRank).toBeNull();
    expect(evaluate({ location: "NYC" }).cityRank).toBe(2);
  });

  it("labels backend as preferred and frontend as de-emphasized without excluding", () => {
    expect(evaluate({ title: "Backend Engineer" }).roleFit).toBe("PREFERRED");
    expect(evaluate({ title: "Frontend Engineer" })).toMatchObject({
      match: "ELIGIBLE",
      roleFit: "DEEMPHASIZED",
    });
    expect(evaluate({ title: "Full Stack Engineer" }).roleFit).toBe("NEUTRAL");
    expect(evaluate({ title: "Software Engineer" }).roleFit).toBe("NEUTRAL");
  });

  it("labels an explicit start month against the preferred start", () => {
    expect(evaluate({ description: "Start date: September 2027." })).toMatchObject({
      match: "ELIGIBLE",
      startMonth: "2027-09",
      startFit: "PREFERRED",
    });
    expect(evaluate({ description: "Starting in June 2027 in NYC." })).toMatchObject({
      match: "ELIGIBLE",
      startMonth: "2027-06",
      startFit: "EARLIER",
    });
  });
});

describe("neutral preferences", () => {
  it("excludes nothing before the owner saves preferences", () => {
    const neutral = { ...ctx, preferences: NEUTRAL_PREFERENCES, graduationDate: null };
    for (const title of ["Senior Software Engineer", "Software Engineer Intern", "Recruiter"]) {
      expect(evaluate({ title }, neutral).match).not.toBe("EXCLUDED");
    }
  });
});

describe("helpers", () => {
  it("splits multi-location strings and de-duplicates", () => {
    expect(
      splitLocations({ location: "New York, NY; San Francisco, CA", locations: ["New York, NY"] }),
    ).toEqual(["New York, NY", "San Francisco, CA"]);
  });

  it("matches city aliases as whole words only", () => {
    expect(citiesIn("SF Bay Area")).toEqual(["SAN_FRANCISCO"]);
    expect(citiesIn("Brooklyn, NY")).toEqual(["NEW_YORK"]);
    expect(citiesIn("SFO Airport")).toEqual([]);
  });

  it("keys evaluations by rules, preferences, and graduation month", () => {
    expect(evaluationKey(3, "2027-05-15")).toBe("e2:p3:g2027-05");
    expect(evaluationKey(0, null)).toBe("e2:p0:g-");
  });
});
