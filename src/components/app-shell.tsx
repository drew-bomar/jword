import Link from "next/link";
import { LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/server/actions/auth";
import { NavLinks } from "./nav-links";

export function AppShell({ children, email }: { children: React.ReactNode; email: string | null }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-12 w-full max-w-7xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <Link href="/" className="font-semibold tracking-tight">
            jword
          </Link>
          <NavLinks />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {email ? (
              <span className="text-muted-foreground hidden text-xs sm:inline">{email}</span>
            ) : null}
            <ThemeToggle />
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="icon-sm" aria-label="Sign out">
                <LogOutIcon aria-hidden />
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
