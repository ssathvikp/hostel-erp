import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, buttonClass, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import {
  ElectricityRateForm,
  MeterReadingDialog,
} from "@/features/fees/components/ElectricityForms";
import { VoidDialog } from "@/features/fees/components/VoidDialog";
import { getElectricityRate, getMeterSheet } from "@/features/fees/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatMonth, formatPaise, shiftMonth } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";

export const metadata: Metadata = { title: "Electricity" };

const units = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

/** The month to show: `?month=YYYY-MM`, no later than this month; last month by default. */
function parseMonth(value: string | string[] | undefined): string {
  const thisMonth = shiftMonth(todayIst(), 0);
  const text = Array.isArray(value) ? value[0] : value;
  if (text && /^\d{4}-(0[1-9]|1[0-2])$/.test(text) && `${text}-01` <= thisMonth) {
    return `${text}-01`;
  }
  return shiftMonth(todayIst(), -1);
}

/**
 * Metered electricity (E13-T3): the rate, and each room's reading for a
 * month with how it was split between the residents.
 */
export default async function ElectricityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, hostel } = await requireActiveHostel();
  const month = parseMonth((await searchParams).month);
  const supabase = await createClient();
  const [unitRate, sheet] = await Promise.all([
    getElectricityRate(supabase, hostel.id),
    getMeterSheet(supabase, hostel.id, month),
  ]);
  const isOwner = user.role === "owner";
  const monthLabel = formatMonth(month);
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const hasNext = next <= shiftMonth(todayIst(), 0);
  const missing = sheet.filter((room) => room.missing);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/fees" className="text-sm font-medium text-brand-700 hover:underline">
          ← All fees
        </Link>
        <div className="mt-2">
          <PageHeader
            title="Electricity"
            description="Each room's sub-meter, split between its residents by the nights they stayed."
          />
        </div>
      </div>

      {isOwner && (
        <section
          aria-labelledby="rate-heading"
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
        >
          <h2 id="rate-heading" className="mb-4 text-base font-semibold text-slate-900">
            Rate
          </h2>
          <ElectricityRateForm unitRate={unitRate} />
        </section>
      )}

      {unitRate === null ? (
        <EmptyState
          title="Electricity is not billed"
          description={
            isOwner
              ? "Set a rate per unit above to start recording meter readings."
              : "The hostel owner sets a rate per unit before readings can be recorded."
          }
        />
      ) : (
        <section aria-labelledby="readings-heading" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="readings-heading" className="text-base font-semibold text-slate-900">
              Readings for {monthLabel}{" "}
              <span className="font-normal text-slate-500">at {formatPaise(unitRate)} a unit</span>
            </h2>
            <nav aria-label="Month" className="flex gap-2">
              <Link
                href={`/fees/electricity?month=${previous.slice(0, 7)}`}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                ← {formatMonth(previous, { short: true })}
              </Link>
              {hasNext && (
                <Link
                  href={`/fees/electricity?month=${next.slice(0, 7)}`}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {formatMonth(next, { short: true })} →
                </Link>
              )}
            </nav>
          </div>

          {missing.length > 0 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {missing.length === 1 ? "Room" : "Rooms"}{" "}
              {missing.map((room) => room.roomNumber).join(", ")} had residents in {monthLabel} but
              no reading. Record {missing.length === 1 ? "it" : "them"} before generating next
              month&apos;s invoices.
            </p>
          )}

          {sheet.length === 0 ? (
            <EmptyState title="No rooms yet" description="Add rooms to record their meters." />
          ) : (
            <Table caption={`Meter readings for ${monthLabel}`}>
              <THead>
                <tr>
                  <Th>Room</Th>
                  <Th className="text-right">Opening</Th>
                  <Th className="text-right">Closing</Th>
                  <Th className="text-right">Units</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Split</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {sheet.map((room) => (
                  <Tr key={room.roomId}>
                    <Td className="font-medium">
                      {room.roomNumber}
                      {room.missing && (
                        <span className="ml-2">
                          <Badge tone="warning">No reading</Badge>
                        </span>
                      )}
                    </Td>
                    {room.reading ? (
                      <>
                        <Td className="text-right tabular-nums">
                          {units.format(room.reading.opening)}
                        </Td>
                        <Td className="text-right tabular-nums">
                          {units.format(room.reading.closing)}
                        </Td>
                        <Td className="text-right tabular-nums">
                          {units.format(room.reading.closing - room.reading.opening)}
                        </Td>
                        <Td className="text-right tabular-nums">
                          {formatPaise(room.reading.amount)}
                        </Td>
                        <Td>
                          {room.reading.shares.length === 0 ? (
                            <span className="text-slate-500">Nobody to charge</span>
                          ) : (
                            <ul className="text-xs">
                              {room.reading.shares.map((share, index) => (
                                <li key={index}>
                                  {share.residentName}: {formatPaise(share.amount)}
                                  {share.status === "invoiced" && " (billed)"}
                                  {share.status === "void" && " (void)"}
                                </li>
                              ))}
                            </ul>
                          )}
                        </Td>
                        <Td>
                          {isOwner && (
                            <div className="flex justify-end">
                              <VoidDialog
                                kind="reading"
                                id={room.reading.id}
                                subject={`reading for room ${room.roomNumber}, ${monthLabel}`}
                              />
                            </div>
                          )}
                        </Td>
                      </>
                    ) : (
                      <>
                        <Td className="text-right text-slate-400" colSpan={5}>
                          {room.previousClosing !== null
                            ? `Last closing ${units.format(room.previousClosing)}`
                            : "No readings yet"}
                        </Td>
                        <Td>
                          <div className="flex justify-end">
                            <MeterReadingDialog
                              roomId={room.roomId}
                              roomNumber={room.roomNumber}
                              month={month}
                              monthLabel={monthLabel}
                              previousClosing={room.previousClosing}
                            />
                          </div>
                        </Td>
                      </>
                    )}
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </section>
      )}
    </div>
  );
}
