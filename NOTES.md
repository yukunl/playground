# NOTES

## Path(s) chosen

Path 1, Model Playground, with two-column Compare and agent proposals. An agent
can test models and settings through MCP, then hand back its top choices as a
link. The reviewer runs those choices live in Compare.

## Total time spent

Approximately 8 hours.

## Production-shape extension I built

Resilience to mock and inference errors:

- Interactive chat retries eligible failures before the first token, with a
  visible countdown and Cancel. It allows at most three retries and 10 seconds
  of automatic waiting, respecting `Retry-After`.
- A failed stream keeps the partial answer and offers an explicit retry.
- First-token and stalled-stream timeouts prevent requests from hanging.
- Error cards name the source and show the attempt timeline. Weather control
  (`?debug`) makes the main failure paths reproducible.

Structured logs, request IDs and estimated answer costs support this flow.

## Production concerns I'd tackle next

1. Per-visitor limits and a daily spend budget. Signed-in visitors share the
   upstream key; the agent-token allowance does not cover browser traffic or
   enforce a dollar budget.
2. Operational metrics and alerts for failed credentials, overload, retries and
   interrupted streams. Successful retries can hide an upstream problem from
   the person using the page.

## Stack

- Frontend: React 19, Vite, Tailwind, Radix and react-markdown.
- Backend: Hono on Node 22, serving the built page and API in one process.
- Database: none on the application server. History lives in browser IndexedDB;
  share links carry their content in the URL fragment.
- Local run: `npm ci && npm run dev:all`, or `docker compose up --build`.
  Both default to the vendored FastAPI mock. See the [README](README.md) for
  requirements and access instructions.
- Hosting: [Fly.io preview](https://speedboat-playground-yukunl.fly.dev), using
  the real Parasail API.
- Auth: shared preview password, browser cookie or Basic Auth; scoped,
  expiring tokens for coding agents. The upstream key stays on the server.
- Observability: structured JSON logs to stdout, inspected through Fly.

## AI tools used

I used Claude Code heavily for design and implementation, and Codex for
verification and submission documentation.

I chose independent Compare columns over a more complicated run-locking model
and focused on one production extension. Testing caught generated code that
logged only successful attempts and included retry waits in time to first token.
Those were corrected. The server also now loads a local `.env`, which an earlier
version claimed to support but did not.

## What I cut, and why

- General rate limits, a spend budget, an ops page and alerts. I focused on
  resilience rather than spreading the work across three extensions.
- Server-stored shares. URL fragments avoid a database and server persistence
  of shared prompts. Those links have no managed expiry or revocation.
- Resumable streams. Interrupted text stays visible; reconnecting a live run
  would require state across requests.
- A third Compare column, prompt versions and history search. Two setups cover
  the comparison flow in the brief.
- An in-app settings search. The connected agent chooses and evaluates trials;
  the playground executes them and opens the finalists for inspection.

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

Start with the [README walkthrough](README.md#what-to-try) and
[architecture notes](architecture-notes.md). `?debug` demonstrates recovery
after two 429s, repeated 503s, rejected credentials and a stream dropping
partway through. Against the real API, these faults are simulated by the
playground and never sent to Parasail.

The local mock chooses a canned reply from the last user message, so Compare
columns match even when settings differ. The preview runs real models.

Verification includes a clean dependency install, unit and API integration
tests, a production build and a mock-backed streaming smoke check. Browser
end-to-end tests are not included, and Docker Compose was not run end to end
locally. Fallback model prices are maintained by hand, so displayed costs are
estimates. Word-by-word display pauses in a background tab until animation
frames resume.
