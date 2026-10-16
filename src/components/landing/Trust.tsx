import { Check } from "../ui/Icons";
import { CountUp, Reveal, SplitWords } from "../ui/motion";

const STATS = [
  { to: 0, label: "smart contracts deployed by us", suffix: "" },
  { to: 0, label: "backends or databases", suffix: "" },
  { to: 100, label: "self-custody", suffix: "%" },
  { to: 0, label: "monthly hosting cost", prefix: "$" },
];

const POINTS = [
  "Built on Ether.fi's existing, deployed cash-v3 contracts",
  "Every transaction is simulated before you sign it",
  "Exact-amount approvals only, never unlimited",
  "You always see the contract, function and amount",
  "No private keys or seed phrases, ever",
  "Third-party widgets run sandboxed, with no wallet access",
];

export function TrustBody() {
  return (
    <>
        <div className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-line bg-line lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="bg-surface px-5 py-8 text-center sm:py-10">
              <CountUp
                to={s.to}
                prefix={s.prefix}
                suffix={s.suffix}
                className="text-gradient font-mono text-4xl font-extrabold sm:text-5xl"
              />
              <p className="mt-2 text-xs text-muted sm:text-sm">{s.label}</p>
            </div>
          ))}
        </div>

        <Reveal className="mt-8">
          <ul className="grid gap-3 sm:grid-cols-2">
            {POINTS.map((p) => (
              <li key={p} className="glass flex items-start gap-3 rounded-2xl p-4">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald/15 text-emerald">
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span className="text-sm text-fg/90 sm:text-base">{p}</span>
              </li>
            ))}
          </ul>
        </Reveal>
    </>
  );
}

export function Trust() {
  return (
    <section id="security" className="relative px-5 py-24 sm:px-6 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <p className="text-center font-mono text-xs uppercase tracking-[0.3em] text-cyan">Security</p>
        <h2 className="mx-auto mt-5 max-w-3xl text-center text-[clamp(2rem,6vw,3.8rem)] font-extrabold leading-[1.05] tracking-[-0.035em]">
          <SplitWords text="Less surface area. More peace of mind." wordClassName="text-gradient" />
        </h2>

        <TrustBody />
      </div>
    </section>
  );
}
