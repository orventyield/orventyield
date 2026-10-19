import { Check, Close } from "../ui/Icons";
import { Reveal, SplitWords } from "../ui/motion";

const OLD = [
  "Sell your ETH to pay the bill",
  "Realise gains and trigger a tax event",
  "Lose your position and future upside",
  "Rebuy later at a worse price",
];
const NEW = [
  "Your principal stays locked and earning on Aave",
  "Spend only the yield, never a sale",
  "Yield keeps refilling what you can spend",
  "Your keys, your Safe, always",
];

export function Problem() {
  return (
    <section className="relative px-5 py-24 sm:px-6 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <p className="text-center font-mono text-xs uppercase tracking-[0.3em] text-cyan">The problem</p>
        <h2 className="mx-auto mt-5 max-w-3xl text-center text-[clamp(2rem,6vw,3.8rem)] font-extrabold leading-[1.05] tracking-[-0.035em]">
          <SplitWords text="Selling crypto to buy coffee is a bad trade." wordClassName="text-gradient" />
        </h2>

        <div className="mt-14 grid gap-5 md:grid-cols-2">
          <Reveal>
            <div className="glass h-full rounded-3xl p-7 sm:p-9">
              <p className="font-mono text-xs uppercase tracking-widest text-danger">The old way</p>
              <ul className="mt-6 space-y-4">
                {OLD.map((t) => (
                  <li key={t} className="flex items-start gap-3 text-muted">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-danger/15 text-danger">
                      <Close className="h-3.5 w-3.5" />
                    </span>
                    <span className="line-through decoration-danger/40 decoration-2">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={0.12}>
            <div className="relative h-full overflow-hidden rounded-3xl border border-cyan/30 bg-[linear-gradient(160deg,rgba(0,240,255,0.10),rgba(16,185,129,0.05)_60%,transparent)] p-7 shadow-[0_0_80px_-20px_rgba(0,240,255,0.5)] sm:p-9">
              <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cyan/25 blur-3xl" />
              <p className="relative font-mono text-xs uppercase tracking-widest text-cyan">The OrventYield way</p>
              <ul className="relative mt-6 space-y-4">
                {NEW.map((t) => (
                  <li key={t} className="flex items-start gap-3 text-fg">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald/20 text-emerald">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
