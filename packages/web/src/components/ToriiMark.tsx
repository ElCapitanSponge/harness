import { cn } from "@/lib/utils";

// The mark: a torii gate. It takes its colour from the text, so it follows the theme.
export const ToriiMark = ({ className }: { className?: string }) => {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={cn("size-5", className)} aria-hidden>
      <path d="M2 6Q12 9.2 22 6" strokeWidth="2.4" />
      <path d="M5 11H19" strokeWidth="1.8" />
      <path d="M7 8.6V21M17 8.6V21" strokeWidth="2.4" />
    </svg>
  );
};
