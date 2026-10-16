"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Applications" },
  { href: "/watchlist", label: "Watchlist", discovery: true },
  { href: "/leads", label: "Leads", discovery: true },
  { href: "/import", label: "Import" },
  { href: "/settings/profile", label: "Profile" },
  { href: "/extension", label: "Extension" },
];

/** `discovery` comes from the server's canUseDiscovery (decision 027); hiding is not the gate. */
export function NavLinks({ discovery }: { discovery: boolean }) {
  const pathname = usePathname();
  const links = LINKS.filter((link) => discovery || !link.discovery);
  return (
    <nav
      aria-label="Primary"
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-sm sm:gap-1"
    >
      {links.map((link) => {
        const active =
          link.href === "/"
            ? pathname === "/" || pathname.startsWith("/applications")
            : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 shrink-0 rounded-md px-1.5 py-1 transition-colors focus-visible:ring-3 focus-visible:outline-none sm:px-2",
              active && "bg-muted text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
