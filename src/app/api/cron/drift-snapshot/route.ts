export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";

function headerEquals(req: NextRequest, name: string, value?: string | null) {
  return Boolean(value) && req.headers.get(name) === value;
}

export async function GET(req: NextRequest) {
  const enabled = process.env.DRIFT_ENABLED === "1";
  if (!enabled) {
    return NextResponse.json(
      { error: "drift temporarily disabled" },
      { status: 503 }
    );
  }
  if (!headerEquals(req, "x-cron-secret", process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rpcUrl =
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const env = (process.env.DRIFT_ENV as any) || "mainnet-beta";
  const addresses = (process.env.DRIFT_SNAPSHOT_ADDRESSES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const subaccounts = (process.env.DRIFT_SUBACCOUNTS || "0")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));

  if (addresses.length === 0) {
    return NextResponse.json(
      { error: "no addresses configured" },
      { status: 400 }
    );
  }

  const connection = new Connection(rpcUrl, "confirmed");
  // Dynamic import to avoid bundling native/wasm at build time
  const driftMod: any = await import("@drift-labs/sdk");
  const { DriftClient, Wallet, convertToNumber, QUOTE_PRECISION } = driftMod;
  const wallet = new Wallet(Keypair.generate()); // read-only usage
  const drift = new DriftClient({ connection, wallet, env });

  const results: Array<{
    address: string;
    sub: number;
    ok: boolean;
    error?: string;
  }> = [];
  const asOf = new Date();

  try {
    await drift.subscribe();

    for (const address of addresses) {
      const authority = new PublicKey(address);
      for (const sub of subaccounts) {
        try {
          try {
            // @ts-ignore optional depending on version
            await drift.addUser?.(sub, authority);
          } catch {}

          // Support both signatures: getUser(sub) and getUser({ authority, subAccountId })
          // @ts-ignore
          let user = drift.getUser?.(sub);
          if (!user) {
            // @ts-ignore
            user = drift.getUser?.({ authority, subAccountId: sub });
          }
          try {
            // @ts-ignore
            await user?.subscribe?.();
          } catch {}

          // Use defaults for margin category/strict to avoid type value imports
          const totalCollateralBN = user.getTotalCollateral?.();
          const unrealizedPerpPnlBN = user.getUnrealizedPNL?.(true);

          const totalCollateral = convertToNumber(
            totalCollateralBN,
            QUOTE_PRECISION
          );
          const unrealizedPerpPnl = convertToNumber(
            unrealizedPerpPnlBN,
            QUOTE_PRECISION
          );

          const equityUsd = Number(totalCollateral) + Number(unrealizedPerpPnl);

          const { error } = await supabase.from("drift_nav_snapshots").upsert({
            address: address.toLowerCase(),
            subaccount: sub,
            as_of: asOf.toISOString(),
            equity_usd: equityUsd,
          });
          results.push({ address, sub, ok: !error, error: error?.message });
        } catch (e: any) {
          results.push({
            address,
            sub,
            ok: false,
            error: e?.message || String(e),
          });
        }
      }
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || String(e) },
      { status: 500 }
    );
  } finally {
    try {
      await drift.unsubscribe();
    } catch {}
  }

  return NextResponse.json({ ok: true, results });
}
