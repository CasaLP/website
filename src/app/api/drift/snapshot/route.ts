export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";
import {
  createDriftClient,
  createDriftUser,
  computeEquityUsd,
  cleanupDriftUser,
  cleanupDriftClient,
} from "@/lib/drift";

export async function POST(req: NextRequest) {
  const enabled = process.env.DRIFT_ENABLED === "1";
  if (!enabled) {
    return NextResponse.json(
      { error: "drift temporarily disabled" },
      { status: 503 }
    );
  }
  const { address, userAccount, sub } = await req
    .json()
    .catch(() => ({} as any));
  if (!address && !userAccount)
    return NextResponse.json(
      { error: "missing address or userAccount" },
      { status: 400 }
    );
  const subId = Number(sub ?? 0);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  try {
    const authority = address ? new PublicKey(address) : undefined;
    const driftClient = await createDriftClient({
      authority,
      subAccountId: subId,
    });
    const user = await createDriftUser({
      driftClient,
      authority,
      userAccountPublicKey: userAccount
        ? new PublicKey(userAccount)
        : undefined,
      subAccountId: subId,
    });

    const equityUsd = await computeEquityUsd(user);
    const asOf = new Date().toISOString();

    const { error } = await supabase.from("drift_nav_snapshots").upsert({
      address: (address || userAccount).toLowerCase(),
      subaccount: subId,
      as_of: asOf,
      equity_usd: equityUsd,
    });

    await cleanupDriftUser(user);
    await cleanupDriftClient(driftClient);

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      address: address || null,
      userAccount: userAccount || null,
      sub: subId,
      equityUsd,
      asOf,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
