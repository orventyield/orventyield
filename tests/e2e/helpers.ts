import { expect, type Page } from "@playwright/test";

const FORK_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const FORK_RPC = "http://127.0.0.1:8545";

/** An EIP-6963 wallet whose RPC is the local Anvil fork (Arbitrum state), signing with Anvil's first key. */
export async function installForkWallet(page: Page) {
  await page.addInitScript(
    ({ account, fork }) => {
      const info = { uuid: "00000000-0000-4000-8000-0000000000f2", name: "Anvil Test Wallet", icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=", rdns: "test.anvil.wallet" };
      const call = (method: string, params: unknown[]) =>
        fetch(fork, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) })
          .then((r) => r.json())
          .then((j) => {
            if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
            return j.result;
          });
      const authorizedRef = { value: false };
      const w = window as unknown as { __rejectSign?: boolean; __rejectSend?: boolean; __holdSend?: boolean; __holding?: number; __releaseSend?: () => void; __sent?: { to: string; data: string }[] };
      w.__sent = [];
      // The wallet's own network can change under the app (the user switches in the wallet): emitted exactly like a real wallet.
      let chain = "0x7a69";
      const listeners: Record<string, ((v: unknown) => void)[]> = {};
      // The user disconnects (or locks) the wallet while the app is mid-flow: emitted exactly like a real wallet.
      (w as unknown as { __emitAccounts: (list: string[]) => void }).__emitAccounts = (list: string[]) => {
        if (list.length === 0) authorizedRef.value = false;
        (listeners.accountsChanged ?? []).forEach((f) => f(list));
      };
      (w as unknown as { __emitChain: (hex: string) => void }).__emitChain = (hex: string) => {
        chain = hex;
        (listeners.chainChanged ?? []).forEach((f) => f(hex));
      };
      const provider = {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === "eth_requestAccounts") {
            authorizedRef.value = true;
            return [account];
          }
          if (method === "eth_accounts") return authorizedRef.value ? [account] : [];
          if (method === "eth_chainId") return chain;
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "personal_sign" && w.__rejectSign) {
            w.__rejectSign = false;
            throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          }
          if (method === "eth_sendTransaction") {
            const tx = (params?.[0] ?? {}) as { to?: string; data?: string };
            w.__sent!.push({ to: String(tx.to), data: String(tx.data) });
            if (w.__rejectSend) {
              w.__rejectSend = false;
              throw Object.assign(new Error("User rejected the request."), { code: 4001 });
            }
            // Test hook: the wallet prompt stays open (the user has not decided yet) until __releaseSend() is called.
            if (w.__holdSend) {
              w.__holding = (w.__holding ?? 0) + 1;
              await new Promise<void>((res) => (w.__releaseSend = res));
              w.__holdSend = false;
            }
          }
          return call(method, params ?? []);
        },
        on(ev: string, f: (v: unknown) => void) {
          (listeners[ev] ??= []).push(f);
        },
        removeListener(ev: string, f: (v: unknown) => void) {
          listeners[ev] = (listeners[ev] ?? []).filter((x) => x !== f);
        },
      };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { account: FORK_ACCOUNT, fork: FORK_RPC },
  );
}

/** Connect the fork wallet; the Mainnet dashboard opens on the Card step that asks for one free wallet signature. */
export async function connectForkWallet(page: Page) {
  await installForkWallet(page);
  await page.goto("/dashboard");
  await page.getByTestId("connect-wallet").click();
  await page.getByTestId("wallet-option-test.anvil.wallet").click();
  await expect(page.getByTestId("mainnet-dashboard")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("card-step-login")).toBeVisible({ timeout: 30_000 });
}

/**
 * A minimal EIP-6963 wallet. It exposes accounts only after the user approves, and signs `personal_sign` through a
 * Node-side function so tests can use real keys. Pass `rpc` to forward everything else to a node (the Anvil fork).
 */
export async function installMockWallet(page: Page, account: string, sign: (message: string) => Promise<string>, chainHex = "0xa", rpc?: string) {
  await page.exposeFunction("__signMessage", async (hex: string) => {
    const bytes = hex.startsWith("0x") ? hex.slice(2) : hex;
    return sign(Buffer.from(bytes, "hex").toString("utf8"));
  });
  await page.addInitScript(
    ({ account, chainHex, rpc }) => {
      const info = {
        uuid: "00000000-0000-4000-8000-0000000000bb",
        name: "Test Wallet",
        icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
        rdns: "test.wallet",
      };
      let authorized = false;
      const provider = {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === "eth_requestAccounts") {
            authorized = true;
            return [account];
          }
          if (method === "eth_accounts") return authorized ? [account] : [];
          if (method === "eth_chainId") return chainHex;
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "personal_sign") return (window as unknown as { __signMessage: (m: string) => Promise<string> }).__signMessage(String(params?.[0]));
          // With an RPC (the Anvil fork) every other call is forwarded, so the app can read chain state.
          if (rpc) {
            const j = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params ?? [] }) }).then((r) => r.json());
            if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
            return j.result;
          }
          throw Object.assign(new Error("unsupported by mock"), { code: 4200 });
        },
        on() {},
        removeListener() {},
      };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { account, chainHex, rpc },
  );
}
