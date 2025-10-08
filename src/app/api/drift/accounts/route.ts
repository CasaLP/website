export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

export async function GET() {
  const enabled = process.env.DRIFT_ENABLED === "1";
  if (!enabled) {
    return NextResponse.json(
      { error: "drift temporarily disabled" },
      { status: 503 }
    );
  }
  const rpcUrl =
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const env = (process.env.DRIFT_ENV as any) || "mainnet-beta";
  const addresses = (process.env.DRIFT_SNAPSHOT_ADDRESSES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (addresses.length === 0) {
    return NextResponse.json(
      { error: "no addresses configured" },
      { status: 400 }
    );
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const driftMod: any = await import("@drift-labs/sdk");
  const { DriftClient, Wallet, QUOTE_PRECISION, convertToNumber } = driftMod;

  const results: Array<{
    address: string;
    sub: number;
    settledUsd?: number;
    unsettledUsd?: number;
    equityUsd?: number;
    error?: string;
  }> = [];

  for (const address of addresses) {
    const authority = new PublicKey(address);
    const wallet = new Wallet(Keypair.generate());
    const drift = new DriftClient({
      connection,
      wallet,
      env,
      accountSubscription: { type: "websocket" },
      userStats: false,
      perpMarketIndexes: [],
      spotMarketIndexes: [],
    });

    try {
      await drift.subscribe();
      const { User } = driftMod;

      // Discover all drift user accounts for this authority
      let discovered: Array<{ pk: any; acct?: any }> = [];
      try {
        if (
          typeof drift.getUserAccountsAndAddressesForAuthority === "function"
        ) {
          const out = await drift.getUserAccountsAndAddressesForAuthority(
            authority
          );
          if (Array.isArray(out)) {
            discovered = out.map((o: any) => ({
              pk: o?.userAccountPublicKey || o?.publicKey || o,
              acct: o?.userAccount || undefined,
            }));
          } else if (out && Array.isArray((out as any).userAccounts)) {
            discovered = (out as any).userAccounts.map(
              (acct: any, i: number) => ({
                pk: (out as any).addresses?.[i] || (out as any).pubkeys?.[i],
                acct,
              })
            );
          }
        }
      } catch {}
      if (discovered.length === 0) {
        try {
          if (typeof drift.getUserAccountsForAuthority === "function") {
            const arr = await drift.getUserAccountsForAuthority(authority);
            if (Array.isArray(arr)) discovered = arr.map((pk: any) => ({ pk }));
          }
        } catch {}
      }

      if (discovered.length === 0) {
        results.push({
          address,
          sub: 0,
          error: "no_drift_user_accounts_for_authority",
        });
      } else {
        let settledSum = 0;
        let unsettledSum = 0;
        for (const item of discovered) {
          const pk = item.pk;
          if (!pk) continue;

          const user = new User({
            driftClient: drift,
            userAccountPublicKey: pk,
          });
          await user.subscribe?.();

          const loadedAcct = user.getUserAccount?.();
          const subId =
            loadedAcct && typeof loadedAcct.subAccountId === "number"
              ? loadedAcct.subAccountId
              : item.acct && typeof item.acct.subAccountId === "number"
              ? item.acct.subAccountId
              : 0;

          const totalCollateralBN = user.getTotalCollateral?.();
          const unrealizedPerpPnlBN = user.getUnrealizedPNL?.(true);
          const settledUsd =
            convertToNumber(totalCollateralBN, QUOTE_PRECISION) || 0;
          const unsettledUsd =
            convertToNumber(unrealizedPerpPnlBN, QUOTE_PRECISION) || 0;
          settledSum += Number(settledUsd);
          unsettledSum += Number(unsettledUsd);
        }

        results.push({
          address,
          sub: 0,
          settledUsd: settledSum,
          unsettledUsd: unsettledSum,
          equityUsd: settledSum + unsettledSum,
        });
      }
    } catch (e: any) {
      results.push({ address, sub: 0, error: e?.message || String(e) });
    } finally {
      try {
        await drift.unsubscribe();
      } catch {}
    }
  }

  return NextResponse.json({ ok: true, results });
}
