"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { unexpectedFailure } from "@/lib/request-context";
import { protectIdProof } from "@/lib/residents/id-proof";
import { createClient } from "@/lib/supabase/server";
import { formFailure, type FormState } from "@/lib/validation";
import type { ProfileRole } from "@/types";
import type { Json } from "@/types/database";

import {
  MAX_IMPORT_BYTES,
  parseImport,
  type ImportKind,
  type ResidentRow,
  type RoomRow,
  type RowResult,
} from "./spec";

/** What the preview shows: a count, the problems by line, and a sample. */
export interface ImportState extends FormState {
  /** The file's text, sent back with "Import" so it is not uploaded twice. */
  csv?: string;
  fileName?: string;
  total?: number;
  ready?: number;
  problems?: { line: number; errors: string[] }[];
  sample?: Record<string, string | number | null>[];
}

const ROLES: Record<ImportKind, readonly ProfileRole[]> = {
  rooms: ["owner"],
  residents: ["owner", "staff"],
};

const MAX_PROBLEMS_SHOWN = 50;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Rows that clash with records already in the hostel get an error each. */
async function markExisting(
  supabase: Supabase,
  hostelId: string,
  kind: ImportKind,
  rows: RowResult<RoomRow | ResidentRow>[],
) {
  const good = rows.filter((row) => row.data);
  if (good.length === 0) return;

  if (kind === "rooms") {
    const numbers = good.map((row) => (row.data as RoomRow).room_number);
    const { data, error } = await supabase
      .from("rooms")
      .select("room_number")
      .eq("hostel_id", hostelId)
      .in("room_number", numbers);
    if (error) throw error;
    const taken = new Set(data.map((room) => room.room_number));
    for (const row of good) {
      const number = (row.data as RoomRow).room_number;
      if (taken.has(number)) {
        row.errors.push(`Room ${number} already exists in this hostel`);
        row.data = null;
      }
    }
    return;
  }

  const residents = good.map((row) => row.data as ResidentRow);
  const hashes = residents.map(
    (resident) => protectIdProof(resident.id_proof_type, resident.id_proof_number).id_proof_hash,
  );
  const [byPhone, byId] = await Promise.all([
    supabase
      .from("residents")
      .select("phone")
      .eq("hostel_id", hostelId)
      .in(
        "phone",
        residents.map((resident) => resident.phone),
      ),
    supabase
      .from("residents")
      .select("id_proof_hash")
      .eq("hostel_id", hostelId)
      .in("id_proof_hash", hashes),
  ]);
  if (byPhone.error) throw byPhone.error;
  if (byId.error) throw byId.error;
  const phones = new Set(byPhone.data.map((row) => row.phone));
  const ids = new Set(byId.data.map((row) => row.id_proof_hash));
  good.forEach((row, i) => {
    const resident = residents[i];
    if (phones.has(resident.phone)) {
      row.errors.push(`A resident with mobile ${resident.phone} is already registered`);
    }
    if (ids.has(hashes[i])) row.errors.push("A resident with this ID proof is already registered");
    if (row.errors.length > 0) row.data = null;
  });
}

/** Reads the upload (or the text sent back from a preview) and checks every row. */
async function check(kind: ImportKind, formData: FormData) {
  const file = formData.get("file");
  const resent = formData.get("csv");
  let text: string;
  let fileName: string | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_IMPORT_BYTES) {
      return { error: "The file is larger than 512 KB. Split it into smaller files." } as const;
    }
    text = await file.text();
    fileName = file.name;
  } else if (typeof resent === "string" && resent.length > 0) {
    if (resent.length > MAX_IMPORT_BYTES) return { error: "The file is too large." } as const;
    text = resent;
    fileName = String(formData.get("file_name") ?? "") || undefined;
  } else {
    return { error: "Choose a CSV file to import." } as const;
  }

  const hostelId = (await getHostelContext()).active?.id;
  if (!hostelId) return { error: "Finish setting up your hostel first." } as const;

  const parsed = kind === "rooms" ? parseImport("rooms", text) : parseImport("residents", text);
  if (parsed.fileErrors.length > 0) return { error: parsed.fileErrors[0] } as const;

  const supabase = await createClient();
  const rows = parsed.rows as RowResult<RoomRow | ResidentRow>[];
  await markExisting(supabase, hostelId, kind, rows);
  return { text, fileName, rows, hostelId, supabase } as const;
}

function sampleOf(kind: ImportKind, rows: RowResult<RoomRow | ResidentRow>[]) {
  return rows
    .filter((row) => row.data)
    .slice(0, 5)
    .map((row): Record<string, string | number | null> => {
      if (kind === "rooms") {
        const room = row.data as RoomRow;
        return {
          room_number: room.room_number,
          floor: room.floor,
          sharing_type: room.sharing_type,
          capacity: room.capacity,
        };
      }
      // Never echo ID numbers back to the browser.
      const resident = row.data as ResidentRow;
      return {
        full_name: resident.full_name,
        phone: resident.phone,
        joining_date: resident.joining_date,
      };
    });
}

function stateFor(
  kind: ImportKind,
  checked: { text: string; fileName?: string; rows: RowResult<RoomRow | ResidentRow>[] },
  formError?: string,
): ImportState {
  const problems = checked.rows
    .filter((row) => row.errors.length > 0)
    .map(({ line, errors }) => ({ line, errors }));
  return {
    id: crypto.randomUUID(),
    status: formError || problems.length > 0 ? "error" : "success",
    formError,
    fieldErrors: {},
    csv: checked.text,
    fileName: checked.fileName,
    total: checked.rows.length,
    ready: checked.rows.length - problems.length,
    problems: problems.slice(0, MAX_PROBLEMS_SHOWN),
    sample: sampleOf(kind, checked.rows),
  };
}

async function authorize(kind: ImportKind): Promise<ImportState | null> {
  try {
    await requireRole(ROLES[kind]);
    return null;
  } catch (error) {
    if (error instanceof AuthorizationError) return formFailure(error.message);
    throw error;
  }
}

async function preview(kind: ImportKind, formData: FormData): Promise<ImportState> {
  const denied = await authorize(kind);
  if (denied) return denied;
  try {
    const checked = await check(kind, formData);
    if ("error" in checked) return formFailure(checked.error);
    return stateFor(kind, checked);
  } catch (error) {
    return unexpectedFailure(`preview${kind}Import`, error);
  }
}

async function commit(kind: ImportKind, formData: FormData): Promise<ImportState> {
  const denied = await authorize(kind);
  if (denied) return denied;

  let created: number;
  try {
    const checked = await check(kind, formData);
    if ("error" in checked) return formFailure(checked.error);
    const state = stateFor(kind, checked);
    if (state.problems?.length) {
      return { ...state, formError: "Fix the rows below, then preview the file again." };
    }

    const good = checked.rows.map((row) => row.data!);
    if (kind === "rooms") {
      const { data, error } = await checked.supabase.rpc("import_rooms", {
        p_hostel_id: checked.hostelId,
        p_rooms: good as unknown as Json,
      });
      if (error) {
        if (error.code === "23505") {
          return stateFor(
            kind,
            checked,
            "A room in the file was added meanwhile. Preview the file again.",
          );
        }
        if (error.code === "42501") return formFailure("Only the hostel owner can import rooms.");
        return unexpectedFailure("importRooms", error);
      }
      created = data?.[0]?.rooms_created ?? 0;
    } else {
      // The full ID number goes no further than this mapping.
      const residents = (good as ResidentRow[]).map(
        ({ id_proof_number, id_proof_type, ...rest }) => ({
          ...rest,
          ...protectIdProof(id_proof_type, id_proof_number),
        }),
      );
      const { data, error } = await checked.supabase.rpc("import_residents", {
        p_hostel_id: checked.hostelId,
        p_residents: residents as unknown as Json,
      });
      if (error) {
        if (error.code === "23505") {
          return stateFor(
            kind,
            checked,
            "A resident in the file was registered meanwhile. Preview the file again.",
          );
        }
        return unexpectedFailure("importResidents", error);
      }
      created = data ?? 0;
    }
  } catch (error) {
    return unexpectedFailure(`commit${kind}Import`, error);
  }

  revalidatePath(`/${kind}`, "layout");
  revalidatePath("/dashboard");
  redirect(`/${kind}?imported=${created}`);
}

export async function previewRoomImport(_previous: ImportState, formData: FormData) {
  return preview("rooms", formData);
}

export async function commitRoomImport(_previous: ImportState, formData: FormData) {
  return commit("rooms", formData);
}

export async function previewResidentImport(_previous: ImportState, formData: FormData) {
  return preview("residents", formData);
}

export async function commitResidentImport(_previous: ImportState, formData: FormData) {
  return commit("residents", formData);
}
