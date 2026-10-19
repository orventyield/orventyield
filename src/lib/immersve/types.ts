/** Shapes verified against the Immersve sandbox (docs.immersve.com, test.immersve.com). Only fields we use. */

export interface ImmersveConfig {
  baseUrl: string;
  clientApplicationId: string;
  partnerAccountId: string;
  cardProgramId: string;
  fundingChannelId: string;
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
  balance: string;
  balanceCurrency: string;
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
  | { state: "funding-required" }
  | { state: "ready" };
