"use client";

import { useId, useMemo, useState } from "react";
import type { Address } from "viem";
import { AmountDialog } from "@/components/dashboard/mainnet/AmountDialog";
import { TxSteps } from "@/components/dashboard/mainnet/TxSteps";
import { SourceSelector } from "@/components/dashboard/cards/SourceSelector";
import { Dialog } from "@/components/ui/Dialog";
import type { TxStep } from "@/features/account/useSafeAccount";
import { useLinkedCards } from "@/features/card/useLinkedCards";
import { fmtUsdc } from "@/lib/aave/format";
import { TEST_SEND, checkCardSend, providerFor, validateCardAddress, type CardNetwork, type CardSource, type CardStatus } from "@/lib/linkedCards/cards";

/** What the card section needs from whichever yield engine is on screen (Aave on Arbitrum One, Morpho on Robinhood Chain). */
export interface CardFunding {
  network: CardNetwork;
  owner?: Address;
  safe?: Address;
  /** Most earned yield / most deposited principal that can leave right now (6-decimal base units). */
  yieldMax: bigint;
  principalMax: bigint;
  payFromYield: (amount: bigint, to: Address, label: string) => Promise<boolean>;
  payFromPrincipal: (amount: bigint, to: Address, label: string) => Promise<boolean>;
  steps: TxStep[];
  busy: boolean;
  error: string | null;
  lastDone: string | null;
  clearMessages: () => void;
  /** Upfront "no ETH for gas" message, when the wallet cannot pay for a transaction. */
  gasWarning?: string | null;
  explorer?: string;
}

type Dialogs = null | "link" | "test" | "add";

const STATUS: Record<CardStatus, { label: string; tone: string }> = {
  linked: { label: "Step 2 of 3 · test it", tone: "border-amber/30 bg-amber/10 text-amber" },
  "test-sent": { label: "Step 3 of 3 · confirm", tone: "border-cyan/30 bg-cyan/10 text-cyan" },
  verified: { label: "Verified", tone: "border-emerald/30 bg-emerald/10 text-emerald" },
};

const primary = "min-h-12 rounded-xl bg-cyan px-6 text-sm font-semibold text-bg shadow-[0_0_30px_rgba(0,240,255,0.25)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "min-h-12 rounded-xl border border-white/10 px-5 text-sm font-semibold text-fg hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * "Link your card": get a card from the provider (its own site, its own KYC), link its deposit address here, prove the address
 * with a $1 test, then add money from earned yield (default) or principal. OrventYield never issues, holds or sees the card.
 */
export function LinkedCardPanel({ funding: f }: { funding: CardFunding }) {
  const provider = providerFor(f.network);
  const symbol = provider.token;
  const own = useMemo(() => [f.safe, f.owner], [f.safe, f.owner]);
  const store = useLinkedCards(f.owner, f.network, own);
  const card = store.cards.find((c) => c.provider === provider.id);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [source, setSource] = useState<CardSource>("yield");
  const [text, setText] = useState("");
  const [ack, setAck] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const ids = { link: useId(), test: useId() };

  const limit = source === "yield" ? f.yieldMax : f.principalMax;
  const noGas = !!f.gasWarning;
  const check = validateCardAddress(text, { network: f.network, own });
  const shownError = localError ?? f.error;
  // Why the test button is disabled, in words (e.g. not enough yield yet: the user can choose principal instead).
  const testCheck = checkCardSend({ status: card?.status ?? "linked", token: symbol }, "test", source, TEST_SEND, limit);

  const open = (d: Dialogs) => {
    f.clearMessages();
    setLocalError(null);
    if (d === "link") {
      setText("");
      setAck(false);
    }
    // Yield is always the starting choice. Principal is only ever used when the user picks it.
    if (d === "test" || d === "add") setSource("yield");
    setDialog(d);
  };
  const close = () => {
    if (f.busy) return; // a transaction is in flight: leave the dialog up until it settles
    setDialog(null);
    setLocalError(null);
    f.clearMessages();
  };

  /** Re-check the address and the step right before any money moves: nothing read from storage is ever trusted. */
  const send = async (kind: "test" | "add", amount: bigint) => {
    if (!card) return;
    const addr = validateCardAddress(card.address, { network: f.network, own });
    if (!addr.ok) return setLocalError(addr.reason);
    const ok = checkCardSend(card, kind, source, amount, limit);
    if (!ok.ok) return setLocalError(ok.reason);
    setLocalError(null);
    try {
      const label = `${provider.name} card`;
      const done = source === "yield" ? await f.payFromYield(amount, addr.address, label) : await f.payFromPrincipal(amount, addr.address, label);
      if (done && kind === "test") store.markTestSent(provider.id);
    } catch {
      setLocalError("Something went wrong. Nothing was sent. Please try again.");
    }
  };

  const destination = card && (
    <div data-testid="card-destination" className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs">
      <p className="font-mono uppercase tracking-wider text-muted">Sending to your {provider.name} card</p>
      <p className="mt-1 break-all font-mono text-sm text-fg">{card.address}</p>
      <p className="mt-1 text-muted">
        {provider.chainName} · {symbol}. Check these match what your {provider.name} app shows.
      </p>
    </div>
  );
  const selector = (
    <SourceSelector value={source} onChange={setSource} yieldAvailable={fmtUsdc(f.yieldMax)} principalAvailable={fmtUsdc(f.principalMax)} symbol={symbol} disabled={f.busy} />
  );

  return (
    <section data-testid="linked-card-panel" aria-label="Link your card" className="space-y-5 rounded-2xl glass-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-fg">Link your card</h2>
          <p className="mt-0.5 text-xs text-muted">Already have, or want, a {provider.name} card? Link it and put your yield on it in a few taps.</p>
        </div>
        <span data-testid="card-network-badge" className="rounded-full border border-emerald/30 bg-emerald/10 px-3 py-1 font-mono text-[11px] font-semibold text-emerald">
          {provider.chainName} · {symbol}
        </span>
      </div>

      {noGas && (
        <div role="alert" data-testid="card-no-gas" className="rounded-xl border border-amber/30 bg-amber/10 p-3 text-sm text-amber">
          {f.gasWarning}
        </div>
      )}

      {!card ? (
        <div data-testid="card-get" className="space-y-4">
          <ol className="space-y-2 text-sm text-muted">
            {provider.steps.map((s, i) => (
              <li key={s} className="flex gap-3">
                <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-cyan/30 bg-cyan/10 font-mono text-[11px] text-cyan">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a data-testid="card-provider-link" href={provider.siteUrl} target="_blank" rel="noopener noreferrer" className={`${secondary} inline-flex items-center justify-center`}>
              Open {provider.name} ↗
            </a>
            <button type="button" data-testid="link-card-open" onClick={() => open("link")} className={primary}>
              Link my card address
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="metal-card relative overflow-hidden rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-extrabold tracking-tight text-fg">{provider.name} card</span>
              <span data-testid="card-status" className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold ${STATUS[card.status].tone}`}>
                {STATUS[card.status].label}
              </span>
            </div>
            <p data-testid="linked-address" className="mt-4 break-all font-mono text-sm text-fg/90">{card.address}</p>
            <p className="mt-1 font-mono text-[11px] text-muted">{provider.chainName} · {symbol} deposit address</p>
          </div>

          <p className="font-mono text-[11px] text-muted">
            Available now: <span data-testid="card-yield-max" className="text-fg">{fmtUsdc(f.yieldMax)}</span> {symbol} yield ·{" "}
            <span data-testid="card-principal-max" className="text-fg">{fmtUsdc(f.principalMax)}</span> {symbol} principal
          </p>

          {card.status === "linked" && <p className="text-xs text-muted">Next: send a test of exactly $1.00 to prove the address is right. Only after you see it arrive can you add more.</p>}
          {card.status === "test-sent" && (
            <p className="text-xs text-muted">
              Open your {provider.name} app. If +1.00 {symbol} shows on your card, confirm below. If it does not show after a few minutes, <span className="font-semibold text-amber">do not add more</span>: remove this card and check the address.
            </p>
          )}
          {card.status === "verified" && <p className="text-xs text-muted">Ready. Add money any time: earned yield first, principal only if you choose it.</p>}

          <div className="flex flex-wrap gap-2">
            {card.status === "verified" ? (
              <button type="button" data-testid="card-add-open" disabled={noGas || (f.yieldMax <= 0n && f.principalMax <= 0n)} onClick={() => open("add")} className={primary}>
                Add money
              </button>
            ) : (
              <>
                {card.status === "test-sent" && (
                  <button type="button" data-testid="card-test-confirm" onClick={() => store.markVerified(provider.id)} className={primary}>
                    I see it in my card app
                  </button>
                )}
                <button type="button" data-testid="card-test-open" disabled={noGas || f.busy} onClick={() => open("test")} className={card.status === "test-sent" ? secondary : primary}>
                  {card.status === "test-sent" ? "Send test again" : "Send $1.00 test"}
                </button>
              </>
            )}
            <button type="button" data-testid="card-replace" onClick={() => open("link")} className={secondary}>
              Replace address
            </button>
            <button type="button" data-testid="card-unlink" onClick={() => store.unlink(provider.id)} className={secondary}>
              Remove
            </button>
          </div>
        </div>
      )}

      <p data-testid="card-caution" className="text-[11px] leading-relaxed text-muted">{provider.caution}</p>

      {/* 1. Link the address */}
      <Dialog open={dialog === "link"} onClose={close} labelledBy={ids.link} testId="card-link-dialog">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id={ids.link} className="text-lg font-bold text-fg">Link your {provider.name} card</h2>
            <p className="mt-1 text-xs text-muted">
              Paste the {symbol} deposit address for {provider.chainName} from your {provider.name} app.
              {card ? " Replacing the address means you will test it again." : ""}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={close} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-white/5 hover:text-fg">✕</button>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!check.ok || !ack) return;
            store.link(provider, check.address);
            setDialog(null);
          }}
        >
          <label className="block text-xs font-mono uppercase tracking-wider text-muted" htmlFor={`${ids.link}-addr`}>Deposit address</label>
          <input
            id={`${ids.link}-addr`}
            data-testid="card-address-input"
            data-autofocus
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="0x…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={text !== "" && !check.ok}
            className="min-h-12 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 font-mono text-sm text-fg outline-none focus:border-cyan/60"
          />
          {text !== "" && !check.ok && (
            <p role="alert" data-testid="card-address-error" className="text-xs text-danger">{check.reason}</p>
          )}
          {check.ok && (
            <div data-testid="card-address-ok" className="space-y-3 rounded-xl border border-emerald/30 bg-emerald/10 p-3 text-xs text-emerald">
              <p>
                Valid address on {provider.chainName}: <span className="break-all font-mono text-fg">{check.address}</span>
              </p>
              <label className="flex cursor-pointer items-start gap-2 text-fg">
                <input type="checkbox" data-testid="card-address-ack" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan" />
                <span>
                  I copied this from the {provider.name} app, for {symbol} on {provider.chainName}.
                </span>
              </label>
            </div>
          )}
          <p className="text-[11px] text-muted">Sending to the wrong network can lose your money for good, which is why the next step is a $1.00 test.</p>
          <button type="submit" data-testid="card-link-confirm" disabled={!check.ok || !ack} className={`${primary} w-full`}>
            Link card
          </button>
        </form>
      </Dialog>

      {/* 2. The $1.00 test */}
      <Dialog open={dialog === "test" && !!card} onClose={close} labelledBy={ids.test} testId="card-test-dialog" dismissible={!f.busy}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id={ids.test} className="text-lg font-bold text-fg">Send a $1.00 test</h2>
            <p className="mt-1 text-xs text-muted">We send exactly $1.00 {symbol} to the address below. When you see it in your {provider.name} app, confirm it. Only then can you add more.</p>
          </div>
          <button type="button" aria-label="Close" disabled={f.busy} onClick={close} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-white/5 hover:text-fg disabled:opacity-40">✕</button>
        </div>
        <div className="space-y-3">
          {destination}
          {selector}
          <ol data-testid="card-test-preview" className="space-y-1.5 rounded-xl border border-white/5 bg-white/[0.05] p-3 text-xs text-muted">
            <li className="font-mono text-[10px] uppercase tracking-wider text-muted/80">What will happen</li>
            <li>
              <span className="font-semibold text-fg">1. Send the test.</span> Your Safe withdraws exactly 1.00 {symbol} {source === "yield" ? "of earned yield" : "of your principal"} and sends it to that address in one transaction.
            </li>
          </ol>
          {!testCheck.ok && !f.busy && !f.lastDone && <p data-testid="card-test-hint" className="text-xs text-amber">{testCheck.reason}</p>}
          {f.steps.length > 0 && <TxSteps steps={f.steps} explorer={f.explorer} />}
          {shownError && <div role="alert" data-testid="card-send-error" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">{shownError}</div>}
          {dialog === "test" && f.lastDone ? (
            <>
              <div role="status" data-testid="card-test-sent" className="rounded-xl border border-emerald/30 bg-emerald/10 p-3 text-sm text-emerald">
                Test sent. Open your {provider.name} app and look for +1.00 {symbol}, then come back and confirm.
              </div>
              <button type="button" onClick={close} className={`${secondary} w-full`}>Done</button>
            </>
          ) : (
            <button type="button" data-testid="card-test-send" disabled={f.busy || noGas || !testCheck.ok} onClick={() => void send("test", TEST_SEND)} className={`${primary} w-full`}>
              {f.busy ? "Working…" : "Send $1.00 test"}
            </button>
          )}
        </div>
      </Dialog>

      {/* 3. Add money (verified cards only) */}
      <AmountDialog
        open={dialog === "add" && card?.status === "verified"}
        onClose={close}
        testId="card-add-dialog"
        networkBadge={`${provider.chainName} · ${symbol}`}
        asset={symbol}
        title={`Add money to your ${provider.name} card`}
        intro="Choose where the money comes from. It goes to the card address you verified."
        max={limit}
        maxLabel={source === "yield" ? "Earned yield available" : "Principal available"}
        confirmLabel="Add money"
        presets={[10, 25, 50, 100]}
        header={
          <div className="space-y-3">
            {destination}
            {selector}
          </div>
        }
        preview={[
          source === "yield"
            ? { label: "Send earned yield", detail: `Your Safe withdraws exactly this much earned yield and sends it to your ${provider.name} card address in one transaction. Principal is untouched.` }
            : { label: "Send principal", detail: `Your Safe withdraws exactly this much of your deposited principal and sends it to your ${provider.name} card address in one transaction. The rest keeps earning yield.` },
        ]}
        steps={f.steps}
        busy={f.busy}
        error={shownError}
        success={dialog === "add" ? f.lastDone : null}
        explorer={f.explorer}
        onSubmit={(v) => void send("add", v)}
      />
    </section>
  );
}
