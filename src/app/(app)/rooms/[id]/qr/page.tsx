import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PrintButton } from "@/features/fees/components/PrintButton";
import { requireActiveHostel } from "@/lib/hostels/active";
import { siteUrl } from "@/lib/payments/config";
import { qrSvg } from "@/lib/qr";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Room QR code" };

/** A card to print and put up in the room (E15-T3). */
export default async function RoomQrPage({ params }: { params: Promise<{ id: string }> }) {
  const { hostel } = await requireActiveHostel();
  const { id } = await params;
  if (!uuid("Room").safeParse(id).success) notFound();

  const supabase = await createClient();
  const [{ data: room }, { data: code }] = await Promise.all([
    supabase
      .from("rooms")
      .select("id, room_number")
      .eq("id", id)
      .eq("hostel_id", hostel.id)
      .maybeSingle(),
    supabase
      .from("room_report_tokens")
      .select("token")
      .eq("room_id", id)
      .is("revoked_at", null)
      .maybeSingle(),
  ]);
  if (!room || !code) notFound();
  const svg = await qrSvg(`${siteUrl()}/r/${code.token}`, {
    label: `QR code to report a problem in room ${room.room_number}`,
  });

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link
          href={`/rooms/${room.id}`}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← Back to room {room.room_number}
        </Link>
        <PrintButton label="Print" />
      </div>
      <article className="space-y-4 rounded-lg border-2 border-slate-900 bg-white p-8 text-center print:mt-8">
        <p className="text-sm font-medium tracking-wide text-slate-500 uppercase">{hostel.name}</p>
        <h1 className="text-2xl font-bold text-slate-900">Something not working?</h1>
        <p className="text-slate-700">Scan to report it. Room {room.room_number}.</p>
        <div
          className="mx-auto size-64 [&_svg]:size-full"
          // Inline SVG made on the server by the qrcode library.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <p className="text-sm text-slate-600">
          You will get a code by SMS on the mobile number the hostel has for you.
        </p>
      </article>
    </div>
  );
}
