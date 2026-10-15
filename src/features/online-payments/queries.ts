import "server-only";

import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Reads for online rent collection (E13-T10). RLS limits them to members. */

export interface GatewayAccount {
  keyId: string;
  webhookToken: string;
  enabled: boolean;
  connectedAt: string;
  mode: "test" | "live";
}

/** The hostel's connected gateway, without its secrets (they are never selectable). */
export async function getGatewayAccount(
  supabase: Supabase,
  hostelId: string,
): Promise<GatewayAccount | null> {
  const { data, error } = await supabase
    .from("payment_gateway_accounts")
    .select("key_id, webhook_token, enabled, connected_at")
    .eq("hostel_id", hostelId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    keyId: data.key_id,
    webhookToken: data.webhook_token,
    enabled: data.enabled,
    connectedAt: data.connected_at,
    mode: data.key_id.startsWith("rzp_live_") ? "live" : "test",
  };
}

export interface LivePaymentLink {
  id: string;
  amount: number;
  shortUrl: string;
  expiresAt: string;
  createdAt: string;
}

export async function getLivePaymentLink(
  supabase: Supabase,
  invoiceId: string,
): Promise<LivePaymentLink | null> {
  const { data, error } = await supabase
    .from("payment_links")
    .select("id, amount, short_url, expires_at, created_at")
    .eq("invoice_id", invoiceId)
    .eq("status", "created")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    amount: data.amount,
    shortUrl: data.short_url,
    expiresAt: data.expires_at,
    createdAt: data.created_at,
  };
}

export interface Reconciliation {
  totals: {
    captured: number;
    fees: number;
    tax: number;
    refunded: number;
    recorded: number;
    to_credit: number;
    settled: number;
    settlement_fees: number;
    failed: number;
    unrecorded: number;
  };
  payments: {
    gateway_payment_id: string;
    received_at: string;
    amount: number;
    fee: number | null;
    tax: number | null;
    method: string | null;
    status: "captured" | "failed" | "refunded";
    refunded_amount: number;
    note: string | null;
    resident_name: string | null;
    invoice_id: string | null;
    invoice_number: string | null;
    receipt_number: string | null;
    credit_number: string | null;
  }[];
  refunds: {
    gateway_refund_id: string;
    gateway_payment_id: string;
    amount: number;
    mirrored: "voided" | "credit" | "partly" | "not_found";
    note: string | null;
    created_at: string;
  }[];
  settlements: {
    gateway_settlement_id: string;
    amount: number;
    fees: number;
    tax: number;
    utr: string | null;
    settled_at: string;
  }[];
}

export async function getReconciliation(
  supabase: Supabase,
  hostelId: string,
  from: string,
  to: string,
): Promise<Reconciliation> {
  const { data, error } = await supabase.rpc("gateway_reconciliation", {
    p_hostel_id: hostelId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return data as unknown as Reconciliation;
}
