import { citiesIn, isCityKey, type CityKey } from "../preferences/cities";
import { NEUTRAL_PREFERENCES, type RoleFamily, type SearchPreferences } from "../preferences/types";
import type { EmploymentType, WorkplaceType } from "../collection/types";

/**
 * Deterministic lead evaluation (decision 026). One pure function: the same posting, preferences,
 * and graduation date always give the same answer, with no database or network access.
 *
 * Central rule: unknown means eligible, with an uncertainty flag. Only clear, title- or
 * structured-field-based hard rules exclude a posting. City, start date, role family, and
 * remote arrangement are labels for sorting and views; they never exclude.
 *
 * Bump EVALUATOR_VERSION whenever a rule changes so stored evaluations are refreshed.
 */
export const EVALUATOR_VERSION = 2;

/** ELIGIBLE: no concerns. UNCERTAIN: eligible, with flags. EXCLUDED: a hard rule matched. */
export const LEAD_MATCHES = ["ELIGIBLE", "UNCERTAIN", "EXCLUDED"] as const;
export type LeadMatch = (typeof LEAD_MATCHES)[number];
export const LEAD_MATCH_LABELS: Record<LeadMatch, string> = {
  ELIGIBLE: "Eligible",
  UNCERTAIN: "Eligible, unclear",
  EXCLUDED: "Filtered out",
};

export const LEAD_ARRANGEMENTS = ["ONSITE", "HYBRID", "REMOTE", "UNKNOWN"] as const;
export type LeadArrangement = (typeof LEAD_ARRANGEMENTS)[number];
export const LEAD_ARRANGEMENT_LABELS: Record<LeadArrangement, string> = {
  ONSITE: "Onsite",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
  UNKNOWN: "Arrangement unstated",
};

export const ROLE_FITS = ["PREFERRED", "NEUTRAL", "DEEMPHASIZED"] as const;
export type RoleFit = (typeof ROLE_FITS)[number];

/** Hard rules. Any one of these excludes the posting. */
export const EXCLUSION_CODES = [
  "INTERNSHIP",
  "SENIORITY",
  "MANAGEMENT",
  "UNRELATED_OCCUPATION",
  "GRADUATION_WINDOW",
] as const;
export type ExclusionCode = (typeof EXCLUSION_CODES)[number];
export const EXCLUSION_LABELS: Record<ExclusionCode, string> = {
  INTERNSHIP: "Internship or co-op",
  SENIORITY: "Senior, staff, principal, or lead level",
  MANAGEMENT: "People-management role",
  UNRELATED_OCCUPATION: "Not an engineering role",
  GRADUATION_WINDOW: "Graduation window excludes yours",
};

/** Uncertainty flags. The posting stays eligible. */
export const FLAG_CODES = [
  "LEVEL_UNCLEAR",
  "OCCUPATION_UNCLEAR",
  "GRADUATION_UNCLEAR",
  "EXPERIENCE_MENTIONED",
  "EMPLOYMENT_TYPE_OTHER",
  "ELIGIBILITY_OUTSIDE_US",
] as const;
export type FlagCode = (typeof FLAG_CODES)[number];
export const FLAG_LABELS: Record<FlagCode, string> = {
  LEVEL_UNCLEAR: "Level unclear",
  OCCUPATION_UNCLEAR: "Role type unclear",
  GRADUATION_UNCLEAR: "Graduation requirement unclear",
  EXPERIENCE_MENTIONED: "Mentions years of experience",
  EMPLOYMENT_TYPE_OTHER: "Contract, part-time, or temporary",
  ELIGIBILITY_OUTSIDE_US: "Outside the US: work eligibility unknown",
};

export type FindingField =
  "title" | "employmentType" | "description" | "location" | "workplaceType" | "profile";

export interface EvaluationFinding<Code extends string = string> {
  code: Code;
  /** Which posting field the rule read. */
  field: FindingField;
  /** The matched text (short), so the owner can see why. */
  evidence: string;
}

export interface LeadEvaluation {
  match: LeadMatch;
  exclusions: EvaluationFinding<ExclusionCode>[];
  flags: EvaluationFinding<FlagCode>[];
  arrangement: LeadArrangement;
  /** Where the arrangement came from; null when unknown. */
  arrangementField: FindingField | null;
  /** Preferred cities (catalog keys) named in the posting's locations, best first. */
  cities: CityKey[];
  /** 1 = the most preferred city matched; null when none of the preferred cities appear. */
  cityRank: number | null;
  roleFamilies: RoleFamily[];
  roleFit: RoleFit;
  /** YYYY-MM when the description states a start month. */
  startMonth: string | null;
  /** Compared with the preferred start month; null when either is unknown. */
  startFit: "PREFERRED" | "EARLIER" | null;
}

/** The posting fields the evaluator reads. Collected postings and stored leads both fit. */
export interface EvaluationPosting {
  title: string;
  location: string | null;
  locations?: string[] | null;
  workplaceType?: WorkplaceType | null;
  employmentType?: EmploymentType | null;
  description: string | null;
}

export type EvaluationPreferences = Omit<SearchPreferences, "version" | "updatedAt">;

export interface EvaluationContext {
  /** null means the owner has never enabled filtering by saving preferences. */
  preferences: EvaluationPreferences | null;
  /** From the candidate profile (YYYY-MM-DD); null disables the graduation rule. */
  graduationDate: string | null;
  /** Stored with each evaluation; stale keys are re-evaluated. */
  key: string;
}

/** Evaluator version + preferences version + graduation month identify one evaluation. */
export function evaluationKey(preferencesVersion: number, graduationDate: string | null): string {
  return `e${EVALUATOR_VERSION}:p${preferencesVersion}:g${graduationDate?.slice(0, 7) ?? "-"}`;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const EVIDENCE_MAX = 160;

function snippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`.slice(0, EVIDENCE_MAX);
}

function find(pattern: RegExp, text: string | null | undefined): RegExpExecArray | null {
  if (!text) return null;
  pattern.lastIndex = 0;
  return pattern.exec(text);
}

// ---------------------------------------------------------------------------
// Title rules (conservative: a title that fits no rule is kept, with a flag at most)
// ---------------------------------------------------------------------------

const INTERN_TITLE = /\b(intern|interns|internship|internships|co-?op)\b/i;
// "Member of Technical Staff" is a level-neutral title (it includes new graduates); SMTS,
// LMTS, and PMTS are Salesforce's senior, lead, and principal levels of it.
const SENIOR_TITLE =
  /\b(senior|sr\.?|principal|distinguished|smts|lmts|pmts)\b|(?<!technical\s)\bstaff\b|\blead\b(?!\s+generation)|\b(engineer|developer|scientist|swe)\s*(iv|v|vi|4|5|6)\b/i;
const MID_LEVEL_TITLE = /\b(engineer|developer|scientist|swe)\s*(iii|3)\b|\bmid[- ]level\b/i;
/** "Solution Architect/Senior Solution Architect" can be either level. */
const LEVEL_ALTERNATIVES = /\s*\/\s*|\s+or\s+/i;

/**
 * True when a title offers a non-senior alternative of the same role, e.g.
 * "Solution Consultant/Senior Solution Consultant". The alternative's first words must appear
 * in the senior part, so an unrelated slash ("Telecom/Comms domain") does not count.
 */
function isEitherLevel(title: string): boolean {
  const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const parts = title.split(LEVEL_ALTERNATIVES);
  const senior = parts.filter((part) => find(SENIOR_TITLE, part)).map((p) => words(p).join(" "));
  return parts.some((part) => {
    if (find(SENIOR_TITLE, part)) return false;
    const lead = words(part).slice(0, 2).join(" ");
    return lead.length > 2 && senior.some((other) => ` ${other} `.includes(` ${lead} `));
  });
}
// People management: executives, or a manager of an engineering team. Other "manager" titles
// (account, product, customer activation, ...) are occupations, handled below.
const EXECUTIVE_TITLE = /\b(director|head of|vice president|vp|svp|evp|avp|chief|cto|cio)\b/i;
const MANAGER_WORD = /\bmanagers?\b/i;
/** A manager title about an engineering team: "Engineering Manager", "Manager I, Engineering". */
const ENGINEERING_TEAM =
  /\b(engineering|software|sre|infrastructure|data science|machine learning|ml)\b/i;
const OCCUPATION_MANAGER =
  /\b(product|program|project|account|sales|marketing|partner|success|campaigns?)\s+managers?\b/i;
// Strong signals that a title is an engineering or research role. Weaker words (AI, data,
// platform, security, technical) also appear in sales, recruiting, and program titles, so they
// only keep an otherwise unfamiliar title from being called unrelated.
const STRONG_TECH_TITLE =
  /\b(engineer|engineers|developer(?!\s+(?:community|relations|advocate|advocacy|marketing|experience|success|content|education|events|programs?))|software|swe|programmer|sre|devops|scientist|researcher|member of technical staff|mts|amts|firmware)\b/i;
const WEAK_TECH_TITLE =
  /\b(engineering|machine learning|ml|ai|research|architect|infrastructure|platform|back[- ]?end|front[- ]?end|full[- ]?stack|security|technical|data|quant|quantitative|embedded|systems)\b/i;
/** Technical-adjacent titles that are not engineering but not clearly unrelated either. */
const AMBIGUOUS_TECH_TITLE =
  /\btechnical\s+(program|project|product|account)\s+manager\b|\b(solutions?|technical)\s+(consultant|architect)\b/i;
const UNRELATED_TITLE =
  /\b(recruit\w*|sourcer|talent|sales|account executive|ae|business development|marketing|communications|comms|public relations|legal|counsel|attorney|paralegal|lawyer|accountant|accounting|finance|financial|fp&a|controller|tax|audit\w*|payroll|treasury|revenue|renewals|human resources|hr|people partner|people operations|compensation|benefits|equity administration|customer success|customer support|customer service|customer experience|customer activation|support specialist|office manager|executive assistant|administrative|receptionist|coordinator|designer|creative|motion design|producer|brand|product manager|program manager|project manager|manager|copywriter|writer|editor|curriculum|enablement|pricing|deal|demand generation|people|procurement|buyer|supply chain|facilities|workplace|operations|strategy|contracts|deal desk|compliance|fraud|investigator|credit risk|capital markets|partner development|business partner|nurse|physician|clinical|pharmac\w*|driver|warehouse|chef|barista)\b/i;

const ROLE_PATTERNS: Array<[RoleFamily, RegExp]> = [
  ["BACKEND", /\b(back[- ]?end|server[- ]side|apis?|distributed systems)\b/i],
  ["FRONTEND", /\b(front[- ]?end|ui engineer|ui developer|web developer|react|user interface)\b/i],
  ["FULL_STACK", /\bfull[- ]?stack\b/i],
  [
    "PLATFORM_INFRA",
    /\b(platform|infrastructure|infra|sre|site reliability|devops|cloud|reliability|kernel|compute|storage|networking)\b/i,
  ],
  [
    "AI_ML",
    /\b(machine learning|ml|ai|artificial intelligence|llms?|deep learning|agents?|agentic|genai|applied scientist|research engineer|nlp|computer vision)\b/i,
  ],
  ["DATA", /\b(data|analytics engineer|etl)\b/i],
  ["MOBILE", /\b(ios|android|mobile)\b/i],
  ["SECURITY", /\b(security|appsec|infosec)\b/i],
  ["EMBEDDED", /\b(embedded|firmware|hardware|fpga|asic)\b/i],
];

// ---------------------------------------------------------------------------
// Description rules (only explicit statements; never inferred from passing mentions)
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const MONTH =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function monthNumber(name: string | undefined): number | null {
  if (!name) return null;
  const key = name.toLowerCase();
  return MONTHS[key.slice(0, 4) === "sept" ? "sept" : key.slice(0, 3)] ?? null;
}

/** "graduating between December 2026 and June 2027", "graduation from 2026 to 2027". */
const GRADUATION_RANGE = new RegExp(
  `graduat\\w*[^.\\n]{0,60}?\\b(?:between|from)\\s+(?:${MONTH}\\s+)?(20\\d\\d)\\s*(?:and|to|through|-|–|—)\\s*(?:${MONTH}\\s+)?(20\\d\\d)`,
  "gi",
);
/** "December 2026 - June 2027 graduates" / "graduation date of Dec 2026 – Jun 2027". */
const GRADUATION_RANGE_REVERSED = new RegExp(
  `(?:${MONTH}\\s+)?(20\\d\\d)\\s*(?:-|–|—|to|through)\\s*(?:${MONTH}\\s+)?(20\\d\\d)\\s+(?:graduat\\w*|grads?)\\b|graduat\\w*\\s+(?:date|window)?\\s*(?:of|in|:)?\\s*(?:${MONTH}\\s+)?(20\\d\\d)\\s*(?:-|–|—|to|through)\\s*(?:${MONTH}\\s+)?(20\\d\\d)`,
  "gi",
);
/** Any graduation statement near a year; used only to raise an uncertainty flag. */
const GRADUATION_MENTION = /graduat\w*[^.\n]{0,60}?\b20\d\d\b|\b20\d\d\b[^.\n]{0,30}?graduat\w*/gi;
/** "3+ years of experience", "5 years of professional software experience". */
const EXPERIENCE =
  /\b(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?)\b[^.\n]{0,40}?experience/gi;
const START_DATE = new RegExp(
  `\\bstart(?:ing|s)?(?:\\s+date)?\\s*(?:is|:|in|on|of)?\\s*(?:in\\s+|on\\s+)?(?:early\\s+|mid\\s+|late\\s+)?${MONTH}\\s+(20\\d\\d)|${MONTH}\\s+(20\\d\\d)\\s+start\\b`,
  "i",
);

interface MonthRange {
  from: number;
  to: number;
  evidence: string;
  required: boolean;
}

/** A date range alone is not a requirement. Keep optional, historical, and alternative paths. */
function requiredGraduationRange(description: string, match: RegExpExecArray): boolean {
  const before = description.slice(0, match.index);
  const start = Math.max(before.lastIndexOf("."), before.lastIndexOf("\n")) + 1;
  const rest = description.slice(match.index + match[0].length);
  const end = rest.search(/[.\n]/);
  const sentence = description.slice(
    start,
    match.index + match[0].length + (end < 0 ? rest.length : end),
  );
  const optional =
    /\b(prefer\w*|optional|ideally|historically|previously|hired|not|no|other|alternativ\w*|or)\b/i;
  // Alternatives can be stated in the next sentence or bullet, too. A conservative keep is
  // preferable to dropping a posting that accepts experience in place of graduation dates.
  const alternative =
    /\b(equivalent|comparable)\b[^.\n]{0,60}\bexperience\b|\bother graduation dates\b/i;
  if (optional.test(sentence) || alternative.test(description)) return false;
  return /\b(must|required?|expected graduation)\b|^\s*(?:[-*•]\s*)?(?:graduat\w*\s+(?:between|from|date|window)|for\s+.*\b(?:graduates|grads)\b)/i.test(
    sentence,
  );
}

const monthIndex = (year: number, month: number) => year * 12 + (month - 1);

function graduationRanges(description: string): MonthRange[] {
  const ranges: MonthRange[] = [];
  const add = (
    m: RegExpExecArray,
    startMonth: string | undefined,
    startYear: string,
    endMonth: string | undefined,
    endYear: string,
  ) => {
    const from = monthIndex(Number(startYear), monthNumber(startMonth) ?? 1);
    const to = monthIndex(Number(endYear), monthNumber(endMonth) ?? 12);
    if (from <= to)
      ranges.push({
        from,
        to,
        evidence: snippet(description, m.index, m[0].length),
        required: requiredGraduationRange(description, m),
      });
  };
  for (const m of description.matchAll(GRADUATION_RANGE)) add(m, m[1], m[2]!, m[3], m[4]!);
  for (const m of description.matchAll(GRADUATION_RANGE_REVERSED)) {
    if (m[2]) add(m, m[1], m[2], m[3], m[4]!);
    else add(m, m[5], m[6]!, m[7], m[8]!);
  }
  return ranges;
}

// ---------------------------------------------------------------------------
// Locations and arrangement
// ---------------------------------------------------------------------------

const US_STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const US_STATE_NAMES =
  "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming";
const US_LOCATION = new RegExp(
  `\\b(united states|usa|u\\.s\\.a?\\.?|us|americas|north america)\\b|,\\s*(${US_STATES})\\b|\\b(${US_STATE_NAMES})\\b`,
  "i",
);
const NON_US_CITIES = new Set<CityKey>(["LONDON", "TORONTO"]);
/** Locations that say nothing about a place: "Remote", "3 Locations", "Multiple". */
const PLACELESS =
  /^\s*(remote|anywhere|global|worldwide|multiple(?: locations)?|\d+ locations?|various|tbd|flexible|n\/a|location|none)\s*$/i;
const REMOTE_WORD = /\bremote\b/i;
/** Segments that name a region rather than a workplace: "Remote, US", "California - Remote". */
const REGION_SEGMENT = new RegExp(
  `^\\s*(?:(?:${US_STATE_NAMES}|district of columbia|${US_STATES}|us|usa|u\\.s\\.a?\\.?|united states|north america|americas|amer|canada|uk|united kingdom|europe|emea|apac|latam|anywhere|global|worldwide)\\s*)+$`,
  "i",
);

/**
 * A location that allows only remote work: every comma-separated segment either says remote
 * or names a region. "US-Remote, Chicago, Seattle" also names offices, so it is not remote-only.
 */
function isRemoteOnlyLocation(location: string): boolean {
  if (!REMOTE_WORD.test(location) || NEGATED_REMOTE.test(location) || ONSITE_WORD.test(location))
    return false;
  return location
    .split(",")
    .every(
      (segment) => REMOTE_WORD.test(segment) || REGION_SEGMENT.test(segment.replace(/[()]/g, " ")),
    );
}
const HYBRID_WORD = /\bhybrid\b/i;
const ONSITE_WORD = /\b(on-?site|in[- ]office|in[- ]person)\b/i;
const NEGATED_REMOTE =
  /\b(?:not|no|non)[ -]+(?:fully[ -]+)?remote\b|\bremote\s+(?:work\s+)?(?:is\s+)?(?:not|unavailable)\b/i;
/** "Software Engineer (Remote)", "Engineer - Remote", "Remote - Backend Engineer". */
const REMOTE_TITLE = /\(\s*remote[^)]*\)|[-–—|,:]\s*remote\b|^\s*remote\s*[-–—|,:]/i;

/** Providers join several places in one string: "New York, NY; Remote, US". */
const LOCATION_SEPARATOR = /\s*;\s*|\s+\|\s+|\s+or\s+|\s+\/\s+/i;

export function splitLocations(
  posting: Pick<EvaluationPosting, "location" | "locations">,
): string[] {
  const all = [...(posting.locations ?? []), ...(posting.location ? [posting.location] : [])];
  return [
    ...new Set(
      all
        .flatMap((l) => l.split(LOCATION_SEPARATOR))
        .map((l) => l.trim())
        .filter(Boolean),
    ),
  ];
}

function isUsLocation(location: string): boolean {
  if (US_LOCATION.test(location)) return true;
  return citiesIn(location).some((city) => !NON_US_CITIES.has(city));
}

function arrangementOf(
  posting: EvaluationPosting,
  locations: string[],
): { arrangement: LeadArrangement; field: FindingField | null } {
  if (posting.workplaceType) return { arrangement: posting.workplaceType, field: "workplaceType" };
  if (locations.some((l) => HYBRID_WORD.test(l)) || HYBRID_WORD.test(posting.title)) {
    return { arrangement: "HYBRID", field: "location" };
  }
  const remote = locations.filter((l) => REMOTE_WORD.test(l));
  if (locations.length > 0 && locations.every(isRemoteOnlyLocation)) {
    return { arrangement: "REMOTE", field: "location" };
  }
  if (
    remote.length === 0 &&
    REMOTE_TITLE.test(posting.title) &&
    !NEGATED_REMOTE.test(posting.title)
  ) {
    // A title saying Remote with only placeless locations is remote-only; with an office
    // location as well, it is mixed and stays unknown.
    if (locations.every((l) => PLACELESS.test(l))) return { arrangement: "REMOTE", field: "title" };
    return { arrangement: "UNKNOWN", field: null };
  }
  if (locations.length > 0 && locations.every((l) => ONSITE_WORD.test(l))) {
    if (remote.some((l) => !NEGATED_REMOTE.test(l))) {
      return { arrangement: "UNKNOWN", field: null };
    }
    return { arrangement: "ONSITE", field: "location" };
  }
  return { arrangement: "UNKNOWN", field: null };
}

// ---------------------------------------------------------------------------
// The evaluator
// ---------------------------------------------------------------------------

export function evaluatePosting(
  posting: EvaluationPosting,
  ctx: EvaluationContext,
): LeadEvaluation {
  const prefs = ctx.preferences ?? NEUTRAL_PREFERENCES;
  const title = posting.title;
  const description = posting.description ?? "";
  const locations = splitLocations(posting);
  const exclusions: EvaluationFinding<ExclusionCode>[] = [];
  const flags: EvaluationFinding<FlagCode>[] = [];
  const fromTitle = (m: RegExpExecArray) => snippet(title, m.index, m[0].length);

  // Employment type: structured field first, then an explicit title word.
  if (prefs.employmentTarget === "FULL_TIME") {
    if (posting.employmentType === "INTERN") {
      exclusions.push({ code: "INTERNSHIP", field: "employmentType", evidence: "Intern" });
    } else {
      const m = find(INTERN_TITLE, title);
      if (m) exclusions.push({ code: "INTERNSHIP", field: "title", evidence: fromTitle(m) });
    }
    if (
      posting.employmentType &&
      ["CONTRACT", "PART_TIME", "TEMPORARY"].includes(posting.employmentType)
    ) {
      flags.push({
        code: "EMPLOYMENT_TYPE_OTHER",
        field: "employmentType",
        evidence: posting.employmentType,
      });
    }
  }

  // Seniority and people management read the title only. Descriptions mention senior
  // colleagues and "leading projects" without describing the advertised role.
  if (prefs.targetLevel === "NEW_GRAD") {
    const senior = find(SENIOR_TITLE, title);
    const eitherLevel = senior && isEitherLevel(title);
    if (senior && !eitherLevel) {
      exclusions.push({ code: "SENIORITY", field: "title", evidence: fromTitle(senior) });
    } else if (senior) {
      flags.push({ code: "LEVEL_UNCLEAR", field: "title", evidence: fromTitle(senior) });
    }
    const executive = find(EXECUTIVE_TITLE, title);
    const manager =
      !executive &&
      find(ENGINEERING_TEAM, title) &&
      !find(OCCUPATION_MANAGER, title) &&
      find(MANAGER_WORD, title);
    const management = executive || manager;
    if (management) {
      exclusions.push({ code: "MANAGEMENT", field: "title", evidence: fromTitle(management) });
    }
    const mid = !senior && find(MID_LEVEL_TITLE, title);
    if (mid) flags.push({ code: "LEVEL_UNCLEAR", field: "title", evidence: fromTitle(mid) });
    for (const m of description.matchAll(EXPERIENCE)) {
      if (Number(m[1]) >= 3) {
        flags.push({
          code: "EXPERIENCE_MENTIONED",
          field: "description",
          evidence: snippet(description, m.index, m[0].length),
        });
        break;
      }
    }
  }

  // Occupation: exclude only a clearly non-engineering title; keep unfamiliar titles.
  // Applies whenever preferences are saved (they describe an engineering search).
  // A management title already has its reason; "manager" alone is not an occupation signal.
  const managed = exclusions.some((e) => e.code === "MANAGEMENT");
  if (!managed && (prefs.targetLevel === "NEW_GRAD" || prefs.employmentTarget === "FULL_TIME")) {
    const strong = find(STRONG_TECH_TITLE, title);
    const ambiguous = !strong && find(AMBIGUOUS_TECH_TITLE, title);
    const unrelated = !strong && !ambiguous && find(UNRELATED_TITLE, title);
    if (unrelated) {
      exclusions.push({
        code: "UNRELATED_OCCUPATION",
        field: "title",
        evidence: fromTitle(unrelated),
      });
    } else if (!strong && (ambiguous || !find(WEAK_TECH_TITLE, title))) {
      flags.push({ code: "OCCUPATION_UNCLEAR", field: "title", evidence: title.slice(0, 160) });
    }
  }

  // Graduation window: exclude only when exactly one explicit range was parsed and it
  // excludes the owner's graduation month. Anything else graduation-related is a flag.
  if (description && ctx.preferences !== null) {
    const ranges = graduationRanges(description);
    const distinct = new Map(ranges.map((r) => [`${r.from}-${r.to}`, r]));
    const grad = ctx.graduationDate
      ? monthIndex(Number(ctx.graduationDate.slice(0, 4)), Number(ctx.graduationDate.slice(5, 7)))
      : null;
    if (distinct.size === 1 && grad !== null && ranges.every((r) => r.required)) {
      const range = [...distinct.values()][0]!;
      if (grad < range.from || grad > range.to) {
        exclusions.push({
          code: "GRADUATION_WINDOW",
          field: "description",
          evidence: range.evidence,
        });
      }
    } else if (distinct.size > 0) {
      const range = [...distinct.values()][0]!;
      flags.push({ code: "GRADUATION_UNCLEAR", field: "description", evidence: range.evidence });
    } else {
      const m = find(GRADUATION_MENTION, description);
      if (m) {
        flags.push({
          code: "GRADUATION_UNCLEAR",
          field: "description",
          evidence: snippet(description, m.index, m[0].length),
        });
      }
    }
  }

  // Eligibility is assumed for US jobs (matching only). Outside the US it is unknown: flag it,
  // never exclude. Placeless locations ("Remote", "3 Locations") say nothing either way.
  const placed = locations.filter((l) => !PLACELESS.test(l));
  if (placed.length > 0 && !placed.some(isUsLocation)) {
    flags.push({
      code: "ELIGIBILITY_OUTSIDE_US",
      field: "location",
      evidence: placed.join(" · ").slice(0, 160),
    });
  }

  const { arrangement, field: arrangementField } = arrangementOf(posting, locations);

  // Preferred cities: rank by the owner's order across every listed location.
  const named = new Set(locations.flatMap(citiesIn));
  const preferred = prefs.preferredCities.filter(isCityKey);
  const cities = preferred.filter((city) => named.has(city));
  const cityRank = cities.length ? preferred.indexOf(cities[0]!) + 1 : null;

  const roleFamilies = ROLE_PATTERNS.filter(([, pattern]) => pattern.test(title)).map(
    ([family]) => family,
  );
  const roleFit: RoleFit = roleFamilies.some((f) => prefs.preferredRoles.includes(f))
    ? "PREFERRED"
    : roleFamilies.some((f) => prefs.deemphasizedRoles.includes(f))
      ? "DEEMPHASIZED"
      : "NEUTRAL";

  let startMonth: string | null = null;
  const start = find(START_DATE, description);
  if (start) {
    const month = monthNumber(start[1] ?? start[3]);
    const year = start[2] ?? start[4];
    if (month && year) startMonth = `${year}-${String(month).padStart(2, "0")}`;
  }
  const startFit =
    startMonth && prefs.preferredStartMonth
      ? startMonth >= prefs.preferredStartMonth.slice(0, 7)
        ? "PREFERRED"
        : "EARLIER"
      : null;

  return {
    match: exclusions.length ? "EXCLUDED" : flags.length ? "UNCERTAIN" : "ELIGIBLE",
    exclusions,
    flags,
    arrangement,
    arrangementField,
    cities,
    cityRank,
    roleFamilies,
    roleFit,
    startMonth,
    startFit,
  };
}

/** The wire/storage form of an evaluation. */
export function toStoredEvaluation(evaluation: LeadEvaluation, key: string) {
  return {
    match: evaluation.match,
    arrangement: evaluation.arrangement,
    cityRank: evaluation.cityRank,
    roleFit: evaluation.roleFit,
    key,
    primaryReason: evaluation.exclusions[0]?.code ?? null,
    detail: evaluation,
  };
}
