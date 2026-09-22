import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Not found</h1>
        <p className="text-muted-foreground text-sm">
          That page or application does not exist, or you do not have access to it.
        </p>
        <Button asChild variant="outline">
          <Link href="/">Back to applications</Link>
        </Button>
      </div>
    </main>
  );
}
