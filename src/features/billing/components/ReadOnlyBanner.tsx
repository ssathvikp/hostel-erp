import Link from "next/link";

import { Alert } from "@/components/ui";

/** Shown in the app shell when the account cannot change anything (ClickUp EP-14 T9). */
export function ReadOnlyBanner({ isOwner, trialEnded }: { isOwner: boolean; trialEnded: boolean }) {
  return (
    <Alert
      tone="warning"
      title={trialEnded ? "Your free trial has ended" : "This account is read-only"}
      className="mb-6 print:hidden"
    >
      Everything is kept, and you can still view, print and download it, but nothing can be changed.{" "}
      {isOwner ? (
        <Link href="/settings/billing" className="font-medium underline">
          Choose a plan to continue
        </Link>
      ) : (
        "Ask the hostel owner to choose a plan."
      )}
    </Alert>
  );
}
