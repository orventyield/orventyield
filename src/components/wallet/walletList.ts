/**
 * Wallets we surface by name, with their WalletConnect deep links and install pages.
 * `rdns` is the EIP-6963 id a browser extension announces, used to match detected wallets.
 * Deep links follow each wallet's documented WalletConnect universal-link format.
 */
export interface KnownWallet {
  id: string;
  name: string;
  /** EIP-6963 reverse-DNS ids that identify the extension/in-app provider. */
  rdns: string[];
  /** Opens the wallet app and hands it the WalletConnect pairing URI (mobile). */
  deepLink?: (wcUri: string) => string;
  install: string;
  /** Brand colour for the avatar chip. */
  color: string;
}

const enc = encodeURIComponent;

export const KNOWN_WALLETS: KnownWallet[] = [
  {
    id: "metamask",
    name: "MetaMask",
    rdns: ["io.metamask", "io.metamask.flask"],
    deepLink: (uri) => `https://metamask.app.link/wc?uri=${enc(uri)}`,
    install: "https://metamask.io/download",
    color: "#F6851B",
  },
  {
    id: "trust",
    name: "Trust Wallet",
    rdns: ["com.trustwallet.app"],
    deepLink: (uri) => `https://link.trustwallet.com/wc?uri=${enc(uri)}`,
    install: "https://trustwallet.com/download",
    color: "#3375BB",
  },
  {
    id: "rainbow",
    name: "Rainbow",
    rdns: ["me.rainbow"],
    deepLink: (uri) => `https://rnbwapp.com/wc?uri=${enc(uri)}`,
    install: "https://rainbow.me/download",
    color: "#7B4DFF",
  },
  {
    id: "phantom",
    name: "Phantom",
    rdns: ["app.phantom"],
    install: "https://phantom.com/download",
    color: "#AB9FF2",
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    rdns: ["com.coinbase.wallet"],
    deepLink: (uri) => `https://go.cb-w.com/wc?uri=${enc(uri)}`,
    install: "https://www.coinbase.com/wallet/downloads",
    color: "#0052FF",
  },
];

export function findKnownWallet(rdns: string | undefined): KnownWallet | undefined {
  if (!rdns) return undefined;
  return KNOWN_WALLETS.find((w) => w.rdns.includes(rdns));
}

export function isMobileUserAgent(ua: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}
