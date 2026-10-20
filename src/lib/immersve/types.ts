/** Shapes verified against the Immersve sandbox (docs.immersve.com, test.immersve.com). Only fields we use. */

export interface ImmersveConfig {
  baseUrl: string;
  clientApplicationId: string;
  partnerAccountId: string;
  cardProgramId: string;
  fundingChannelId: string;
  /**
   * Pinned Funds Storage address (production). When set, the channel's storage address MUST equal it, so a wrong or
   * tampered response can never redirect a deposit. Immersve provides it with production access.
   */
  fundsStorageAddress?: string;
  /** Network name used for SIWE login, e.g. "arbitrum-mainnet" or (sandbox) "polygon-amoy". */
  network: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  cardholderAccountId: string;
}

export interface Region {
  code: string;
  title: string;
  isAvailable: boolean;
}

export interface FundingSource {
  id: string;
  accountId: string;
  fundingChannelId: string;
  /** USDC base units (6 decimals) as a decimal string, e.g. "5000000" = $5.00. */
  balance: string;
  balanceCurrency: string;
}

/** Seen in the sandbox: the simulator channel has mode "deposit" and no params; Universal EVM channels carry params.storageAddress. */
export interface FundingChannel {
  id: string;
  fundingTypeName: string;
  mode: string;
  params: { storageAddress?: string; [k: string]: unknown };
}

/**
 * Response of POST /api/funding-sources/:id/withdraw. The funding source is debited immediately and the interaction stays
 * "Pending". Sandbox: `execution` is {url, payload}. Production: `execution.params` describes the contract call (docs: contract
 * address, ABI, method and parameters); its exact keys are not in the public docs, so funding.ts validates them strictly.
 */
export interface WithdrawalIntent {
  id: string;
  amount: number | string;
  expiresAt: string;
  execution: { url?: string; payload?: { amount?: string; fundingSourceId?: string; id?: string; expiresAt?: string }; params?: unknown; [k: string]: unknown };
}

/** A card payment as listed by GET /api/accounts/:id/transactions (amounts in USD cents). */
export interface CardTransaction {
  id: string;
  amount: string;
  currency: string;
  status: string;
  transactionDate: string;
  cardAcceptor?: { name?: string; city?: string; countryCode?: string };
  creditDebitIndicator?: string;
  paymentType?: string;
}

export type PrerequisiteStatus = "ok" | "pending" | "action-required" | string;

export interface Prerequisite {
  stage: "funding" | "kyc" | "aml" | string;
  status: PrerequisiteStatus;
  actionType?: string;
  params?: { kycUrl?: string; status?: string; [k: string]: unknown };
}

export interface Card {
  id: string;
  type: string;
  /** Seen in the sandbox: "active". */
  status: string;
  isBlocked?: boolean;
  /** YYYYMM, e.g. "203006". */
  expiry: string;
  panFirst6: string;
  panLast4: string;
  regionCode?: string;
  cardholderName?: string;
  fundingSourceIds?: string[];
}

/** Sensitive data. Hold in component state only; never log, persist or send to our own servers. */
export interface CardSecrets {
  pan: string;
  expiry: string;
  cvv2: string;
  embossedName: string;
}

export type CardReadiness =
  | { state: "kyc-required"; kycUrl: string }
  | { state: "pending" }
  | { state: "ready" };
