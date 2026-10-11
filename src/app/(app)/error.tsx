"use client";

import { ErrorState } from "@/components/ErrorState";

/** Standard error state for every page inside the app shell; the shell stays usable. */
export default function AppError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState {...props} />;
}
