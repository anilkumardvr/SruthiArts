import type { SVGProps } from "react";

// Brand marks aren't in lucide, so they live here (same drawings as the old site).
export function InstagramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PayPalIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" {...props}>
      <path d="M7.3 21H4.1a.5.5 0 0 1-.5-.6L6.4 3.5A.6.6 0 0 1 7 3h6.4c3.3 0 5.3 1.7 4.8 4.8-.6 3.6-3 5.3-6.4 5.3H9.9a.6.6 0 0 0-.6.5L8.4 19.3" />
      <path d="M19.6 8.6c.9.8 1.2 2 .9 3.6-.6 3.4-2.9 4.9-6 4.9h-1.2a.6.6 0 0 0-.6.5l-.7 3.8a.5.5 0 0 1-.5.4H9.3" opacity=".6" />
    </svg>
  );
}
