"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestSignInCode, verifySignInCode } from "@/server/actions/auth";

export function SignInForm({ initialError }: { initialError: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [pending, startTransition] = useTransition();

  function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await requestSignInCode({ email });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setStep("code");
    });
  }

  function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await verifySignInCode({ email, token });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {step === "email" ? (
        <form onSubmit={submitEmail} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Sending…" : "Send code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-3">
          <p className="text-muted-foreground text-sm">
            We sent a code to <span className="text-foreground font-medium">{email}</span>. Enter it
            below, or open the link in the email on this device.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="token">One-time code</Label>
            <Input
              id="token"
              name="token"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              required
              autoFocus
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Verifying…" : "Sign in"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => setStep("email")}
            disabled={pending}
          >
            Use a different email
          </Button>
        </form>
      )}
    </div>
  );
}
