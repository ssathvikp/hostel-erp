import { cn } from "@/lib/cn";

const STEPS = ["Hostel details", "Address and capacity"] as const;

/** Progress indicator for the two-step onboarding wizard. */
export function OnboardingSteps({ current }: { current: 1 | 2 }) {
  return (
    <ol className="mb-6 flex items-center gap-3 text-sm" aria-label="Setup progress">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const state = step < current ? "done" : step === current ? "current" : "upcoming";
        return (
          <li
            key={label}
            className="flex items-center gap-2"
            aria-current={state === "current" ? "step" : undefined}
          >
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full text-xs font-semibold",
                state === "upcoming"
                  ? "border border-slate-300 text-slate-500"
                  : "bg-brand-600 text-white",
              )}
            >
              {state === "done" ? "✓" : step}
              <span className="sr-only">
                {state === "done" ? " (completed)" : state === "current" ? " (current)" : ""}
              </span>
            </span>
            <span
              className={cn(state === "upcoming" ? "text-slate-500" : "font-medium text-slate-900")}
            >
              {label}
            </span>
            {step < STEPS.length && <span aria-hidden="true" className="h-px w-8 bg-slate-300" />}
          </li>
        );
      })}
    </ol>
  );
}
