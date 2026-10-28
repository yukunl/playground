# Parasail Playground

Speedboat take-home · Senior track · Path 1 (Model Playground).

> **Status: phases 1–5 and 8 of 9 (compare).** The core flow (⌘K model picker,
> settings, streaming markdown, Stop, stats line) survives failures: retries with a
> visible countdown, error cards with the attempt timeline, and **Weather control** on
> `?debug`. Chats are saved in this browser (**History**), and **Share** copies a link
> that carries the setup or the whole chat after the `#`. **Code** shows the same setup
> as a curl or Python call to Parasail's API. **Compare** (the switch
> in the prompt box) puts two setups next to each other: pick B's model or change any
> of B's settings, type once, and both answer. Phases 6
> (fuller logs) and 7 (per-visitor limits and a daily budget) are deferred.
> The plan is in [`docs/design.md`](docs/design.md) (section 29).

**Preview:** [speedboat-playground-yukunl.fly.dev](https://speedboat-playground-yukunl.fly.dev)
runs on the real Parasail API. Open the link and enter the shared preview password
on the sign-in page. The password is provided privately by the project owner;
it is not included in this repository. Sign-in lasts up to 30 days in that browser,
and share links continue to their destination after sign-in. Add `?debug` for
Weather control, or `?_simulate=503` to try an unavailable-model response.

Start with [`architecture-notes.md`](architecture-notes.md). The full reasoning is in
[`docs/design.md`](docs/design.md), and the submission notes are in [`NOTES.md`](NOTES.md).

## Run it

Clone the repository, then choose Docker or the local development setup:

```bash
git clone https://github.com/yukunl/playground.git
cd playground
```

With Docker and Docker Compose:

```bash
docker compose up --build
```

Open http://localhost:3000. The mock runs on http://localhost:3001 (Swagger at `/docs`).
No `.env` is needed: the app talks to the mock with the mock key.

Without Docker, install Node 22+ and Python 3.12 (recommended for the pinned mock
dependencies), then run:

```bash
npm ci
npm run dev:all
```

Open http://localhost:5173. `dev:all` starts the mock (creating `mock/.venv` on the
first run and installing its pinned Python dependencies), the Hono API on :3000,
and Vite on :5173, which forwards `/api` and `/login` to Hono. Stop the processes
with Ctrl+C; use `docker compose down` to stop the containers.

An existing `.env` overrides the default mock settings in both modes. To force a
local mock run while keeping a real-API `.env`:

```bash
PARASAIL_BASE_URL=http://localhost:3001 PARASAIL_API_KEY=psk-mock-mockkey PLAYGROUND_PASSWORD= PLAYGROUND_FAULTS=true npm run dev:all
```

To run the production build without Docker, keep the mock running in another
terminal with `npm run mock`, then:

```bash
npm run build
npm start
```

Open http://localhost:3000. With a real-API `.env`, `npm start` uses that API instead
and requires the configured preview password.

## Deploy (Fly.io)

The deployed preview uses the root [`Dockerfile`](Dockerfile) and
[`fly.toml`](fly.toml). The root [`docker-compose.yml`](docker-compose.yml) runs
the same app image with a local mock. The deployment targets the existing
`speedboat-playground-yukunl` Fly app in `sjc`.

With the Fly CLI installed and signed in to the app's organization, configure
`.env` as described below. Both the real Parasail key and the preview password
must be set as Fly secrets. Import them without putting their values in a command:

```bash
grep -E '^(PARASAIL_API_KEY|PLAYGROUND_PASSWORD)=' .env | fly secrets import -a speedboat-playground-yukunl
```

Then, from the repo root:

```bash
fly deploy --ha=false --build-arg GIT_SHA=$(git rev-parse --short HEAD)
```

`.dockerignore` keeps `.env` out of the build. To
run the preview on the mock instead, recreate the private mock app (deleted to save
cost; config in [`mock/fly.toml`](mock/fly.toml)) with
`fly apps create speedboat-playground-mock-yukunl` and `fly deploy mock --ha=false`,
then switch `PARASAIL_BASE_URL` in `fly.toml` to the commented mock address.

## Against the real Parasail API

Copy the example, then uncomment and fill in all three settings in your local
`.env`. The key and password below are placeholders:

```bash
cp .env.example .env
```

```dotenv
PARASAIL_BASE_URL=https://api.parasail.io/api/v1/openai
PARASAIL_API_KEY=psk-<accesskey>-<secretkey>
PLAYGROUND_PASSWORD=<your-private-preview-password>
```

Run `npm run dev` and open http://localhost:5173, or use `docker compose up --build`
and open http://localhost:3000. Sign in with the password you set. The server
refuses to use the real API without both a key and a password.

`.gitignore` excludes local environment files, dependencies, build output and test
reports. `.dockerignore` also excludes local environment files from the build
context. `.env.example` contains only comments and placeholders; a fresh local
mock run needs no environment file.

## Try the failure paths

`?_simulate=N` works the way the brief describes. The BFF passes it to the mock, or
answers it itself when pointed at the real API, so it never reaches Parasail.

```bash
curl -i "http://localhost:3000/api/models?_simulate=503"
```

In the page: open http://localhost:5173/?debug and pick a **Weather control** preset:

- **Busy, then recovers:** recovers after two 429s.
- **Model unavailable:** 503 every time, so 3 retries and then the give-up card.
- **Broken key:** 401, the playground's own key.
- **Stream drops:** the stream drops after 40 tokens.

To run the dev server against the mock with faults on, even when `.env` points at the real API:

```bash
PARASAIL_BASE_URL=http://localhost:3001 PARASAIL_API_KEY=psk-mock-mockkey PLAYGROUND_PASSWORD= PLAYGROUND_FAULTS=true npm run dev:all
```

## Check an agent's proposal

Ask a coding agent to find the best prompt and settings for something, and it can hand back its top two as a link. Compare opens with its claims above the columns, and ⌘↵ runs both live. The format is in [`docs/agent-handoff.md`](docs/agent-handoff.md).

**Example:** [open the hospital scheduling assistant proposal on the preview](https://speedboat-playground-yukunl.fly.dev/#s=eJztWFFv2zgS_isD4YAmgCLIdtyk2oei26K7wW3aoi1QHNb7MBZHFs8UqeNQdoSi__0wpGU72Ra49-tba43Ib2a--eZTvma7rJrlWecUZVXGFIY-y7PamaGznFV_fpXfgrYbzqqvMcxkVdajR0ZtrozBDq8Wi6ubcn3V9LdZnvHIgbqsyv7lBkBPEFoCrltSg9F2A8isOaAN0DgPH_WOPGtF8BtZ8mjgd8e9DmgKkAOcNSO0ZHroMWiygWHt3DaHzu0InIcabU0GsO-dtqGTiGJlV_azUziCZrh3VuGYw_s6uDV5mD_PYV7OnxfwuSWmI8R4k-vJAhsXuID3TUM-_RwkMge0CiztyENtUHcQHDARoB1DK6mRkShtazOomOoE-hkDPWgO8cfHSD-3mmFPtK1W9gruP95V8NZrQQuLEjDAbTVbwqt7yXVWXZfw4V4CX6NX2hm3GSv4QirGz28lfjarSnlBoj543aEfoUZPFXxuhxT3QuKuq1k67B09hCcI7p2Fd24Hcwm8qZbl4bzzW-U0iVlKzLxaLA_I3pDvMByCHh00K6v5lIpglgfX8mAhKcrbK_txMMRSQ3Beka9WdlbAXQPsOnKWQBHXXq-JgceuD65jCC0GqN1gFKylGUAd-Q3ZeoSLuiUO0KO2OQTvhrUhWHvC2K8cWG8sg2uAg3dbyqEl3I2wNkQqBoTWDZs2pBgyzVWLvrvMIZAxwopOkI5u8NBozwGYbCBbk1CjRmPgxWwm6W6c_CI0s4ReMJ1Aeuc6sG5fwBtnnwVwkXfBRaKfyKVtytRTb8ZiZecFvItc3OgdQUdK12gA1U7XVIF16S1cuyGkp9pKZaeySQ4sp_FgJD8PrdvLrb2nHj0V8Akj8bWP9IFA2Mm0AVrek0_TEO-OaQ2eCYy2VMHFcrm8hHJWXl1f39wUK7uYoHIrJx1TSuBQsJKHnjw7-4wfTYgA81Q7rzjdqGKNeNhsBP4eRxbQGwqxHTLUGA5HRbS1swHrAAPHACazI5m766QvNcbjiKZb0oWxKAV8EBzQk-sNTQ28H0-adRhv6J0XxVrZZQFvnT9lGDumOd5xlMAcGEdYe01N1BYMQqGI9iR3ex3ap1rxPI7C1NpGB4a9vB1aGgF5S0o0NR3PDnqD2ppRWEx2olWk4EM4V7ooly2Bl9mD2nWU2BwV0ibCJfpplhb2BNLNEYLuKE3oe0tn3BdMiSWx6ODpPwNxSKR9Lynu5eAIey-bYCK780nXEXaadaiSMB-Rxo0RT99qq2QmY1gOogw9-ci_HDigj1Iba7jKrmCVHSpnJbXwtGr5k7I4Sz-6K7H5lAMH6mEOLXKCmANZFS-uYJV9aXXdRnR757fpzNENL1fZygpPJhHQMpnTCMdaaWc5h2kwhH_fGYwjzVzTXAXX6zo_dCtmHrHNIqeKlf0nUR-famIYrCIPt6XgUkJ0oQoYtJsBN5SDdUc4_0a_cbbI8ixQ15PHMHjKqrKY51lw_Qf554s86_Dhs9uSmIbZsswzDq7Pqj__yjMmUll1Pf-WZwbX0T98wo4OSE9MyvJs345Zlb2CRj-QOlDtYtKbDkMdsz0UWso61epS1sgZPhB4EFx_1UNZvIjKITjgeh5ZDZwQxPdh4yIbQCuyISadsC0iLgZRKdfAIod9bGiHW2LQAQh5FPJ62mnaF3AngoqKgYNuGhk9ufjRStqQ9M4mrZQ3GIyzm6TFsXXIcHMNIRYzlznu8OHwX_Ezs2VZZN_yn8bspzH7acx-GrOfxuz_1pjtvQ6pyXscAaNRyYEeevJauK6g8c6GK0W8hdo5r7TFILYGzZYr2KPv8gTmbPXHjQXcOh8A6611e0NqQ5KqDFskY0tTJxsiw8kK6RAzL-CL8wpiKRisrGM0ZgSPkUyhRQuNM8btkxLL1jYY6KjrJ7vn_nerWMB3_M2snAzOU_cyO_Muy0fmZV6emZczy_IlFktOIwVKC1SyQQwM1u3f_Mup7kHE8Yk5mRVlLPPRnyzzRCsb95YqYAF-SAIY_mZWcEewOEGImGKtLzBAWdzmqW7zaFmmOHWZOpvs1toNVsn-iVIjG6Aohd0qWhiR9GR8eKv7ZOFr41j6NRmuHzmXF-WPncu8FOfyV54pj03Iqux3nUM3ymaTx58HYrEGGOAFdrAeDkjiTNVSgqGXh2KlC3iNFu4SBXRkxVuvFY4v4ZVhlwt_Ze_cgbQSAm7lkG4EvR567xqysKbGeXn5ZZZnvXe9YzTipdbSw9cGB0XwWv4ulmdBByN_H5ss0HdtUzX16bGtzYWqMmqx_jv0mpS4saETB5BV2W8OTSXr8bEBQ7hodC21RnMJ7XRzVCWZAE5Wi-OxyWxxmgU-N0SyCPjJFsqT3vNxeYs_eqLvEXa8B9TgY6JnC7xY2btIHlIwh967rg_AYRSdchaWE1sZLtKUWulyDudrH4_b78gq-bEdeI1WPYYTv0jUycAcBCJMHu2yguVtXOzx_g8HG5wfNtk_yqIsb2RTozEFiJcRKPWWoTcDR9MefWLsWtqj0MiQSG5rQx2nNX8Q4EPGDBdSocMXmHztfqdUOVDXh_Goc3EXcw4xtySBe93ELSb6eEo_7a7LX0QMBAofPovSOv1DDD4sigXclL9Cj8ykJDtYJilZu9BCoy2aCWwB95qDOPlPnQQuijnMr3-V0atbwl6sgwydDrGQpNI-kvLCKjuWepUlxonRFjQHq33mqNPC_gXuQGklG9bTVRQa-fIWbKmO59BW9hN2vbBHfAgLviggsUkx_iBZIu5i68TzFXHWIfhRvrXvnu0IWlRnHAPW6e8RmqFz3sYVX0fhSJjryTZrFg3pnPdu__KQoXy-i3DrjqRG3Tj1Bt7gTit43dITU3Qq2MtVln379l8gThsV). Claude Code tuned it against the real API; press ⌘↵ to run both choices.

The same link for a local run:

```bash
npm run share-link -- examples/hospital-scheduler.json --base http://localhost:3000/
```

Use `--base http://localhost:5173/` for `dev:all`. Locally against the mock, both columns give the same reply, because the mock ignores the prompt and settings.

## Connect your agent

Bring your own Claude Code or Codex. **Agent** in the header makes a token and walks through connecting it to `/api/mcp`. Your agent tests a bounded set of models and settings against your baseline, checking accuracy, cost and latency; the playground opens the finalists side by side, so you can inspect them and try them yourself. The steps, the tools and what keeps it safe are in [`docs/connect-an-agent.md`](docs/connect-an-agent.md), with an example in [`examples/support-triage/`](examples/support-triage/).

## Scripts

| Script | What |
|---|---|
| `npm run dev:all` | Mock + API + Vite, with reload |
| `npm run dev` | API + Vite, with reload; start the mock separately if using it |
| `npm run build` | Page → `dist/client`, server → `dist/server`. Fails if a Parasail key reaches the page bundle. |
| `npm start` | The production server (serves the page and `/api`) |
| `npm test` | Unit and BFF tests (Vitest) |
| `npm run typecheck` | TypeScript |
| `npm run mock` | The mock alone, without Docker |
| `npm run share-link -- file.json` | An agent's proposal → a playground link (`docs/agent-handoff.md`) |

## Layout

| Path | What |
|---|---|
| `src/server/app.ts` | Hono routes and middleware |
| `src/server/routes/chat.ts` | `POST /api/chat`: validate, call upstream once, stream our three events |
| `src/server/routes/mcp.ts`, `src/server/mcp/` | `POST /api/mcp`: the MCP server for coding agents and its three tools |
| `src/server/agent-token.ts` | Agent tokens: signed, expiring, open `/api/mcp` only |
| `src/server/upstream/` | The only code that talks to the inference API: client, stream normalizer, error translation, `_simulate`, model catalog |
| `src/shared/sse.ts` | The SSE parser, used for the upstream's stream and for ours |
| `src/client/chat/` | Chat state (reducer), streaming with frame batching, markdown, composer, divider, compare columns |
| `src/client/settings/` | Settings panel, ⌘K model picker, field validation (shared zod schema) |
| `src/client/history/` | Saved chats in IndexedDB: the stored format, the store, autosave and the History drawer |
| `src/client/code/` | The Code dialog: the setup as a curl or Python call, from the same request builder the server uses |
| `src/client/share/` | Share links: encode and decode (deflate + base64url, zod-checked), the Share dialog, the agent-proposal banner |
| `src/client/ui/` | Thin Tailwind wrappers around Radix primitives (slider, tooltip, dialog) |
| `src/server/config.ts` | Environment variables, with defaults that point at the mock |
| `src/shared/` | Shared by page and server: types (the error shape, models) and the request builder |
| `src/client/` | The React page |
| `tests/` | `unit/` and `bff/` (in-memory with `app.request()`, against a fake upstream) |
| `mock/` | Unchanged copy of the Parasail mock |
