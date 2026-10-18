import type { ReactNode } from "react";
import { ButtonLink } from "../ui/Button";
import { Reveal, ScrollProgress, SplitWords, CursorGlow, MotionProvider } from "../ui/motion";
import { Footer } from "../landing/CtaFooter";
import { Nav } from "../landing/Nav";

export function PageShell({
  eyebrow,
  title,
  intro,
  next,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  next: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <MotionProvider>
      <ScrollProgress />
      <CursorGlow />
      <Nav />
      <main className="relative isolate overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70vh]">
          <div className="absolute -left-[10%] -top-[30%] h-[50vmax] w-[50vmax] animate-drift-a rounded-full bg-cyan/15 blur-[110px]" />
          <div className="absolute -right-[10%] -top-[20%] h-[40vmax] w-[40vmax] animate-drift-b rounded-full bg-emerald/15 blur-[110px]" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-bg" />
        </div>

        <header className="mx-auto max-w-4xl px-5 pb-12 pt-36 text-center sm:px-6 sm:pt-44">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-cyan">{eyebrow}</p>
          <h1 className="mt-5 text-[clamp(2.4rem,7.5vw,4.6rem)] font-extrabold leading-[1.02] tracking-[-0.04em]">
            <SplitWords as="span" text={title} wordClassName="text-gradient" delay={0.1} />
          </h1>
          <Reveal delay={0.3}>
            <p className="mx-auto mt-6 max-w-2xl text-[clamp(1rem,2.4vw,1.2rem)] leading-relaxed text-muted">{intro}</p>
          </Reveal>
        </header>

        {children}

        <section className="px-5 pb-28 pt-8 sm:px-6">
          <Reveal>
            <div className="mx-auto flex max-w-4xl flex-col items-center gap-5 rounded-[32px] border border-cyan/25 bg-[linear-gradient(160deg,rgba(0,240,255,0.10),rgba(16,185,129,0.04)_60%,transparent)] p-8 text-center shadow-[0_0_80px_-24px_rgba(0,240,255,0.5)] sm:p-12">
              <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Ready when you are.</h2>
              <p className="max-w-md text-muted">Early access is opening soon. Get in early, or keep exploring.</p>
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                <ButtonLink href="/#cta" arrow>
                  Get early access
                </ButtonLink>
                <ButtonLink href={next.href} variant="ghost" arrow>
                  Next: {next.label}
                </ButtonLink>
              </div>
            </div>
          </Reveal>
        </section>
      </main>
      <Footer />
    </MotionProvider>
  );
}

/** Standard content section: optional heading + body, consistent rhythm. */
export function Block({
  title,
  lead,
  children,
  width = "max-w-5xl",
}: {
  title?: string;
  lead?: string;
  children: ReactNode;
  width?: string;
}) {
  return (
    <section className="px-5 py-12 sm:px-6 sm:py-16">
      <div className={`mx-auto ${width}`}>
        {title && (
          <Reveal>
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-4xl">{title}</h2>
            {lead && <p className="mt-3 max-w-2xl text-muted sm:text-lg">{lead}</p>}
          </Reveal>
        )}
        <div className={title ? "mt-8" : ""}>{children}</div>
      </div>
    </section>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  const c = tone === "warn" ? "border-amber/30 bg-amber/5 text-amber" : "border-cyan/25 bg-cyan/5 text-cyan";
  return (
    <div className={`rounded-2xl border p-4 text-sm leading-relaxed sm:p-5 ${c}`}>
      <span className="text-fg/90">{children}</span>
    </div>
  );
}
