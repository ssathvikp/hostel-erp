"use client";

import "./globals.css";

import { ErrorState } from "@/components/ErrorState";

/**
 * Last line of defence: an error in the root layout itself. It replaces the
 * whole document, so it renders its own <html> and <body>.
 */
export default function GlobalError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-50 font-sans text-slate-900 antialiased">
        <main className="mx-auto max-w-lg px-4 py-16">
          <ErrorState {...props} />
        </main>
      </body>
    </html>
  );
}
