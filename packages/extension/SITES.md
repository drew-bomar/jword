# Supported job sites

Every capture is reviewed in jword before saving, so a partial read still saves time. Fields the
extractor could only guess (company from a URL, title from a meta tag) are flagged in the preview.

| Site                  | Adapter         | Reads                                                                                            | Notes                                                                                                                                                           | Last checked |
| --------------------- | --------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| LinkedIn              | `linkedin.ts`   | title, company, location, workplace, job ID, canonical URL, description                          | Hashed class names since 2026: reads the page title, top-card lines, `componentkey`. "About the job" loads lazily; scroll to it before capturing to include it. | 2026-09-22   |
| Greenhouse            | `greenhouse.ts` | title, company, location, job ID, description                                                    | `job-boards.greenhouse.io` and legacy `boards.greenhouse.io`. Company boards that embed Greenhouse in an iframe fall back to the generic reader.                | 2026-09-22   |
| Lever                 | `lever.ts`      | title, company (JSON-LD), location, workplace, date posted, description                          | Description joins all posting sections except the apply button.                                                                                                 | 2026-09-22   |
| Ashby                 | `ashby.ts`      | JSON-LD, plus work arrangement from Ashby's "Location Type" (its JSON-LD can wrongly say remote) |                                                                                                                                                                 | 2026-09-22   |
| Workday               | `workday.ts`    | title, location, requisition ID, date posted, description                                        | Company comes from the tenant subdomain (flagged as a guess) because Workday's JSON-LD lists a legal entity such as "2100 NVIDIA USA".                          | 2026-09-22   |
| Any page with JSON-LD | `jsonld.ts`     | whatever the `JobPosting` provides                                                               | Many company career sites.                                                                                                                                      | —            |
| Anything else         | meta tags       | title and site name (both flagged), canonical URL                                                | Fill the rest in the preview.                                                                                                                                   | —            |

## Sites to add

Add a row here when a site you use reads poorly, with an example URL:

- _(none yet)_

## Adding a site

1. Save a small HTML fixture in `test/fixtures/` that mirrors the site's real markup (structure and
   attributes only; use made-up posting text).
2. Add `src/extract/sites/<site>.ts` implementing `SiteExtractor` and register it in
   `SITE_EXTRACTORS` (`src/extract/index.ts`). Prefer stable hooks: JSON-LD, `data-*` attributes,
   the page title, URL patterns. Mark anything inferred in `guessed`.
3. Add a test in `test/extract.test.ts`, run `pnpm ext:build`, reload the extension, and try a live
   posting.
4. Update the table above.
