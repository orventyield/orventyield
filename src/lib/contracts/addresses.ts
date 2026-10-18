import contractsConfig from "../../../config/contracts.json";

export interface ChainContracts {
  name: string;
  EtherFiSafeFactory: string;
  CashModule: string;
  DebtManager: string;
  weETH: string;
  PriceProvider: string;
}

export const SUPPORTED_CHAINS = contractsConfig.chains as Record<string, ChainContracts>;

export function getContractsForChain(chainId: number): ChainContracts | null {
  return SUPPORTED_CHAINS[chainId.toString()] || null;
}
