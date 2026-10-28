# NOTES

## Path(s) chosen

Path 1, Model Playground, with two additional features:

1. Two-way Compare: run the same prompt with different models or settings and
   compare answers side by side.
2. Agent surface: a coding agent can use MCP to test models and settings, then
   open its top choices in Compare.

## Total time spent

Approximately 8–10 hours.

## Production-shape extension I built

Resilience to mock and inference errors:

- Bounded automatic retries: temporary failures such as 429s and 5xx errors
  retry before the first token, with exponential backoff, jitter and
  `Retry-After` support. At most three retries and 10 seconds of automatic
  waiting, with a visible countdown and Cancel.
- Partial-answer preservation: if a stream breaks after text arrives, the
  partial answer stays visible and the user can retry explicitly.
- Timeouts and heartbeats: 30 seconds to the first token, 20 seconds for a
  stalled stream, and heartbeats every 15 seconds.
- Cancellation and offline recovery: Stop cancels the upstream request and
  freezes the displayed text. While offline, the browser waits for reconnection
  without consuming retries.
- Graceful degradation: if refreshing the model list fails, the app uses the
  last good list. UI error boundaries contain rendering failures.

Try the failure scenarios in Weather control with `?debug`.

## Production concerns I'd tackle next

1. Authentication and authorization. Everyone currently shares the server's
   Parasail API key, which keeps setup quick. Without user accounts, I can't
   attribute usage and costs to individual people. Chat history stays in each
   browser and isn't tied to an account.
2. Operational metrics and alerts. I'd track rejected credentials, overload,
   retries and interrupted streams, and alert developers when failures persist
   or affect multiple requests.

## Stack

- Frontend: React, Vite, Tailwind and Radix.
- Backend: Hono.
- Database: browser IndexedDB for chat history; no server-side database.
- Local run: `npm ci && npm run dev:all`, or `docker compose up --build`.
  Both default to the vendored FastAPI mock. See the [README](README.md) for
  requirements and access instructions.
- Hosting: [Fly.io preview](https://speedboat-playground-yukunl.fly.dev), using
  the real Parasail API.
- Auth: shared preview password, with a cookie for browsers and Basic Auth for
  scripts; scoped, expiring tokens for coding agents.
- Observability: structured JSON logs to stdout, inspected through Fly.

## AI tools used

I used Claude Code heavily for design thinking and implementation.

## What I cut, and why

- Authentication, authorization, general rate limits, a spend budget, an ops
  page and alerts. I kept the scope focused on resilience.
- Server-side storage and multitenancy. I'd add these alongside user identities
  and access controls so stored chats have clear owners and permissions.
- Resumable streams. Interrupted text stays visible; reconnecting a live run
  would require state across requests.
- More than two Compare columns. With more setups side by side, the display
  could get chaotic.

## What breaks at 10× / 100×

At 10×, I expect more upstream overload and contention on the shared key.
One visitor can also consume the key's allowance because browser traffic has
no per-visitor limit.

At 100×, concurrent streams and state held in one process become additional
constraints. Agent run counters reset on restart and are not shared across
instances. I'd add shared limits and budget accounting before scaling out,
then measure connection capacity and sample successful logs while retaining
errors.

## Anything you want a reviewer to know

- Start with the [README walkthrough](README.md#what-to-try) and
  [architecture notes](architecture-notes.md).
- Use `?debug` to try recovery after two 429s, repeated 503s, rejected
  credentials and a stream dropping partway through. Against the real API,
  the playground simulates these faults and never sends them to Parasail.

Verification includes a clean dependency install, unit and API integration
tests, a production build and a streaming smoke check against the mock. Browser
end-to-end tests are not included, and I did not run Docker Compose end to end
locally. Fallback model prices are maintained by hand, so displayed costs are
estimates. Word-by-word display pauses in a background tab until animation
frames resume.
