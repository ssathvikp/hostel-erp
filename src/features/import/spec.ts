/**
 * What a rooms or residents spreadsheet must contain and how each row is
 * read (data import). Pure, so the same rules run in the preview, the
 * import and the tests. Rows are validated with the same schemas as the
 * forms, so an imported record is exactly as clean as a typed one.
 */
import { parseCsv } from "@/lib/csv";
import { residentSchema, roomSchema, validate } from "@/lib/validation";
import type { z } from "zod";

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 512 * 1024;

export type ImportKind = "rooms" | "residents";

interface Column {
  key: string;
  label: string;
  required: boolean;
  /** Other header spellings people use. */
  aliases?: string[];
  example: string;
}

export const COLUMNS: Record<ImportKind, Column[]> = {
  rooms: [
    {
      key: "room_number",
      label: "Room number",
      required: true,
      aliases: ["room", "room no"],
      example: "101",
    },
    { key: "floor", label: "Floor", required: true, example: "1" },
    {
      key: "sharing_type",
      label: "Sharing",
      required: true,
      aliases: ["sharing type", "type"],
      example: "double",
    },
    {
      key: "capacity",
      label: "Beds",
      required: false,
      aliases: ["capacity", "beds"],
      example: "2",
    },
  ],
  residents: [
    {
      key: "full_name",
      label: "Full name",
      required: true,
      aliases: ["name"],
      example: "Ravi Kumar",
    },
    {
      key: "phone",
      label: "Mobile",
      required: true,
      aliases: ["mobile", "phone number"],
      example: "9876543210",
    },
    { key: "gender", label: "Gender", required: true, example: "male" },
    {
      key: "dob",
      label: "Date of birth",
      required: true,
      aliases: ["date of birth", "birth date"],
      example: "14-05-2002",
    },
    {
      key: "id_proof_type",
      label: "ID proof type",
      required: true,
      aliases: ["id type"],
      example: "aadhaar",
    },
    {
      key: "id_proof_number",
      label: "ID proof number",
      required: true,
      aliases: ["id number"],
      example: "2345 6789 0123",
    },
    {
      key: "permanent_address",
      label: "Permanent address",
      required: true,
      aliases: ["address"],
      example: "12 Station Road, Vijayawada",
    },
    {
      key: "joining_date",
      label: "Joining date",
      required: true,
      aliases: ["joined", "joining"],
      example: "01-06-2026",
    },
    { key: "email", label: "Email", required: false, example: "" },
    {
      key: "alt_phone",
      label: "Alternate mobile",
      required: false,
      aliases: ["alternate mobile", "alt mobile"],
      example: "",
    },
    {
      key: "guardian_name",
      label: "Guardian name",
      required: false,
      aliases: ["guardian"],
      example: "",
    },
    {
      key: "guardian_phone",
      label: "Guardian mobile",
      required: false,
      aliases: ["guardian mobile"],
      example: "",
    },
    { key: "notes", label: "Notes", required: false, example: "" },
  ],
};

/** The header and one example row, for the template people copy. */
export function templateCsv(kind: ImportKind): string {
  const columns = COLUMNS[kind];
  const quote = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [columns.map((c) => c.key), columns.map((c) => quote(c.example))]
    .map((row) => row.join(","))
    .join("\n");
}

const normaliseHeader = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .replace(/\.$/, "");

/** Values people type for sharing types and documents, mapped to stored ones. */
const SHARING_WORDS: Record<string, string> = {
  "1": "single",
  single: "single",
  "2": "double",
  double: "double",
  "3": "triple",
  triple: "triple",
  "4+": "four_plus",
  "4 or more": "four_plus",
  four: "four_plus",
  "four plus": "four_plus",
  four_plus: "four_plus",
};
const DEFAULT_CAPACITY: Record<string, string> = { single: "1", double: "2", triple: "3" };
const ID_WORDS: Record<string, string> = {
  aadhaar: "aadhaar",
  aadhar: "aadhaar",
  pan: "pan",
  "pan card": "pan",
  passport: "passport",
  "driving licence": "driving_licence",
  "driving license": "driving_licence",
  dl: "driving_licence",
  driving_licence: "driving_licence",
  "voter id": "voter_id",
  voter_id: "voter_id",
  epic: "voter_id",
};

/** Accepts 2026-06-01, 01-06-2026, 01/06/2026 and 1.6.2026 (day first, as in India). */
export function normaliseDate(value: string): string {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!match) return text;
  const [, d, m, y] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function normaliseRow(kind: ImportKind, raw: Record<string, string>): Record<string, string> {
  const row = { ...raw };
  if (kind === "rooms") {
    const sharing = SHARING_WORDS[(row.sharing_type ?? "").trim().toLowerCase()];
    if (sharing) row.sharing_type = sharing;
    if (!row.capacity?.trim() && DEFAULT_CAPACITY[row.sharing_type]) {
      row.capacity = DEFAULT_CAPACITY[row.sharing_type];
    }
  } else {
    row.gender = (row.gender ?? "")
      .trim()
      .toLowerCase()
      .replace(/^m$/, "male")
      .replace(/^f$/, "female");
    const id = ID_WORDS[(row.id_proof_type ?? "").trim().toLowerCase()];
    if (id) row.id_proof_type = id;
    for (const key of ["dob", "joining_date"]) if (row[key]) row[key] = normaliseDate(row[key]);
  }
  return row;
}

export type RoomRow = z.output<typeof roomSchema>;
export type ResidentRow = z.output<typeof residentSchema>;

export interface RowResult<T> {
  /** Line number in the file, counting the header as line 1. */
  line: number;
  data: T | null;
  errors: string[];
}

export interface ParsedImport<T> {
  /** Problems with the file as a whole (no header, missing columns, too big). */
  fileErrors: string[];
  rows: RowResult<T>[];
}

/** Reads and validates a whole file. Duplicates within the file are errors. */
export function parseImport(kind: "rooms", text: string): ParsedImport<RoomRow>;
export function parseImport(kind: "residents", text: string): ParsedImport<ResidentRow>;
export function parseImport(kind: ImportKind, text: string): ParsedImport<RoomRow | ResidentRow> {
  const table = parseCsv(text);
  if (table.length === 0) return { fileErrors: ["The file is empty."], rows: [] };

  const columns = COLUMNS[kind];
  const header = table[0].map(normaliseHeader);
  const indexOf = new Map<string, number>();
  for (const column of columns) {
    const names = [column.key, column.label, ...(column.aliases ?? [])].map(normaliseHeader);
    const index = header.findIndex((cell) => names.includes(cell));
    if (index >= 0) indexOf.set(column.key, index);
  }
  const missing = columns.filter((column) => column.required && !indexOf.has(column.key));
  if (missing.length > 0) {
    return {
      fileErrors: [
        `The first row must name the columns. Missing: ${missing.map((column) => column.key).join(", ")}.`,
      ],
      rows: [],
    };
  }

  const body = table.slice(1);
  if (body.length === 0) return { fileErrors: ["The file has a header but no rows."], rows: [] };
  if (body.length > MAX_IMPORT_ROWS) {
    return {
      fileErrors: [
        `Import at most ${MAX_IMPORT_ROWS} rows at a time. This file has ${body.length}.`,
      ],
      rows: [],
    };
  }

  const schema = kind === "rooms" ? roomSchema : residentSchema;
  const seen = new Map<string, number>();
  const rows = body.map((cells, i) => {
    const raw: Record<string, string> = {};
    for (const [key, index] of indexOf) raw[key] = (cells[index] ?? "").trim();
    const result = validate(schema, normaliseRow(kind, raw));
    const line = i + 2;
    if (!result.ok) {
      const errors = Object.entries(result.fieldErrors).map(
        ([key, messages]) => `${key}: ${messages[0]}`,
      );
      return { line, data: null, errors };
    }

    const keys =
      kind === "rooms"
        ? [`room ${(result.data as RoomRow).room_number}`]
        : [
            `mobile ${(result.data as ResidentRow).phone}`,
            `ID ${(result.data as ResidentRow).id_proof_type} ${(result.data as ResidentRow).id_proof_number}`,
          ];
    const errors: string[] = [];
    for (const key of keys) {
      const first = seen.get(key);
      if (first) errors.push(`Same ${key} as line ${first}`);
      else seen.set(key, line);
    }
    return { line, data: errors.length ? null : result.data, errors };
  });

  return { fileErrors: [], rows };
}
