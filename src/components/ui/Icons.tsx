import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function Base({ children, ...p }: P) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...p}
    >
      {children}
    </svg>
  );
}

export const ArrowRight = (p: P) => (
  <Base {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Base>
);
export const Check = (p: P) => (
  <Base {...p}>
    <path d="M5 13l4 4L19 7" />
  </Base>
);
export const Plus = (p: P) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);
export const Menu = (p: P) => (
  <Base {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Base>
);
export const Close = (p: P) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Base>
);
export const Shield = (p: P) => (
  <Base {...p}>
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
    <path d="M9 12l2 2 4-4" />
  </Base>
);
export const Bolt = (p: P) => (
  <Base {...p}>
    <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
  </Base>
);
export const CardIcon = (p: P) => (
  <Base {...p}>
    <rect x="2" y="5" width="20" height="14" rx="3" />
    <path d="M2 10h20" />
  </Base>
);
export const Wallet = (p: P) => (
  <Base {...p}>
    <path d="M3 7a2 2 0 012-2h12v4M3 7v10a2 2 0 002 2h14a1 1 0 001-1v-3M3 7h15a2 2 0 012 2v2h-4a2 2 0 000 4h4" />
  </Base>
);
export const Gift = (p: P) => (
  <Base {...p}>
    <path d="M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 110-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 100-5C13 2 12 7 12 7z" />
  </Base>
);
export const Bank = (p: P) => (
  <Base {...p}>
    <path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18" />
  </Base>
);
export const Snow = (p: P) => (
  <Base {...p}>
    <path d="M12 2v20M4.9 7l14.2 10M4.9 17L19.1 7" />
  </Base>
);
export const Repeat = (p: P) => (
  <Base {...p}>
    <path d="M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3" />
  </Base>
);
export const Layers = (p: P) => (
  <Base {...p}>
    <path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" />
  </Base>
);
export const Contactless = (p: P) => (
  <Base {...p}>
    <path d="M8 8a6 6 0 010 8M12 5a10 10 0 010 14M16 2a14 14 0 010 20" />
  </Base>
);

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="9" fill="none" stroke="#00F0FF" strokeWidth="4" />
      <circle cx="23" cy="9" r="3.2" fill="#10B981" />
    </svg>
  );
}
