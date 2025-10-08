#!/usr/bin/env node

import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });
dotenv.config();

async function main() {
  const rpcUrl =
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const env = process.env.DRIFT_ENV || "mainnet-beta";
  const fromEnv = (process.env.DRIFT_SNAPSHOT_ADDRESSES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Optional CLI override: node scripts/test-drift.mjs <ADDRESS1,ADDRESS2,...>
  const cliArg = process.argv[2];
  const addresses = cliArg
    ? cliArg
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : fromEnv;

  if (!addresses.length) {
    console.error(
      "Provide addresses via DRIFT_SNAPSHOT_ADDRESSES or CLI: node scripts/test-drift.mjs <ADDR[,ADDR2]>"
    );
    process.exit(1);
  }

  const [{ Connection, Keypair, PublicKey }, driftMod] = await Promise.all([
    import("@solana/web3.js"),
    import("@drift-labs/sdk"),
  ]);
  const { DriftClient, Wallet, QUOTE_PRECISION, convertToNumber } = driftMod;

  const connection = new Connection(rpcUrl, "confirmed");

  async function fetchAccount(authorityStr) {
    const authority = new PublicKey(authorityStr);
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

      // Discover user accounts for this authority using SDK helpers
      let discovered = [];
      try {
        if (
          typeof drift.getUserAccountsAndAddressesForAuthority === "function"
        ) {
          const out = await drift.getUserAccountsAndAddressesForAuthority(
            authority
          );
          if (Array.isArray(out)) {
            // Possible shape: [{ userAccountPublicKey, userAccount }, ...]
            discovered = out.map((o) => ({
              pk: o?.userAccountPublicKey || o?.publicKey || o,
              acct: o?.userAccount || undefined,
            }));
          } else if (out && Array.isArray(out?.userAccounts)) {
            discovered = out.userAccounts.map((acct, i) => ({
              pk: out.addresses?.[i] || out.pubkeys?.[i],
              acct,
            }));
          }
        }
      } catch {}
      if (discovered.length === 0) {
        try {
          if (typeof drift.getUserAccountsForAuthority === "function") {
            const arr = await drift.getUserAccountsForAuthority(authority);
            if (Array.isArray(arr)) discovered = arr.map((pk) => ({ pk }));
          }
        } catch {}
      }

      if (discovered.length === 0) {
        return {
          address: authorityStr,
          error: "no_drift_user_accounts_for_authority",
        };
      }

      const details = [];
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
        const equityUsd = Number(settledUsd) + Number(unsettledUsd);

        details.push({
          userAccount: pk.toBase58?.() || String(pk),
          sub: subId,
          settledUsd,
          unsettledUsd,
          equityUsd,
        });
        settledSum += Number(settledUsd);
        unsettledSum += Number(unsettledUsd);
      }

      return {
        address: authorityStr,
        settledUsd: settledSum,
        unsettledUsd: unsettledSum,
        equityUsd: settledSum + unsettledSum,
        details,
      };
    } catch (e) {
      return { address: authorityStr, sub: 0, error: e?.message || String(e) };
    } finally {
      try {
        await drift.unsubscribe();
      } catch {}
    }
  }

  const results = [];
  for (const a of addresses) {
    // sequential to avoid overwhelming RPC
    // could be Promise.all if desired
    // eslint-disable-next-line no-await-in-loop
    const r = await fetchAccount(a);
    results.push(r);
  }

  console.log(
    JSON.stringify({ ok: true, env, count: results.length, results }, null, 2)
  );
}

async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: res.status, text };
  }
}

main().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});
