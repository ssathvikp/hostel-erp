import { COLUMNS, templateCsv, type ImportKind } from "../spec";

/** The columns a file needs and a template to start from. */
export function ImportHelp({ kind, notes }: { kind: ImportKind; notes: string[] }) {
  const template = templateCsv(kind);
  const href = `data:text/csv;charset=utf-8,${encodeURIComponent(template)}`;

  return (
    <section
      aria-labelledby="columns-heading"
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
    >
      <h2 id="columns-heading" className="text-base font-semibold text-slate-900">
        What the file needs
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        The first row names the columns, in any order. Extra columns are ignored.
      </p>
      <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
        {COLUMNS[kind].map((column) => (
          <li key={column.key}>
            <code className="rounded bg-slate-100 px-1 text-slate-800">{column.key}</code>{" "}
            <span className="text-slate-600">{column.required ? "required" : "optional"}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <a
        href={href}
        download={`${kind}-template.csv`}
        className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline"
      >
        Download a template
      </a>
    </section>
  );
}
