import { createClient } from "@supabase/supabase-js";

// Prefer new key names if provided; fall back to anon for backwards compatibility
const PUBLIC_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  PUBLIC_KEY
);

// Server-only admin client for writes/management (do NOT import in client components)
export const supabaseAdmin =
  typeof window === "undefined"
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY || ""
      )
    : (null as any);

export function isValidSolanaAddress(address: string): boolean {
  // Base58 (no 0, O, I, l), usually 32-44 chars
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}
