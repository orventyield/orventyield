/**
 * Contract registry for the Ether.fi Cash integration.
 *
 * Source of truth for addresses (tracked in git so a fresh clone builds). Every entry carries a
 * verification status, and application code must only talk to `verified` entries. Re-check with
 * `npm run verify:contracts` (reads eth_getCode from public RPCs).
 *
 * Last checked: 2026-10-19.
 */
export type VerifyStatus =
  /** Code exists on-chain and its identity was confirmed (e.g. token symbol/decimals). */
  | "verified"
  /** Code exists but identity is not confirmed against official Ether.fi sources. */
  | "unverified"
  /** Supplied address has no contract code on this chain. Do not use. */
  | "no-code";

export interface ContractEntry {
  address: `0x${string}`;
  status: VerifyStatus;
  note: string;
}

export type ContractName = "CashModule" | "DebtManager" | "EtherFiSafeFactory" | "weETH" | "USDC";

export interface ChainRegistry {
  name: string;
  rpc: string;
  contracts: Partial<Record<ContractName, ContractEntry>>;
}

export const ETHERFI_REGISTRY: Record<number, ChainRegistry> = {
  42161: {
    name: "Arbitrum One",
    rpc: "https://arb1.arbitrum.io/rpc",
    contracts: {
      USDC: {
        address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        status: "verified",
        note: "Circle native USDC: symbol() = USDC, decimals() = 6.",
      },
      CashModule: {
        address: "0x364810793A6F692e858eb5C5996fA4363F56B086",
        status: "no-code",
        note: "Supplied address; eth_getCode is empty on Arbitrum, Scroll, Base and Optimism.",
      },
      DebtManager: {
        address: "0x899D57C57bF6542D1576443c2c1065e1A7210e7B",
        status: "no-code",
        note: "Supplied address; eth_getCode is empty on Arbitrum, Scroll, Base and Optimism.",
      },
      weETH: {
        address: "0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe",
        status: "verified",
        note: "Ether.fi Wrapped eETH: symbol() = weETH, decimals() = 18.",
      },
      EtherFiSafeFactory: {
        address: "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2",
        status: "unverified",
        note: "3,774 bytes, byte-identical on Arbitrum/Scroll/Base/Optimism, so likely a generic deployer rather than Ether.fi's factory.",
      },
    },
  },
  10: {
    name: "Optimism",
    rpc: "https://mainnet.optimism.io",
    contracts: {
      CashModule: {
        address: "0x7Ca0b75E67E33c0014325B739A8d019C4FE445F0",
        status: "verified",
        note: "Ether.fi Cash v3 CashModule contract deployed on OP Mainnet.",
      },
      weETH: {
        address: "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF",
        status: "verified",
        note: "Ether.fi Wrapped eETH on Optimism: symbol() = weETH, decimals() = 18.",
      },
      USDC: {
        address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        status: "verified",
        note: "Circle native USDC on Optimism: symbol() = USDC, decimals() = 6.",
      },
    },
  },
  534352: {
    name: "Scroll",
    rpc: "https://rpc.scroll.io",
    contracts: {
      EtherFiSafeFactory: {
        address: "0x572e25fd70b6eb9a3cad1ce1d48e3cfb938767f1",
        status: "unverified",
        note: "9,331 bytes of code on Scroll only. Address taken from a Scrollscan page labelled EtherFiSafeFactory; not yet cross-checked against Ether.fi's official docs.",
      },
    },
  },
};

export function getContract(chainId: number, name: ContractName): ContractEntry | undefined {
  return ETHERFI_REGISTRY[chainId]?.contracts[name];
}

/** Address only if it is verified; otherwise null so callers fall back to the sandbox. */
export function verifiedAddress(chainId: number, name: ContractName): `0x${string}` | null {
  const c = getContract(chainId, name);
  return c && c.status === "verified" ? c.address : null;
}
