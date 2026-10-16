import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy" };

const CONTACT = "privacy@jword.work";
const UPDATED = "October 16, 2026";

/**
 * Public privacy policy (decision 027), also the Chrome Web Store privacy URL. Keep it true to
 * the code: update it when what jword stores, or who processes it, changes.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-10 text-sm leading-6 sm:px-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">jword privacy policy</h1>
        <p className="text-muted-foreground">Last updated {UPDATED}</p>
      </div>
      <p>
        jword is a job-application tracker run by one person as a small project. This page explains
        what it stores and why. Questions or requests:{" "}
        <a href={`mailto:${CONTACT}`} className="underline">
          {CONTACT}
        </a>
        .
      </p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">What jword stores</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your email address, used to sign you in with a one-time code.</li>
          <li>
            The applications you add or import: company, role, status, dates, links, posting text,
            notes, and a history of changes.
          </li>
          <li>
            Your profile, if you fill it in: name, contact details, links, education, and work
            authorization answers.
          </li>
          <li>
            A sign-in cookie that keeps you signed in. There are no advertising or analytics
            cookies.
          </li>
        </ul>
        <p>
          When you import a CSV file, jword saves the rows you confirm; the file itself is not
          stored.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">The Chrome extension</h2>
        <p>
          The jword capture extension reads a web page only when you click its button (or press its
          shortcut) on that page. It reads the job posting shown there and displays it in a panel
          for you to review, and sends it to jword only when you save, using your jword sign-in. It
          does not track browsing, read other tabs, or run on pages you do not use it on. In the
          browser it keeps only the jword address it talks to and the posting shown in an open
          panel.
        </p>
        <p>
          Data the extension handles is used only to provide this feature. It is not sold, not
          transferred to anyone else, not used for advertising, and not used to decide credit or
          lending.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Who processes it</h2>
        <p>
          jword runs on Vercel (hosting) and Supabase (database and sign-in), and sends sign-in
          emails through an email delivery service. They process data only to run jword. Your data
          is never sold or shared for any other purpose, and other jword users cannot see it.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Deleting your data</h2>
        <p>
          You can delete any application yourself. To delete your whole account, email{" "}
          <a href={`mailto:${CONTACT}`} className="underline">
            {CONTACT}
          </a>{" "}
          from the address you sign in with. Deleting an account permanently removes everything
          listed above.
        </p>
      </section>

      <p>
        <Link href="/" className="underline">
          Back to jword
        </Link>
      </p>
    </main>
  );
}
