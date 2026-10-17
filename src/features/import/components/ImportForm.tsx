"use client";

import { useActionState, useState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Checkbox, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { cn } from "@/lib/cn";
import { focusRing } from "@/components/ui";

import type { ImportState } from "../actions";

type Action = (previous: ImportState, formData: FormData) => Promise<ImportState>;

const initial: ImportState = { id: "initial", status: "idle", fieldErrors: {} };

/**
 * Upload, check, then import (data import). Nothing is saved until the
 * file has no problems; the import itself is all or nothing.
 */
export function ImportForm({
  preview,
  commit,
  noun,
  columns,
  consentLabel,
}: {
  preview: Action;
  commit: Action;
  /** Plural, e.g. "rooms". */
  noun: string;
  columns: { key: string; label: string }[];
  /** A confirmation the importer must tick, e.g. residents' consent. */
  consentLabel?: string;
}) {
  const [checked, check, checking] = useActionState(preview, initial);
  const [committed, save, saving] = useActionState(commit, initial);
  // The step that ran last decides what is shown. A failed import that
  // re-checked the file carries its own summary; otherwise the check stays.
  const [last, setLast] = useState<"check" | "save">("check");
  const state = last === "save" && committed.total !== undefined ? committed : checked;
  const error = last === "save" ? committed.formError : checked.formError;
  const ready = state.ready ?? 0;
  const problems = state.problems ?? [];

  return (
    <div className="space-y-6">
      <form action={check} onSubmit={() => setLast("check")} className="space-y-4">
        <HostelField />
        <div>
          <label htmlFor="import-file" className="block text-sm font-medium text-slate-700">
            CSV file
          </label>
          <input
            id="import-file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className={cn(
              "mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-200",
              focusRing,
            )}
          />
          <p className="mt-1 text-xs text-slate-500">
            Save the spreadsheet as CSV first. Up to 500 rows per file.
          </p>
        </div>
        <Button type="submit" variant="secondary" loading={checking}>
          Check file
        </Button>
      </form>

      {error && <Alert tone="error">{error}</Alert>}

      {state.total !== undefined && (
        <section aria-labelledby="check-heading" className="space-y-4">
          <h2 id="check-heading" className="text-base font-semibold text-slate-900">
            {state.fileName ?? "Your file"}: {ready} of {state.total} {noun} ready
          </h2>

          {problems.length > 0 ? (
            <>
              <Alert tone="warning" title="Fix these rows in the spreadsheet, then check it again">
                Nothing has been imported. Line numbers count the header as line 1.
              </Alert>
              <Table caption="Rows with problems">
                <THead>
                  <tr>
                    <Th>Line</Th>
                    <Th>Problem</Th>
                  </tr>
                </THead>
                <TBody>
                  {problems.map((problem) => (
                    <Tr key={problem.line}>
                      <Td className="tabular-nums">{problem.line}</Td>
                      <Td className="whitespace-normal">{problem.errors.join("; ")}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </>
          ) : (
            <>
              {state.sample && state.sample.length > 0 && (
                <Table caption={`First ${state.sample.length} ${noun}`}>
                  <THead>
                    <tr>
                      {columns.map((column) => (
                        <Th key={column.key}>{column.label}</Th>
                      ))}
                    </tr>
                  </THead>
                  <TBody>
                    {state.sample.map((row, i) => (
                      <Tr key={i}>
                        {columns.map((column) => (
                          <Td key={column.key}>{row[column.key] ?? "—"}</Td>
                        ))}
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
              <form action={save} onSubmit={() => setLast("save")} noValidate className="space-y-4">
                <HostelField />
                <input type="hidden" name="csv" value={state.csv ?? ""} />
                <input type="hidden" name="file_name" value={state.fileName ?? ""} />
                {consentLabel && (
                  <Checkbox id="import-consent" name="consent" required label={consentLabel} />
                )}
                <Button type="submit" loading={saving}>
                  Import {ready} {noun}
                </Button>
              </form>
            </>
          )}
        </section>
      )}
    </div>
  );
}
