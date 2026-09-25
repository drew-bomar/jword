import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { normalizeCapturedPosting } from "@jword/core/browser";
import { cleanJobUrl, extractPosting, mergeExtractions } from "../src/extract/index";
import { arrangementFrom } from "../src/extract/text";

/** Fixtures are small hand-written pages that mirror each site's real markup (2026-09). */
function capture(fixture: string, url: string, edit: (html: string) => string = (html) => html) {
  const html = edit(readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8"));
  const window = new Window({ url });
  window.document.write(html);
  const payload = extractPosting(window.document as unknown as Document, url);
  // Every payload the extension produces must be accepted by the capture page.
  expect(normalizeCapturedPosting(payload)).not.toBeNull();
  return payload;
}

describe("site extractors", () => {
  it("Greenhouse: company from the page title, location, id, structured description", () => {
    const p = capture(
      "greenhouse.html",
      "https://job-boards.greenhouse.io/acmerobotics/jobs/5550001?gh_src=abc",
    );
    expect(p).toMatchObject({
      extractor: "greenhouse",
      source: "Greenhouse",
      company: "Acme Robotics",
      title: "Backend Engineer, Payments",
      location: "San Francisco, CA (Hybrid)",
      workArrangement: "HYBRID",
      externalJobId: "5550001",
      jobUrl: "https://job-boards.greenhouse.io/acmerobotics/jobs/5550001",
      guessed: [],
    });
    expect(p.description).toBe(
      "Acme builds warehouse robots.\n\nWhat you'll do\n\n• Design payment APIs\n\n• Own reliability",
    );
  });

  it("Lever: JSON-LD company beats the URL-slug guess; DOM sections form the description", () => {
    const p = capture(
      "lever.html",
      "https://jobs.lever.co/acme-robotics/0f5e7a2c-1111-4222-8333-444455556666?lever-source=LinkedIn",
    );
    expect(p).toMatchObject({
      extractor: "lever",
      company: "Acme Robotics, Inc.",
      title: "Platform Engineer",
      location: "London, United Kingdom",
      workArrangement: "HYBRID",
      datePosted: "2026-08-30",
      externalJobId: "0f5e7a2c-1111-4222-8333-444455556666",
      guessed: [],
    });
    expect(p.description).toContain("We run the fleet platform.");
    expect(p.description).toContain("• Kubernetes");
    expect(p.description).not.toContain("Apply for this job");
  });

  it("Ashby: complete JSON-LD including remote work and HTML description", () => {
    const p = capture(
      "ashby.html",
      "https://jobs.ashbyhq.com/acme/34413f8d-0000-4bbc-8ade-eb309a0e2245",
    );
    expect(p).toMatchObject({
      extractor: "ashby",
      company: "Acme",
      title: "Security Engineer, Cloud",
      location: "New York City, NY, USA",
      workArrangement: "REMOTE",
      datePosted: "2026-04-07",
      externalJobId: "34413f8d-0000-4bbc-8ade-eb309a0e2245",
    });
    expect(p.description).toBe(
      "About Acme\n\nAcme builds finance tools.\n\n• Harden cloud accounts",
    );
  });

  it("Ashby: its own Location Type wins over JSON-LD that wrongly says remote", () => {
    const url = "https://jobs.ashbyhq.com/norm-ai/366d4079-4842-469d-a5e0-3cc891a136b4";
    expect(capture("ashby-hybrid.html", url)).toMatchObject({
      company: "Norm Ai",
      title: "Forward Deployed Engineer",
      workArrangement: "HYBRID",
    });
    // Before the sidebar renders, the embedded app data still has it.
    const withoutSidebar = (html: string) => {
      const stripped = html.replace(/<h2>Location Type<\/h2>\s*<p>Hybrid<\/p>/, "");
      expect(stripped).not.toBe(html);
      return stripped;
    };
    expect(capture("ashby-hybrid.html", url, withoutSidebar).workArrangement).toBe("HYBRID");
  });

  it("Workday: tenant company flagged as a guess instead of the legal-entity JSON-LD name", () => {
    const p = capture(
      "workday.html",
      "https://acme.wd5.myworkdayjobs.com/en-US/External/job/US-CA-Santa-Clara/Silicon-Validation-Engineer_JR2022641?source=LinkedIn",
    );
    expect(p).toMatchObject({
      extractor: "workday",
      company: "Acme",
      guessed: ["company"],
      title: "Silicon Validation Engineer",
      location: "US, CA, Santa Clara",
      workArrangement: "HYBRID",
      externalJobId: "JR2022641",
      datePosted: "2026-09-22",
      jobUrl:
        "https://acme.wd5.myworkdayjobs.com/en-US/External/job/US-CA-Santa-Clara/Silicon-Validation-Engineer_JR2022641",
    });
    expect(p.description).toBe("Validate silicon.\n\n• Write tests");
  });

  it("Workday recruiting URLs identify the account, not the wd5 host", () => {
    expect(
      capture(
        "workday.html",
        "https://wd5.myworkdaysite.com/en-US/recruiting/acme/External/job/Engineer_JR1",
      ),
    ).toMatchObject({ company: "Acme", guessed: ["company"] });
  });

  it("unknown Workday URLs preserve the JSON-LD company instead of guessing a cluster", () => {
    expect(capture("workday.html", "https://wd5.myworkdaysite.com/unrecognized")).toMatchObject({
      company: "2100 ACME USA",
      guessed: [],
    });
  });

  it("LinkedIn: top card fields and a canonical job URL from a search page", () => {
    const p = capture(
      "linkedin.html",
      "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4100000001&trk=x",
    );
    expect(p).toMatchObject({
      extractor: "linkedin",
      source: "LinkedIn",
      company: "Acme Robotics",
      title: "Staff Software Engineer",
      location: "Chicago, IL",
      workArrangement: "REMOTE",
      externalJobId: "4100000001",
      jobUrl: "https://www.linkedin.com/jobs/view/4100000001/",
    });
    expect(p.description).toContain("Lead the robotics platform.");
  });

  it("LinkedIn 2026 layout: hashed classes, read from title, top-card lines, componentkey", () => {
    const p = capture("linkedin-2026.html", "https://www.linkedin.com/jobs/view/4463614019/");
    expect(p).toMatchObject({
      extractor: "linkedin",
      company: "Acme Grid",
      title: "Operations Co-op - Spring 2027",
      location: "Atlanta, GA",
      workArrangement: "ONSITE",
      externalJobId: "4463614019",
      guessed: [],
    });
    expect(p.description).toBe("About the job\n\nDigitize grid operations.\n\n• Automate reports");
  });

  it("LinkedIn: falls back to the page title when the markup changed", () => {
    const p = capture("linkedin-title-only.html", "https://www.linkedin.com/jobs/view/4100000002/");
    expect(p).toMatchObject({
      company: "Initech",
      title: "Data Engineer",
      externalJobId: "4100000002",
    });
  });

  it("unknown career site: meta-tag guesses are flagged and tracking params dropped", () => {
    const p = capture(
      "career-site.html",
      "https://careers.globex.example/jobs/senior-designer?utm_campaign=x",
    );
    expect(p).toMatchObject({
      extractor: "generic",
      source: "careers.globex.example",
      title: "Senior Designer",
      company: "Globex Careers",
      jobUrl: "https://careers.globex.example/jobs/senior-designer?team=design",
    });
    expect(p.guessed).toEqual(expect.arrayContaining(["title", "company"]));
  });
});

describe("helpers", () => {
  it("merge prefers confident values over guesses regardless of order", () => {
    expect(
      mergeExtractions([
        { company: "Slug Guess", guessed: ["company"], title: "From site" },
        { company: "Real Name", title: "From JSON-LD" },
      ]),
    ).toEqual({ company: "Real Name", title: "From site", guessed: [] });
    expect(mergeExtractions([{ company: "Only Guess", guessed: ["company"] }, {}])).toEqual({
      company: "Only Guess",
      guessed: ["company"],
    });
  });

  it("classifies short work-arrangement labels", () => {
    expect(arrangementFrom("Hybrid Remote")).toBe("HYBRID");
    expect(arrangementFrom("Remote - US")).toBe("REMOTE");
    expect(arrangementFrom("On-site")).toBe("ONSITE");
    expect(arrangementFrom("Chicago, IL")).toBeNull();
  });

  it("cleans job URLs", () => {
    expect(cleanJobUrl("https://x.example/j/1?utm_source=a&id=2#apply")).toBe(
      "https://x.example/j/1?id=2",
    );
    expect(cleanJobUrl("javascript:alert(1)")).toBeNull();
  });
});
