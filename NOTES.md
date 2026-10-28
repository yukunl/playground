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

- Resiliency testing panel:
  [Weather Control](https://speedboat-playground-yukunl.fly.dev/?debug).

## Production concerns I'd tackle next

I focused this assignment on exploring what the playground could do and making
it easy to use. If I were shipping it as a real
product, I'd tackle these next:

- **Authentication and account ownership.** Everyone currently uses the server's
  Parasail key, which keeps onboarding quick. I'd add sign-in and let users
  connect their own keys. That would let us attribute usage and costs to each
  account and build account-level permissions, usage limits, observability and
  cost summaries.

- **Multi-tenant data model.** I'd give each account clear ownership of its data
  and permissions. This would let us onboard more users and organizations on
  shared infrastructure while keeping their data separate.

## Stack

- Frontend: React, Vite, Tailwind and Radix.
- Backend: Hono.
- Database: browser IndexedDB for chat history; no server-side database.
- Local run:  `docker compose up --build`.
- Hosting: [Fly.io preview](https://speedboat-playground-yukunl.fly.dev) (real Parasail API)
- Auth: basic auth shared by all users
- Observability: structured JSON logs to stdout, inspected through Fly.

## AI tools used

I used Claude Code heavily. We worked together on design choices, and I made
the final decisions. Claude wrote most of the code.

- **Design before code.** I had Claude ask me questions before building, and we
  went back and forth to check my blind spots. We turned that discussion into
  our design doc.

- **Building.** I instructed Claude to build in phases. I reviewed the code and
  tried each phase.

- **Where I pushed back:**
  - **UI design.** I struggled to get Claude to design the UI interactions. I
    still had to come up with them and judge the layout and readability myself.
  - **Scope creep.** I quickly realized my scope was bloating with AI. When
    things were so easy to build, it was super tempting to keep going. I had to
    set a final product goal and stop there.

## What I cut, and why

- Authentication, authorization, general rate limits, a spend budget, an ops
  page and alerts. I kept the scope focused on exploring and enhancing user experience.
- Server-side storage and multitenancy. I'd add these alongside user identities
  and access controls so stored chats have clear owners and permissions.
- **Resuming interrupted responses.** I kept partial answers and manual retry
  to limit scope. Resuming the same generation would require the server to
  retain output and manage reconnections.
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

- Check out the resiliency testing panel,
  [Weather Control](https://speedboat-playground-yukunl.fly.dev/?debug).
  Use it to simulate faults and check retries, error messages and partial-answer
  preservation. I used a parasailing analogy for the scenarios:

  - Clear skies: no faults.
  - Busy skies, clears up: two 429s, then recovery.
  - Still grounded: repeated 503s.
  - Engine trouble: 401.
  - Early landing: stream cut off.

- **Prices.** I included the price display for the look and feel. The preview
  uses a manually maintained table of online list prices, so displayed costs
  are estimates.
