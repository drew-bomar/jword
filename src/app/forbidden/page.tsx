import { Button } from "@/components/ui/button";
import { signOut } from "@/server/actions/auth";

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Not the tracker owner</h1>
        <p className="text-sm text-muted-foreground">
          You are signed in, but this account is not the configured owner of this tracker. Sign out and use the owner
          account.
        </p>
        <form action={signOut}>
          <Button type="submit">Sign out</Button>
        </form>
      </div>
    </main>
  );
}
