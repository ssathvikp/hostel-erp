import { cn } from "@/lib/cn";

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={cn("animate-spin", className)}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" className="opacity-75" />
    </svg>
  );
}
