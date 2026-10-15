import type { Metadata } from "next";
import type { ReactNode } from "react";

import {
  ResidentComplaintForm,
  ResidentSignIn,
} from "@/features/resident-complaints/components/ResidentForms";
import { getResidentForm, getResidentRoom } from "@/features/resident-complaints/queries";
import { smsProvider } from "@/lib/sms/provider";

export const metadata: Metadata = {
  title: "Report a problem",
  // The URL is the room's key: keep it out of search engines and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

function Card({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh max-w-md bg-slate-50 px-4 py-6">
      <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        {children}
      </div>
    </main>
  );
}

/**
 * The page a room's QR code opens (E15-T3): a resident of that room proves
 * who they are with their mobile number and a one-time code, then reports
 * the problem. No account, no app.
 */
export default async function RoomReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const room = await getResidentRoom(token);

  if (!room) {
    return (
      <Card>
        <h1 className="text-lg font-semibold text-slate-900">This code no longer works</h1>
        <p className="text-sm text-slate-600">
          The hostel may have printed a new one. Please tell the warden or the office about the
          problem.
        </p>
      </Card>
    );
  }

  const header = (
    <div>
      <p className="text-sm text-slate-500">{room.hostel_name}</p>
      <h1 className="text-xl font-semibold text-slate-900">
        Report a problem in room {room.room_number}
      </h1>
    </div>
  );

  if (!room.enabled || !smsProvider()) {
    return (
      <Card>
        {header}
        <p className="text-sm text-slate-600">
          Reporting from your room is turned off. Please tell the warden or the hostel office.
        </p>
      </Card>
    );
  }

  const form = await getResidentForm();
  return (
    <Card>
      {header}
      {form ? (
        <>
          <p className="text-sm text-slate-600">Hello {form.resident_name}. What needs fixing?</p>
          <ResidentComplaintForm token={token} categories={form.categories} />
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            For residents of this room. We check your number against the hostel&apos;s records and
            send you a code.
          </p>
          <ResidentSignIn token={token} />
        </>
      )}
    </Card>
  );
}
