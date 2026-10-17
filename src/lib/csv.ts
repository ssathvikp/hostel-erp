/**
 * A small CSV reader for spreadsheet exports (Excel, Google Sheets, LibreOffice):
 * commas or semicolons, double-quoted fields with "" escapes and line
 * breaks inside quotes, CRLF or LF line ends, and a UTF-8 byte-order mark.
 * Blank lines are skipped.
 */
export interface CsvRow {
  cells: string[];
  /** Line in the file where the row starts (1-based), as a spreadsheet shows it. */
  line: number;
}

/** Like `parseCsv`, with the file line each row starts on (for error messages). */
export function parseCsvRows(text: string): CsvRow[] {
  const input = text.replace(/^\uFEFF/, "");
  const firstLine = input.slice(0, input.search(/\r?\n|$/));
  // Excel in many locales saves with semicolons; pick whichever the header uses.
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowStart = 1;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        // A line break inside quotes is part of the cell, but still a line.
        if (char === "\n" || (char === "\r" && input[i + 1] !== "\n")) line++;
        field += char;
      }
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push({ cells: row, line: rowStart });
      row = [];
      field = "";
      line++;
      rowStart = line;
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push({ cells: row, line: rowStart });
  }
  return rows.filter((entry) => entry.cells.some((cell) => cell.trim() !== ""));
}

export function parseCsv(text: string): string[][] {
  return parseCsvRows(text).map((entry) => entry.cells);
}
