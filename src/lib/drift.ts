import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  DriftClient,
  Wallet,
  User,
  convertToNumber,
  QUOTE_PRECISION,
} from "@drift-labs/sdk";

export type CreateClientOptions = {
  rpcUrl?: string;
  env?: "mainnet-beta" | "devnet" | string;
  authority?: PublicKey;
  subAccountId?: number;
};

export async function createDriftClient(options: CreateClientOptions = {}) {
  const rpcUrl =
    options.rpcUrl ||
    process.env.SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com";
  const env =
    (options.env as any) || (process.env.DRIFT_ENV as any) || "mainnet-beta";
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new Wallet(Keypair.generate());
  const authority = options.authority;
  const sub = options.subAccountId ?? 0;

  const driftClient = new DriftClient({
    connection,
    wallet,
    env,
    accountSubscription: { type: "websocket" },
    // target only provided authority/sub to minimize subscriptions
    ...(authority
      ? { authoritySubAccountMap: { [authority.toBase58()]: [sub] } }
      : {}),
    userStats: false,
    perpMarketIndexes: [],
    spotMarketIndexes: [],
  });

  await driftClient.subscribe();
  return driftClient;
}

export async function cleanupDriftClient(driftClient: DriftClient) {
  try {
    await driftClient.unsubscribe();
  } catch {}
}

export type CreateUserOptions = {
  driftClient: DriftClient;
  authority?: PublicKey; // preferred: use authority + sub via client registry
  userAccountPublicKey?: PublicKey; // fallback: direct PDA
  subAccountId?: number;
};

export async function createDriftUser(opts: CreateUserOptions) {
  const { driftClient } = opts;
  const sub = opts.subAccountId ?? 0;

  // Prefer registry user when authority was provided to client init
  let user: any = null;
  if (opts.authority) {
    // @ts-ignore versions may support param object
    user =
      driftClient.getUser?.({ authority: opts.authority, subAccountId: sub }) ||
      // @ts-ignore fallback signature
      driftClient.getUser?.(sub);
  }

  // If not found or no authority, construct from userAccountPublicKey
  if (!user && opts.userAccountPublicKey) {
    user = new User({
      driftClient,
      userAccountPublicKey: opts.userAccountPublicKey,
      subAccountId: sub,
    });
  }

  if (!user) throw new Error("user_not_found_or_unloaded");

  // some versions require user.subscribe to populate data
  try {
    await user.subscribe?.();
  } catch {}

  return user as InstanceType<typeof User>;
}

export async function cleanupDriftUser(user: User) {
  try {
    await user.unsubscribe?.();
  } catch {}
}

export async function computeEquityUsd(user: User) {
  const totalCollateralBN = user.getTotalCollateral?.();
  if (!totalCollateralBN) throw new Error("user_totals_unavailable");
  const totalCollateral = convertToNumber(totalCollateralBN, QUOTE_PRECISION);
  const unrealizedPerpPnlBN = user.getUnrealizedPNL?.(true);
  const unrealizedPerpPnl =
    convertToNumber(unrealizedPerpPnlBN, QUOTE_PRECISION) || 0;
  return Number(totalCollateral) + Number(unrealizedPerpPnl);
}
