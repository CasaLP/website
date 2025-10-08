export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  createDriftClient,
  createDriftUser,
  computeEquityUsd,
  cleanupDriftUser,
  cleanupDriftClient,
} from "@/lib/drift";

export async function GET(req: NextRequest) {
  const enabled = process.env.DRIFT_ENABLED === "1";
  if (!enabled) {
    return NextResponse.json(
      { error: "drift temporarily disabled" },
      { status: 503 }
    );
  }
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");
  const userAccount = searchParams.get("userAccount");
  const sub = Number(searchParams.get("sub") ?? "0");
  if (!address && !userAccount)
    return NextResponse.json(
      { error: "missing address or userAccount" },
      { status: 400 }
    );

  try {
    const authority = address ? new PublicKey(address) : undefined;
    const driftClient = await createDriftClient({
      authority,
      subAccountId: sub,
    });

    const user = await createDriftUser({
      driftClient,
      authority,
      userAccountPublicKey: userAccount
        ? new PublicKey(userAccount)
        : undefined,
      subAccountId: sub,
    });

    const equityUsd = await computeEquityUsd(user);

    await cleanupDriftUser(user);
    await cleanupDriftClient(driftClient);

    return NextResponse.json({
      address: address || null,
      userAccount: userAccount || null,
      sub,
      equityUsd,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
