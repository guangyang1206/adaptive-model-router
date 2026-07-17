// Optional ingest reporter (MVP-3, impl-design §7). Opt-in, zero-dependency:
// built entirely on the Node built-in `fetch` global (present in Node >=18),
// so the SDK's `dependencies` stay `{}` (CI-enforced, A13). When a router is
// created WITHOUT a `reporter`, nothing in this file executes and behavior is
// byte-for-byte identical to MVP-1/MVP-2 (A11). BUILTIN_WEIGHTS/scoring are
// untouched — the reporter only forwards a finished, post-decision trace.

import type { RouterTrace } from "./types.js"

/** A sink that forwards finished traces to a control-plane ingest endpoint. */
export type IngestReporter = {
  report(trace: RouterTrace): Promise<void>
}

export type IngestReporterOptions = {
  /** Full ingest endpoint, e.g. https://cp.example.com/ingest/traces */
  url: string
  /** Per-project ingest token (sent as `Authorization: Bearer <token>`). */
  token: string
  /**
   * Injectable fetch for tests; defaults to the global built-in `fetch`.
   * Kept as `typeof fetch` so no `@types/node` or npm dep is needed — the DOM
   * lib in the base tsconfig provides the type.
   */
  fetch?: typeof fetch
  /** Called on any transport error. Default: swallow (never break routing). */
  onError?: (error: unknown) => void
}

/**
 * Build an opt-in reporter. Errors are swallowed by default (or routed to
 * `onError`) so a down/slow control plane can NEVER break the caller's model
 * call — same discipline as the SDK's `safeWriteTrace`. Nothing here runs
 * unless the SDK user explicitly constructs a reporter and passes it in.
 */
export function createIngestReporter(options: IngestReporterOptions): IngestReporter {
  const doFetch = options.fetch ?? fetch
  return {
    async report(trace: RouterTrace): Promise<void> {
      try {
        await doFetch(options.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.token}`,
          },
          body: JSON.stringify(trace),
        })
      } catch (error) {
        // Swallow by default; local routing/storage is unaffected by a failed report.
        options.onError?.(error)
      }
    },
  }
}
