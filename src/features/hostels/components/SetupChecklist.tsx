import Link from "next/link";

import { cn } from "@/lib/cn";
import {
  completedSteps,
  SETUP_STEP_LABELS,
  SETUP_STEP_LINKS,
  SETUP_STEPS,
  type SetupFacts,
} from "@/lib/hostels/activation";

/**
 * The set-up steps with what is done (plan E15-T2). Owners get a link to
 * each step still to do; the admin console shows the list read-only.
 */
export function SetupChecklist({ facts, links = false }: { facts: SetupFacts; links?: boolean }) {
  const done = completedSteps(facts);
  return (
    <ol className="space-y-2 text-sm">
      {SETUP_STEPS.map((step) => (
        <li key={step} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded-full text-xs font-bold",
              done[step] ? "bg-emerald-600 text-white" : "border border-slate-300 text-transparent",
            )}
          >
            ✓
          </span>
          <span className="sr-only">{done[step] ? "Done:" : "To do:"}</span>
          {links && !done[step] ? (
            <Link href={SETUP_STEP_LINKS[step]} className="font-medium text-brand-700 underline">
              {SETUP_STEP_LABELS[step]}
            </Link>
          ) : (
            <span className={done[step] ? "text-slate-500" : "text-slate-900"}>
              {SETUP_STEP_LABELS[step]}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
