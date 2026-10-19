import {
  concat, encodeFunctionData, encodePacked, getContractAddress, keccak256, pad, parseAbi,
  toHex, zeroAddress, type Address, type Hex, type PublicClient,
} from "viem";
import { ARBITRUM } from "../contracts/arbitrum";

export const safeFactoryAbi = parseAbi([
  "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "function proxyCreationCode() view returns (bytes)",
  "event ProxyCreation(address indexed proxy, address singleton)",
]);

export const safeAbi = parseAbi([
  "function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
  "function getOwners() view returns (address[])",
]);

export const multiSendAbi = parseAbi(["function multiSend(bytes transactions)"]);

export interface SafeSetup {
  initializer: Hex;
  saltNonce: bigint;
}

/** Deterministic per owner: the same wallet always maps to the same Safe, on any device, with no server. */
export function safeSetup(owner: Address): SafeSetup {
  const initializer = encodeFunctionData({
    abi: safeAbi,
    functionName: "setup",
    args: [[owner], 1n, zeroAddress, "0x", ARBITRUM.safeFallbackHandler, zeroAddress, 0n, zeroAddress],
  });
  const saltNonce = BigInt(keccak256(encodePacked(["string", "address"], ["orventyield.safe.v1:", owner])));
  return { initializer, saltNonce };
}

/** CREATE2 address of the Safe proxy. `creationCode` is the factory's proxyCreationCode(). */
export function predictSafeAddress(owner: Address, creationCode: Hex): Address {
  const { initializer, saltNonce } = safeSetup(owner);
  const salt = keccak256(concat([keccak256(initializer), pad(toHex(saltNonce), { size: 32 })]));
  return getContractAddress({
    opcode: "CREATE2",
    from: ARBITRUM.safeProxyFactory,
    salt,
    bytecode: concat([creationCode, pad(ARBITRUM.safeL2Singleton, { size: 32 })]),
  });
}

export const readCreationCode = (client: Pick<PublicClient, "readContract">): Promise<Hex> =>
  client.readContract({ address: ARBITRUM.safeProxyFactory, abi: safeFactoryAbi, functionName: "proxyCreationCode" }) as Promise<Hex>;

export interface InnerCall {
  to: Address;
  data: Hex;
  value?: bigint;
}

/** Pack calls for MultiSendCallOnly (operation 0 = CALL only, so no delegatecall surprises). */
export function packMultiSend(calls: InnerCall[]): Hex {
  return concat(
    calls.map((c) =>
      encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [0, c.to, c.value ?? 0n, BigInt((c.data.length - 2) / 2), c.data]),
    ),
  );
}

/**
 * Calldata for Safe.execTransaction signed by "being the sender": a pre-validated signature (v=1) is valid when the
 * owner itself is msg.sender, so no off-chain signing or private key handling is needed. Threshold must be 1.
 */
export function execCalldata(owner: Address, to: Address, data: Hex, operation: 0 | 1 = 0): Hex {
  const signature = concat([pad(owner, { size: 32 }), pad("0x00", { size: 32 }), "0x01"]);
  return encodeFunctionData({
    abi: safeAbi,
    functionName: "execTransaction",
    args: [to, 0n, data, operation, 0n, 0n, 0n, zeroAddress, zeroAddress, signature],
  });
}

/** One Safe call, or a MultiSendCallOnly batch for several. Returns the (to, data, operation) to pass to execTransaction. */
export function safeCall(calls: InnerCall[]): { to: Address; data: Hex; operation: 0 | 1 } {
  if (calls.length === 1) return { to: calls[0]!.to, data: calls[0]!.data, operation: 0 };
  return {
    to: ARBITRUM.safeMultiSendCallOnly,
    data: encodeFunctionData({ abi: multiSendAbi, functionName: "multiSend", args: [packMultiSend(calls)] }),
    operation: 1,
  };
}
