# Architecture notes

## At a glance

- **Path(s) shipped:** Path 1, Model Playground, with two-column **Compare** (user story 2) and **agent proposals**: an agent's top two settings open side by side from a link, to be judged on live answers.
- **Production-shape extension:** **Resilience to mock errors**, built deep.
- **Stack:** React 19 + Vite + Tailwind + Radix · Hono on Node 22, one process serving the page and the BFF · **no database** (chats in IndexedDB; share links carry their content after the `#`) · Fly.io, one machine, blue-green deploys.
- **Backend choice:** our own thin BFF in front of the **unchanged** mock (locally) or the real Parasail API (the preview). It holds the key, validates and caps each request, normalizes the stream and logs one line per attempt.
- **Preview vs local:** everything works in both.
  - **The preview** (https://speedboat-playground-yukunl.fly.dev) runs on the real Parasail API, with the key as a Fly secret. It stops working when the key expires after the deadline; switching it to the mock means redeploying the mock app from `mock/fly.toml` and one line in `fly.toml`.
  - **Its retry countdowns are real:** Parasail sometimes answers `429` "The engine is currently overloaded", with no `Retry-After`.
  - **Locally** it runs on the mock, which replies from your last message only, so compare columns match (Compare says so).
- **Production-readiness: 3/10.**
  - **Production-shaped:** resilience, key secrecy, error boundaries, health-checked blue-green deploys that let streams finish, and 203 unit and BFF tests.
  - **Missing:** identity (the preview has one shared password); per-visitor limits and a daily budget (anyone with the password spends a real key, with only Parasail's cap behind it); metrics and alerts; shared state across instances; resumable streams.

## Architecture diagram

```
browser (React SPA)                    Fly.io: Node 22 + Hono, one process              inference
retry loop · countdown · Cancel        request ID → 512 KB cap → zod check → route
chats in IndexedDB          ─ fetch ─▶ POST /api/chat ─ model check ─ build request ──▶ api.parasail.io (preview)
share links after the #     ◀─ SSE ──  normalize SSE → token | error | done   ◀─────── mock :3001 (local, compose)
                                       GET /api/models (5-min cache) · GET /api/health
                                       stdout: one JSON line per attempt · no database
```

## Auth

- **Identity:** none, by design, so the first token arrives within seconds of landing.
- **Preview gate:** one shared password (`PLAYGROUND_PASSWORD`) on the page and every `/api` route except health. Direct calls to `/api/chat` need it too, so the URL alone can't spend the key.
  - **Browsers** sign in on `/login` and get an HttpOnly, SameSite=Lax cookie for 30 days, derived from the password, so changing it signs everyone out. Share links keep their `#` across the redirect.
  - **Scripts** send it as Basic Auth (`curl -u :<password>`, any username).
  - **The server won't start against the real API without it**, just as it won't without the key. Health stays open for Fly's checks and never calls a model.
  - **Limits:** a shared password can't be revoked for one person (rotate the secret instead), and wrong guesses aren't slowed down, so a dictionary word can be found by trying a word list. Parasail's spend cap on the key is still the backstop.
- **Token storage / refresh:** there are no user tokens.
  - **The key** lives only in the server's environment: `.env` locally (git-ignored, kept out of the Docker build) or a Fly secret. The server refuses to start against the real API without one.
  - **The page never gets it:** **the build fails if anything shaped like a `psk-` key reaches the page bundle** (checked by planting one).
  - **Share links** keep their content after the `#`, which browsers never send to a server.
- **What happens on 401:** an upstream 401/403 means *our* key is broken. It becomes `service_misconfigured` with `source: playground`, isn't retried, and the card says it's our problem ("Playground setup problem"), never "invalid API key". It's the first thing I'd page on.
- **In production:** real auth (WorkOS or Clerk), per-user limits, and playground spend billed to org credits. **Known gap:** no attribution and no per-person revocation. Requests are traced by run and request ID, not by user.

## Data model

- **Tenancy:** **nothing is stored on the server, so there's no tenant data today.** Once auth and saved chats arrive, they're org → user → resource from day one:

```
orgs(id) → users(id, org_id) → chats(id, org_id, user_id, v, data)
shares(id, org_id, chat_id, created_by, expires_at, revoked_at)   -- every query filters by org_id; RLS as backstop
```

- **Browser vs server:**
  - **Browser:** chats in IndexedDB (the newest 100), **scoped to one browser profile, with no user or org isolation**.
  - **Server:** only the model-list cache, in memory.
  - **Prompt text is never logged:** the log line holds outcomes and sizes, never message text, including an upstream error's text. A test sends an upstream error that echoes the prompt and checks the logs.

```
Chat     { id, v, title, createdAt, updatedAt, columns: Column[1..2], sharedFrom? }
Column   { settings: { model, system, temperature, topP, maxTokens, stop, seed }, messages: Message[] }
Message    user { text }
         | assistant { runId, text, status, settingsUsed, attempts[], usage, costUsd }
```
- **Schema evolution:** saved chats and share links carry `v`, checked when read. Only v1 exists, so an upgrade step slots in there; records that can't be read are skipped, not deleted. Future server tables use numbered Postgres migrations.

## State management

- **Client:** one `useReducer` per chat (one or two columns); user actions map one-to-one onto reducer actions. A `rev` counter marks changes worth saving, so history saves when a run starts or ends and when settings change, never per token. Not Redux or Zustand: the state belongs to one screen.
- **Server-side caching:** `/v1/models` for 5 minutes. Concurrent refreshes share one call, and the last good list is served if a refresh fails. The browser shows its saved copy instantly. Completions are never cached.
- **At 10×:** a cache per instance is fine. Once per-visitor limits and a budget exist, they move to Redis so instances share one count. Then scale out.

## Error & resilience

- **Where the retry boundary lives:** in the browser, and only there. The BFF makes one upstream call per attempt and describes the failure (`type`, `source` = who owns the fix, `retryable`, `retryAfterMs`). Only failures that fix themselves are retried, only before the first token: 3 retries at about 1, 2 and 4 s with jitter, `Retry-After` wins, at most 10 s of automatic waiting, with a countdown and Cancel. Timeouts: 30 s first token, 20 s stall, 15 s heartbeat.
- **When a stream drops mid-request:** the partial text stays and the run is marked interrupted. It's never retried automatically once text is showing; the user chooses "Retry from the start". A retry resends an identical request body, to give prefix caching its best chance. Error boundaries keep a rendering crash from taking down the page.
- **When a 429 arrives:** the card says whose limit it is (`source`). On the preview, Parasail uses 429 for engine overload; the countdown waits it out (one answer arrived "after 2 retries"), and if it persists, "Model is busy" offers Retry or Switch model. `?_simulate=503` on the preview gives 3 retries over about 5 s, then "Model unavailable" with the run ID, answered by our server, never Parasail. A hidden Weather control (`?debug`) triggers each path in one click.
- **Would add for production:** resumable streams (designed), a retry budget in the BFF, and separate handling for overload and quota once the API tells them apart.

## Observability

- **Logs:** one JSON line per attempt to stdout, readable in Fly's log viewer.
  - **Fields:** run and request IDs, attempt number, model, outcome (`completed`, `interrupted`, `client_disconnected`, `error`, `rejected`), status, error type and source, token count, duration, any simulation or fault, and **Parasail's own request ID** (`x-parasail-request-id`) to join their logs.
  - **Never message text.**
  - **Copy debug info** hands users the IDs that find the line.
- **Metrics:** none built. Totals over those lines (errors by source, give-up rate, overload rate) in whatever ingests stdout.
- **Traces:** our `X-Request-Id` goes upstream on every call. No `traceparent` yet.
- **What I'd alert on first:**
  - our key broken (any `service_misconfigured`);
  - more than 5% of runs finally failing over 10 minutes (at least 20 runs);
  - the server down;
  - give-ups on Parasail overload.

## Tradeoffs I'd defend

1. **Hono + Vite over Next.js.** The page is client-only, so server rendering buys nothing. The BFF is where the work is: a visible middleware chain in one long-running process. That streams well, and it keeps an in-memory limiter accurate once there is one.
2. **Retries in the browser, not the BFF.** They're visible and cancelable, every attempt is logged, and no connections are held open during backoff.
3. **Normalizing the stream.** After `200 OK`, errors must travel inside the stream, and the BFF needs tokens and usage for logs and cost. Three events (`token`, `error`, `done`) beat making the browser parse OpenAI's format plus the errors we inject.
4. **Share links in the URL, no database.** It matches the brief, with no stored data to leak or migrate. The price is no expiry or revocation, which the share dialog states.

## What I'd build next

The extensions I'd tackle next, in order:

1. **Cost and rate-limit awareness (limits):** a per-visitor token bucket (30, one back every 2 s, retries count), at most 3 open streams per visitor, and a daily budget that reserves each request's maximum cost and settles on actual usage. **First**, because the preview is public on a real key and only Parasail's cap stands between a script and an empty key. The budget also needs each attempt's actual cost, which the log line doesn't carry yet.
2. **Observability, the full version:** the full per-attempt event (upstream time to first token, prompt/completion/cached tokens, cost, sizes, a hashed IP, the deploy version), a W3C `traceparent` header upstream, then metrics, the alerts above and an ops page. **Second**, because it builds on the same event the budget needs, and retries that succeed hide problems, so you need to see resilience working before tuning anything.

After that: real auth with the schema above (it changes the product: sign-in before the first token), a customer-facing request log in the Parasail console, and resumable streams once the logs show real `client_disconnected` rates. On the API itself: have `/v1/models` return names, prices, context sizes and capabilities, so the playground's own model table (dated list prices for 9 featured models) can go, and tell overload apart from quota on 429, with a `Retry-After`.
