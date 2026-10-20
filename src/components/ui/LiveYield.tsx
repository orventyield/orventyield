/** A live, ticking number with a breathing aura and glowing numerals. `value` is already formatted by the caller. */
export function LiveYield({ value, testId, live = true, tone = "emerald" }: { value: string; testId: string; live?: boolean; tone?: "emerald" | "cyan" }) {
  return (
    <span className="relative inline-flex items-baseline">
      {live && <span aria-hidden="true" className={`aura pointer-events-none absolute -inset-x-6 -inset-y-3 rounded-full blur-2xl ${tone === "emerald" ? "bg-emerald/30" : "bg-cyan/25"}`} />}
      <span data-testid={testId} className={`relative text-3xl font-extrabold tracking-tight tabular ${tone === "emerald" ? "glow-emerald" : "glow-cyan"}`}>
        {value}
      </span>
    </span>
  );
}
