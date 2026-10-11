"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui";

/**
 * The friendly error state every boundary shows (E9-T5). The message is
 * deliberately generic: in production the browser never receives a server
 * error's message or stack, only its digest, which the server log records
 * against the request so a reported reference can be traced.
 */
export function ErrorState({
  error,
  reset,
  title = "Something went wrong",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-white px-6 py-12 text-center">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
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
