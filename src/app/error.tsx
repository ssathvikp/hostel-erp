"use client";

import { ErrorState } from "@/components/ErrorState";

/** Errors outside the app shell, such as the sign-in and sign-up pages. */
export default function RootError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <ErrorState {...props} />
    </main>
  );
}
