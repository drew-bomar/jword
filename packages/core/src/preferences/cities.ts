/**
 * A small, documented city catalog for preferred-city matching (decision 026). A lead matches a
 * city when one of its locations contains one of the city's aliases as whole words. Keys are
 * stored in search_preferences.preferred_cities; the aliases can grow without a migration.
 *
 * Deliberately small: every alias is a plausible spelling in provider location strings, and
 * ambiguous short forms (for example "LA" or "SF" on their own) require a word boundary.
 */
export const CITY_CATALOG = {
  SAN_FRANCISCO: {
    label: "San Francisco",
    aliases: ["san francisco", "sf bay area", "san francisco bay area", "sf"],
  },
  NEW_YORK: {
    label: "New York City",
    aliases: ["new york city", "new york, ny", "new york", "nyc", "manhattan", "brooklyn"],
  },
  CHICAGO: { label: "Chicago", aliases: ["chicago"] },
  BOSTON: { label: "Boston", aliases: ["boston", "cambridge, ma"] },
  SEATTLE: { label: "Seattle", aliases: ["seattle", "bellevue", "redmond"] },
  AUSTIN: { label: "Austin", aliases: ["austin"] },
  LOS_ANGELES: { label: "Los Angeles", aliases: ["los angeles", "santa monica"] },
  SAN_JOSE_PENINSULA: {
    label: "San Jose / Peninsula",
    aliases: ["san jose", "palo alto", "mountain view", "menlo park", "sunnyvale", "santa clara"],
  },
  WASHINGTON_DC: { label: "Washington, DC", aliases: ["washington, dc", "washington dc", "d.c."] },
  DENVER: { label: "Denver", aliases: ["denver", "boulder"] },
  ATLANTA: { label: "Atlanta", aliases: ["atlanta"] },
  LONDON: { label: "London", aliases: ["london"] },
  TORONTO: { label: "Toronto", aliases: ["toronto"] },
} as const satisfies Record<string, { label: string; aliases: readonly string[] }>;

export type CityKey = keyof typeof CITY_CATALOG;
export const CITY_KEYS = Object.keys(CITY_CATALOG) as CityKey[];

export function isCityKey(value: string): value is CityKey {
  return Object.hasOwn(CITY_CATALOG, value);
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CITY_PATTERNS: Array<[CityKey, RegExp]> = CITY_KEYS.map((key) => [
  key,
  new RegExp(`(^|[^a-z])(${CITY_CATALOG[key].aliases.map(escape).join("|")})(?=$|[^a-z])`, "i"),
]);

/** Catalog cities named in one location string, e.g. "New York, NY (HQ)" -> ["NEW_YORK"]. */
export function citiesIn(location: string): CityKey[] {
  return CITY_PATTERNS.filter(([, pattern]) => pattern.test(location)).map(([key]) => key);
}
