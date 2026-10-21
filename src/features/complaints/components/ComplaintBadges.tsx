import { Badge } from "@/components/ui";

import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
  type ComplaintStatus,
  type Priority,
} from "../options";
import { targetStates, worstTarget, type TargetState } from "../targets";

export function StatusBadge({ status }: { status: ComplaintStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === "normal" || priority === "low") {
    return <span className="text-xs text-slate-500">{PRIORITY_LABELS[priority]}</span>;
  }
  return (
    <Badge tone={priority === "urgent" ? "danger" : "warning"}>{PRIORITY_LABELS[priority]}</Badge>
  );
}

const TARGET_TEXT: Record<TargetState, string | null> = {
  missed: "Late",
  near: "Due soon",
  ok: null,
  met: null,
};

/** "Late" or "Due soon" against the response and fix targets (ClickUp EP-15 T10). */
export function TargetBadge({
  complaint,
}: {
  complaint: {
    createdAt: string;
    respondBy: string | null;
    resolveBy: string | null;
    firstResponseAt: string | null;
    resolvedAt: string | null;
  };
}) {
  const worst = worstTarget(targetStates(complaint));
  const text = TARGET_TEXT[worst];
  if (!text || complaint.resolvedAt) return null;
  return <Badge tone={worst === "missed" ? "danger" : "warning"}>{text}</Badge>;
}
