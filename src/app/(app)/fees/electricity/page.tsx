import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import {
  Alert,
  Badge,
  buttonClass,
  EmptyState,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui";
import { BillElectricityForm, ReadingForm } from "@/features/charges/components/ElectricityForms";
import { getElectricityRate, getMeterRooms } from "@/features/charges/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatMonth, formatPaise, shiftMonth } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";

export const metadata: Metadata = { title: "Electricity" };

/**
 * Room meter readings and electricity billing (ClickUp E13-T3). Readings
 * are taken at the end of a month; billing that month splits each room's
 * units among its residents by nights held, as charges on their next invoice.
 */
export default async function ElectricityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, hostel } = await requireActiveHostel();
  const requested = (await searchParams).month;
  const thisMonth = todayIst().slice(0, 7);
  // Default: last month, the one most often being read and billed.
  const fallback = shiftMonth(todayIst(), -1).slice(0, 7);
  const month =
    typeof requested === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) &&
    requested <= thisMonth
      ? requested
      : fallback;
  const monthStart = `${month}-01`;
  const supabase = await createClient();
  const [rate, rooms] = await Promise.all([
    getElectricityRate(supabase, hostel.id),
    getMeterRooms(supabase, hostel.id, monthStart),
  ]);
  const isOwner = user.role === "owner";
  const previousMonth = shiftMonth(monthStart, -1).slice(0, 7);
  const nextMonth = shiftMonth(monthStart, 1).slice(0, 7);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/fees" className="text-sm font-medium text-brand-700 hover:underline">
          ← All fees
        </Link>
        <div className="mt-2">
          <PageHeader
            title={`Electricity, ${formatMonth(monthStart)}`}
            description="Meter readings at the end of the month, per room."
            actions={
              <div className="flex gap-2">
                <Link
                  href={`/fees/electricity?month=${previousMonth}`}
                  className={buttonClass({ variant: "secondary" })}
                >
                  Previous month
                </Link>
                {nextMonth <= thisMonth && (
                  <Link
                    href={`/fees/electricity?month=${nextMonth}`}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    Next month
                  </Link>
                )}
              </div>
            }
          />
        </div>
      </div>

      {!rate && (
        <Alert tone="info" title="Electricity is included in rent">
          {isOwner ? (
            <>
              To bill room meters, set a price per unit in{" "}
              <Link href="/settings/fees#electricity" className="font-medium underline">
                Settings → Fees
              </Link>
              .
            </>
          ) : (
            "The hostel owner can set a price per unit to bill room meters."
          )}
        </Alert>
      )}

      {rooms.length === 0 ? (
        <EmptyState title="No rooms yet" />
      ) : (
        <Table caption={`Meter readings for ${formatMonth(monthStart)}`}>
          <THead>
            <tr>
              <Th>Room</Th>
              <Th>Previous reading</Th>
              <Th>Reading at month end</Th>
              <Th className="text-right">Units</Th>
              <Th>Billed</Th>
            </tr>
          </THead>
          <TBody>
            {rooms.map((room) => {
              const units =
                room.reading !== null && room.previous
                  ? Math.round((room.reading - room.previous.reading) * 10) / 10
                  : null;
              return (
                <Tr key={room.roomId}>
                  <Td className="font-medium">{room.roomNumber}</Td>
                  <Td>
                    {room.previous ? (
                      <>
                        <span className="tabular-nums">{room.previous.reading}</span>
                        <span className="block text-xs text-slate-500">
                          {formatMonth(room.previous.month, { short: true })}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-slate-500">None: this is the first</span>
                    )}
                  </Td>
                  <Td>
                    <ReadingForm
                      roomId={room.roomId}
                      roomNumber={room.roomNumber}
                      month={month}
                      reading={room.reading}
                      locked={room.billed !== null}
                    />
                  </Td>
                  <Td className="text-right tabular-nums">{units ?? "—"}</Td>
                  <Td>
                    {room.billed ? (
                      <Badge tone="success">{formatPaise(room.billed.amount)}</Badge>
                    ) : (
                      "—"
                    )}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}

      {isOwner && rate && rooms.length > 0 && (
        <section
          aria-labelledby="bill-electricity"
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
        >
          <h2 id="bill-electricity" className="text-base font-semibold text-slate-900">
            Bill {formatMonth(monthStart)}
          </h2>
          <p className="mt-1 mb-4 text-sm text-slate-600">
            Each room&apos;s units × {formatPaise(rate)} are split among its residents by nights
            held in the month, and added as charges to their next invoice. Each room is billed once
            per month; a room without a reading is listed, never billed as zero.
          </p>
          <BillElectricityForm month={month} />
        </section>
      )}
    </div>
  );
}
