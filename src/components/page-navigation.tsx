import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Cursor links retain the other list's position and the active search/filter values. */
export function PageNavigation({
  pathname,
  params,
  cursorKey,
  current,
  next,
  label,
}: {
  pathname: string;
  params: Record<string, string | string[] | undefined>;
  cursorKey: string;
  current?: string;
  next: string | null;
  label: string;
}) {
  function href(cursor?: string) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && key !== cursorKey) query.set(key, value);
    }
    if (cursor) query.set(cursorKey, cursor);
    return `${pathname}?${query}`;
  }
  if (!current && !next) return null;
  return (
    <nav aria-label={`${label} pages`} className="flex gap-2">
      {current ? (
        <Button asChild variant="outline" size="sm">
          <Link href={href()} scroll={false}>
            First {label.toLowerCase()}
          </Link>
        </Button>
      ) : null}
      {next ? (
        <Button asChild variant="outline" size="sm">
          <Link href={href(next)} scroll={false}>
            More {label.toLowerCase()}
          </Link>
        </Button>
      ) : null}
    </nav>
  );
}
