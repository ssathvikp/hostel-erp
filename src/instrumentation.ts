import type { Instrumentation } from "next";

import { describeError, logger, pathOnly, REQUEST_ID_HEADER, scrub } from "@/lib/logger";

/**
 * Server start-up (E9-T5). Next.js prints unhandled errors itself, with
 * their full message; every console line on the server is passed through
 * the same scrubber as our own logs so no personal data or secret leaves
 * the process that way either.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  for (const method of ["error", "warn", "log", "info"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) =>
      original(
        ...args.map((arg) => {
          if (typeof arg === "string") return scrub(arg);
          if (arg instanceof Error || (arg && typeof arg === "object" && "code" in arg)) {
            return JSON.stringify(describeError(arg));
          }
          return arg;
        }),
      );
  }
}

/**
 * Every unhandled server error (rendering, route handlers, server actions)
 * is logged once with its request context. The digest is what the error
 * page shows the user as a reference, so a report can be matched to this line.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const id = request.headers[REQUEST_ID_HEADER];
  logger.error("Unhandled server error", {
    requestId: Array.isArray(id) ? id[0] : id,
    method: request.method,
    path: pathOnly(request.path),
    route: context.routePath,
    routeType: context.routeType,
    error: describeError(error),
  });
};
