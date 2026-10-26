import { encodeFunctionData, erc20Abi, getAddress, type Address, type Hex, type PublicClient } from "viem";
import { chunked } from "../aave/account";
import { morphoPosition, NO_LIQUIDITY_MESSAGE, type VaultEvent } from "./position";
import { morphoVaultV2Abi } from "../contracts/abis/MorphoVaultV2";
import { ROBINHOOD, ROBINHOOD_VAULT_ALLOWLIST } from "../contracts/robinhood";
import type { Position } from "../aave/position";

type Client = Pick<PublicClient, "readContract" | "getLogs" | "getBlockNumber" | "getBlock">;

/** How many of the newest vault events get a block timestamp for the ledger. */
const LEDGER_EVENTS = 50;

/** The only vault this app will ever encode a call for. */
export function assertAllowedVault(vault: string): Address {
  const a = getAddress(vault);
  if (!ROBINHOOD_VAULT_ALLOWLIST.some((v) => v.toLowerCase() === a.toLowerCase())) throw new Error("That vault is not on the allowlist.");
  return a;
}

const VAULT = ROBINHOOD.steakhouseUsdgVault;

/** Exact-amount USDG approval for the vault (never unlimited). The wallet approves; the vault pulls from the wallet. */
export const approveData = (amount: bigint): Hex => encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [assertAllowedVault(VAULT), amount] });

/** Deposit on behalf of the Safe: the vault shares (principal + yield) belong to the Safe, not the wallet. */
export const depositData = (amount: bigint, safe: Address): Hex => encodeFunctionData({ abi: morphoVaultV2Abi, functionName: "deposit", args: [amount, safe] });

/** Yield withdrawals land in the Safe itself (that is what marks them as yield, see position.ts). Called BY the Safe (owner = Safe). */
export const withdrawYieldData = (amount: bigint, safe: Address): Hex => encodeFunctionData({ abi: morphoVaultV2Abi, functionName: "withdraw", args: [amount, safe, safe] });

/** Principal exits (or a spend of principal) go to `receiver`, withdrawn by the Safe as owner. */
export const withdrawToData = (amount: bigint, receiver: Address, safe: Address): Hex => encodeFunctionData({ abi: morphoVaultV2Abi, functionName: "withdraw", args: [amount, receiver, safe] });

export async function readVaultEvents(client: Client, safe: Address, fromBlock: bigint): Promise<VaultEvent[]> {
  const head = await client.getBlockNumber();
  const deposits = await chunked(fromBlock, head, (a, b) => client.getLogs({ address: VAULT, event: morphoVaultV2Abi[11], args: { owner: safe }, fromBlock: a, toBlock: b }));
  const withdrawals = await chunked(fromBlock, head, (a, b) => client.getLogs({ address: VAULT, event: morphoVaultV2Abi[12], args: { owner: safe }, fromBlock: a, toBlock: b }));
  const all = [
    ...deposits.map((l) => ({ kind: "deposit" as const, assets: l.args.assets!, counterparty: l.args.owner!, block: l.blockNumber, idx: l.logIndex, txHash: l.transactionHash })),
    ...withdrawals.map((l) => ({ kind: "withdraw" as const, assets: l.args.assets!, counterparty: l.args.receiver!, block: l.blockNumber, idx: l.logIndex, txHash: l.transactionHash })),
  ].sort((x, y) => Number(x.block - y.block) || x.idx - y.idx);
  const recent = all.slice(-LEDGER_EVENTS);
  const times = new Map<bigint, number>();
  await Promise.all(
    [...new Set(recent.map((e) => e.block))].map(async (b) => {
      try {
        times.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp) * 1000);
      } catch {
        /* time unknown */
      }
    }),
  );
  return all.map(({ kind, assets, counterparty, txHash, block }) => ({ kind, assets, counterparty, txHash, timestamp: times.get(block) }));
}

export interface MorphoSnapshot extends Position {
  shares: bigint;
  /** USDG sitting idle in the vault (informational: a withdrawal can also be served by the vault's liquidity adapter). */
  idleAssets: bigint;
  events: VaultEvent[];
}

type Caller = Pick<PublicClient, "call">;

/**
 * Would the vault honour this exact withdrawal right now? Simulated as the Safe (eth_call), so liquidity limits, gates and
 * rounding are all included. Needed because VaultV2's maxWithdraw always returns 0 (see position.ts).
 */
export async function simulateWithdrawal(client: Caller, safe: Address, data: Hex): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await client.call({ account: safe, to: VAULT, data });
    return { ok: true };
  } catch {
    return { ok: false, reason: NO_LIQUIDITY_MESSAGE };
  }
}

/** Everything the dashboard needs for one Safe, from the vault itself. Refuses a vault whose asset is not USDG. */
export async function readMorphoAccount(client: Client, safe: Address, creationBlock: bigint): Promise<MorphoSnapshot> {
  const asset = (await client.readContract({ address: VAULT, abi: morphoVaultV2Abi, functionName: "asset" })) as Address;
  if (asset.toLowerCase() !== ROBINHOOD.usdg.toLowerCase()) throw new Error("The vault's asset is not USDG, so we stopped.");
  const shares = (await client.readContract({ address: VAULT, abi: morphoVaultV2Abi, functionName: "balanceOf", args: [safe] })) as bigint;
  const [assets, idleAssets, events] = await Promise.all([
    shares > 0n ? (client.readContract({ address: VAULT, abi: morphoVaultV2Abi, functionName: "convertToAssets", args: [shares] }) as Promise<bigint>) : Promise.resolve(0n),
    client.readContract({ address: ROBINHOOD.usdg, abi: erc20Abi, functionName: "balanceOf", args: [VAULT] }) as Promise<bigint>,
    readVaultEvents(client, safe, creationBlock),
  ]);
  return { shares, idleAssets, events, ...morphoPosition(events, safe, assets) };
}
