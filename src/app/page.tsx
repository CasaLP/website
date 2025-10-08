"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const router = useRouter();
  const [address, setAddress] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = address.trim();
    if (!trimmed) return;
    router.push(`/account/${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="min-h-dvh flex flex-col p-6">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-xl space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Portfolio Viewer</h1>
            <p className="text-sm text-muted-foreground">
              Enter an account address to view performance.
            </p>
          </div>
          <form onSubmit={onSubmit} className="flex gap-2">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Account address"
              className="flex-1 rounded-md bg-card text-foreground placeholder:text-muted-foreground border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              className="rounded-md bg-primary text-primary-foreground px-4 py-2 hover:opacity-90"
            >
              View
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
