import Link from "next/link";

import { Badge, Button, buttonClass, Input, Select } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import type { HostelStatus } from "@/types";

/** A plain GET search form: the query lives in the URL. */
export function SearchBar({
  action,
  q,
  placeholder,
  status,
}: {
  action: string;
  q: string;
  placeholder: string;
  status?: { value: string };
}) {
  return (
    <form
      action={action}
      method="get"
      role="search"
      className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="min-w-56 flex-1">
        <Input
          id="q"
          name="q"
          type="search"
          label="Search"
          placeholder={placeholder}
          defaultValue={q}
        />
      </div>
      {status && (
        <div className="w-44">
          <Select
            id="status"
            name="status"
            label="Status"
            placeholder="Any status"
            options={[
              { value: "active", label: "Active" },
              { value: "draft", label: "In setup" },
              { value: "suspended", label: "Suspended" },
            ]}
            defaultValue={status.value}
          />
        </div>
      )}
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  );
}

export function Pager({
  page,
  total,
  size,
  href,
}: {
  page: number;
  total: number;
  size: number;
  href: (page: number) => string;
}) {
  const last = Math.max(1, Math.ceil(total / size));
  if (last <= 1) return null;
  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex items-center justify-end gap-2 text-sm text-slate-600"
    >
      {page > 1 && (
        <Link href={href(page - 1)} className={buttonClass({ variant: "secondary", size: "sm" })}>
          Previous
        </Link>
      )}
      <span>
        Page {page} of {last}
      </span>
      {page < last && (
        <Link href={href(page + 1)} className={buttonClass({ variant: "secondary", size: "sm" })}>
          Next
        </Link>
      )}
    </nav>
  );
}

const STATUS: Record<HostelStatus, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  draft: { label: "In setup", tone: "warning" },
  suspended: { label: "Suspended", tone: "danger" },
};

export function HostelStatusBadge({ status }: { status: HostelStatus }) {
  return <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
}

export function pageFrom(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 1 ? page : 1;
}

export function queryFrom(value: string | undefined): string {
  return (value ?? "")
    .replace(/[%_\\]/g, " ")
    .trim()
    .slice(0, 60);
}
