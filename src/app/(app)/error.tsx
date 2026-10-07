"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui";

/**
 * Standard error state for every page inside the app shell. The message is
 * deliberately generic: raw errors can contain internals and are only logged.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-white px-6 py-12 text-center">
      <h2 className="text-lg font-semibold text-slate-900">Something went wrong</h2>
      <p className="mt-1 text-sm text-slate-600">
        This page could not be loaded. Please try again.
        {error.digest && (
          <span className="mt-2 block text-xs text-slate-400">Reference: {error.digest}</span>
        )}
      </p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
