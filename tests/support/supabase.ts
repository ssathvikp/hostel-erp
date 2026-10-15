import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * Test harness for access-rule tests. Fixtures are created with the service
 * role; every assertion about what a user can or cannot do goes through a
 * client signed in as that user with the publishable key, so the real RLS
 * policies and grants are exercised.
 */

export type Client = SupabaseClient<Database>;

/** Password given to every user the factory creates. */
export const TEST_PASSWORD = "Test-passw0rd";

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Start Supabase with \`npm run db:start\`, then run \`npm run env:local\`.`,
    );
  }
  return value;
}

const url = () => env("NEXT_PUBLIC_SUPABASE_URL");
const options = { auth: { autoRefreshToken: false, persistSession: false } } as const;

/** Bypasses RLS. Fixtures and cleanup only, never assertions about access. */
export function adminClient(): Client {
  return createClient<Database>(url(), env("SUPABASE_SERVICE_ROLE_KEY"), options);
}

/** A signed-out visitor. */
export function anonClient(): Client {
  return createClient<Database>(url(), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), options);
}

export interface TestUser {
  id: string;
  email: string;
  /** A client signed in as this user. */
  client: Client;
}

/**
 * Tracks every user a test file creates so `cleanup()` can delete them. The
 * profile (and anything else that cascades from auth.users) goes with them.
 */
export function createUserFactory() {
  const admin = adminClient();
  const created: string[] = [];

  async function createUser(
    options: {
      fullName?: string;
      metadata?: Record<string, unknown>;
      /** Applied with the service role after signup, as an operator would. */
      profile?: Partial<Database["public"]["Tables"]["profiles"]["Update"]>;
    } = {},
  ): Promise<TestUser> {
    const email = `test-${randomUUID()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: options.fullName ?? "Test User", ...options.metadata },
    });
    if (error || !data.user) throw error ?? new Error("createUser returned no user");
    created.push(data.user.id);

    if (options.profile) {
      const { error: updateError } = await admin
        .from("profiles")
        .update(options.profile)
        .eq("id", data.user.id);
      if (updateError) throw updateError;
    }

    const client = anonClient();
    const { error: signInError } = await client.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    if (signInError) throw signInError;

    return { id: data.user.id, email, client };
  }

  /**
   * Creates a hostel for `ownerId` with the service role, as fixture data.
   * Active by default so tests start from a fully onboarded hostel.
   */
  async function createHostel(
    ownerId: string,
    overrides: Partial<Database["public"]["Tables"]["hostels"]["Insert"]> = {},
  ) {
    const { data, error } = await admin
      .from("hostels")
      .insert({
        owner_id: ownerId,
        name: `Test Hostel ${randomUUID().slice(0, 8)}`,
        type: "co_ed",
        phone: "9876543210",
        address: "12 MG Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
        floors: 3,
        status: "active",
        ...overrides,
      })
      .select()
      .single();
    if (error || !data) throw error ?? new Error("createHostel returned no row");
    return data;
  }

  /** Registers a user created outside the factory (e.g. by signUp) for cleanup. */
  function track(id: string) {
    created.push(id);
  }

  /**
   * Deletes everything the test file created. Order matters because history
   * is protected by restrictive foreign keys: payments, invoices and allocations first, then staff
   * (they reference a hostel), then the hostels, then the owners.
   */
  async function cleanup() {
    if (created.length === 0) return;
    const deleteUsers = (ids: string[]) =>
      Promise.all(ids.map((id) => admin.auth.admin.deleteUser(id)));

    // Allocations name the user who made them and protect that history, so
    // they go first; then nothing stops a staff account from being removed.
    const { data: hostels } = await admin.from("hostels").select("id").in("owner_id", created);
    const hostelIds = (hostels ?? []).map((row) => row.id);
    if (hostelIds.length > 0) {
      // Complaints name charges, residents and rooms; money rows protect the
      // stays and people they name. Both go first.
      for (const table of [
        "gateway_payments",
        "payment_links",
        "vendor_payouts",
        "complaints",
        "maintenance_schedules",
        "payments",
        "invoice_lines",
        "resident_charges",
        "resident_credit",
        "deposit_ledger",
        "discounts",
        "invoices",
        "allocations",
      ] as const) {
        const { error } = await admin.from(table).delete().in("hostel_id", hostelIds);
        if (error) throw error;
      }
    }

    const { data: staff } = await admin
      .from("profiles")
      .select("id")
      .in("id", created)
      .eq("role", "staff");
    const staffIds = (staff ?? []).map((row) => row.id);
    await deleteUsers(staffIds);

    const { error } = await admin.from("hostels").delete().in("owner_id", created);
    if (error) throw error;

    await deleteUsers(created.filter((id) => !staffIds.includes(id)));
    created.length = 0;
  }

  return { admin, createUser, createHostel, track, cleanup };
}
