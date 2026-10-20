/** Crisp, dependency-free card hardware drawn as SVG: EMV chip, contactless wave and the Mastercard mark. */

export function ChipEmblem({ className = "h-9 w-12" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 36" className={className} role="img" aria-label="EMV chip">
      <defs>
        <linearGradient id="chipGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6e3a1" />
          <stop offset="0.5" stopColor="#c9a24a" />
          <stop offset="1" stopColor="#8a6a22" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="34" rx="6" fill="url(#chipGold)" stroke="rgba(255,255,255,0.35)" />
      <g fill="none" stroke="rgba(60,40,5,0.55)" strokeWidth="1">
        <path d="M1 12h14v12H1M47 12H33v12h14M15 1v34M33 1v34M15 18h18" />
        <rect x="15" y="12" width="18" height="12" rx="3" />
      </g>
    </svg>
  );
}

export function ContactlessWave({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Contactless" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M8 6.5a8 8 0 0 1 0 11" />
      <path d="M12 4a12 12 0 0 1 0 16" opacity="0.8" />
      <path d="M16 1.5a16 16 0 0 1 0 21" opacity="0.6" />
    </svg>
  );
}

/** Mastercard mark: two overlapping circles with the blended centre. */
export function MastercardMark({ className = "h-8 w-12" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 30" className={className} role="img" aria-label="Mastercard">
      <circle cx="17" cy="15" r="13" fill="#EB001B" />
      <circle cx="31" cy="15" r="13" fill="#F79E1B" />
      <path d="M24 4.3a13 13 0 0 1 0 21.4 13 13 0 0 1 0-21.4Z" fill="#FF5F00" />
    </svg>
  );
}
