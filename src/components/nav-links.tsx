"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Applications" },
  { href: "/import", label: "Import" },
  { href: "/settings/profile", label: "Profile" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex items-center gap-1 text-sm">
      {LINKS.map((link) => {
        const active = link.href === "/" ? pathname === "/" || pathname.startsWith("/applications") : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2 py-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
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
