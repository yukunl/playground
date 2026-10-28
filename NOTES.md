# NOTES

## Path(s) chosen

Path 1, Model Playground, with:
- two-column **Compare** for user story 2 ("tweak the system prompt, see old and new side by side");
- **agent proposals:** an agent's top two settings open side by side from a link, so a person judges live answers instead of the agent's best runs.

## Total time spent

~**[fill in]** hours. The design came first, as a one-question-at-a-time session (`docs/design.md`). The build ran in phases from October 24 to 26, each phase committed separately.

## Production-shape extension I built

- **Resilience to mock errors.**
  - **One retry loop, in the browser:** 3 retries at about 1, 2 and 4 s with jitter. `Retry-After` takes priority and is never shortened. Automatic waiting is capped at 10 s in total, and only failures before the first token are retried.
  - **What you see:** a countdown with Cancel, then a clear card when the third retry fails, listing every attempt and its timing.
  - **Partial streams** keep their text and become "interrupted" instead of retrying silently.
  - **Timeouts:** 30 s to the first token and 20 s for a stalled stream, with a 15 s heartbeat.
  - **Errors are sorted by who can fix them** (you / it fixes itself / us), and each names its source (`network` / `playground` / `inference`).
  - **Trying it:** the mock's `?_simulate` switches work on the playground URL (`?_simulate=503`), and a hidden Weather control (`?debug`) triggers the main failure paths in one click.

To support it, I built thin slices of two other extensions:
- **observability:** IDs end to end, one structured log line per attempt that carries Parasail's own request ID, and "Copy debug info";
- **cost awareness:** cost per answer and per chat, from a dated price table.

## Production concerns I'd tackle next

- **Per-visitor limits and a daily budget first:** a token bucket per visitor, at most 3 open streams, and a budget that reserves each request's maximum cost. The preview is public on a real key, so today only Parasail's spend cap stands between a script and an empty key.
- **Full observability second:**
  - the complete per-attempt event (time to first token, token usage, cost, sizes, deploy version);
  - a `traceparent` header upstream;
  - an ops page and alerts.

  Retries that succeed hide problems from users, so seeing how often resilience is working comes before tuning anything else.
- *Later:* real auth and multi-tenant data. They change the product, because sign-in would stand in front of the 60-second first token. The tenant-aware schema is sketched in `architecture-notes.md`.

## Stack

- **Frontend:** React 19 + Vite, Tailwind + Radix primitives (thin wrappers in `src/client/ui/`), react-markdown.
- **Backend (if any beyond the mock):** a thin Hono BFF on Node 22, in one process with the page. It holds the key, validates and caps each request, normalizes the stream into three events (`token` / `error` / `done`), and logs one line per attempt.
- **DB:** none. Chats live in the browser (IndexedDB), and share links carry their content in the URL fragment.
- **Local run command:** `docker compose up` (app + mock, no `.env` needed). Both images build (Fly built them for the preview), but I couldn't run Compose itself on my machine, so `npm run dev:all` is the path I tested locally.
- **Hosting / preview URL, if any:** Fly.io: https://speedboat-playground-yukunl.fly.dev, on the real Parasail API, with the key as a Fly secret. It stops working when the key expires after the deadline.
- **Auth provider / approach:** no accounts, by design (key on the server). The page and every `/api` route except health sit behind a shared password (`PLAYGROUND_PASSWORD`: a sign-in page and cookie for browsers, Basic Auth for scripts), so nobody else can spend the key, including by calling `/api/chat` directly.
- **Observability tool (or stub):** structured JSON logs to stdout, read in Fly's log viewer, one line per attempt with run, request and upstream request IDs.

## AI tools used

Claude Code, heavily, for both design and implementation. I ran several sessions in parallel: one built history, sharing and Compare while another did the streaming display, the Parasail theme, accessibility fixes and agent proposals. Each landed as its own commit.

- **Design:** I worked through about 30 decisions one question at a time, each with a recommendation I could accept or push back on. Several changed because I pushed back:
  - one conversation with competing "runs" and locking → **simple compare columns**;
  - error source named `parasail` vs `playground` → **`inference` vs `playground`**, named after who owns the fix;
  - server-stored share links → **back to links that carry their own content**, as the brief says;
  - "View code" and a command menu → **cut**. A review then pointed out that a developer who found good settings had no way to take them into code, so View code came back as **Code**;
  - the whole build → **cut about in half** after a scope review against the brief.
- **Where it produced something I replaced, or that testing caught:**
  - In a first attempt it scaffolded code before the architecture was designed, so I started over, design first.
  - **Logging:** its first logging only covered successful streams. Clicking through failures in the browser showed that the failures on-call needs were invisible, so now every attempt writes a line.
  - **Time to first token** included the retry waits; it now counts from the attempt that succeeded.
  - **`.env`:** it told me the server read `.env` when it didn't, so it now loads it at startup.
  - **The preview's 429s:** it first blamed them on my key's rate limit. Parasail's message said "The engine is currently overloaded", so the docs now say that.
  - **Fly:** the mock listened on IPv4 while Fly's private network is IPv6, and Fly's 5 s shutdown timeout would have cut off the 30 s stream drain. Both were fixed in config.
- **Where I chose against it:**
  - I first wanted all three of resilience, observability and cost limits. I built one extension deep, as the brief asks.
  - Later I questioned whether the planned observability and limits phases were needed, and skipped them.
  - I ran the preview on the real API rather than the mock the design planned, so reviewers see real models and Compare columns that actually differ.

## What I cut, and why

- **Per-visitor limits, the daily budget and the full log event** (designed as phases 6 and 7, built only as thin slices). The brief asks for one extension, and building three would have spread the work thin. Limits are first on my next list.
- **An ops page, alerts and a support-report inbox:** designed (`docs/design.md`, section 24.4) but not built, for the same reason.
- **Server-side share storage:** links carry their own content instead. That matches the brief, and it means no database, no migrations and no stored prompts. The cost is no expiry or revocation.
- **Resumable streams:** designed but not built. It fixes a rare failure for desk users at the cost of state held across requests. I'd build it when the logs show `client_disconnected` happening often.
- **A third compare column, prompt versions, history search:** polish over scope.
- **Running the settings search inside the playground:** agents run it with their own calls and hand back a proposal link. In the playground, one search is dozens of calls on the shared key, so it would need the per-visitor limits and budget first.

## What breaks at 10× / 100×

- **First thing that breaks:** the shared upstream capacity. It already shows at 1×: Parasail answers some requests with "engine overloaded", and the retry loop covers it. At 10×, more runs would end on the "Model is busy" card. Close behind: with no per-visitor limit, one script can use up the key's spend cap for everyone.
- **Second (100×):** the single shared key, because all playground traffic goes through one key. Then thousands of long-lived connections per instance, and the cost of logging every attempt in full.
- **What I'd do about it:**
  - per-visitor limits and the reserve-then-settle daily budget, moved to Redis once there's more than one instance, then scale out;
  - a higher-limit internal key or a key pool now, and per-org keys through auth later;
  - keep every error log line but sample successes;
  - resumable streams.

## Anything you want a reviewer to know

- **Try the failures:** add `?_simulate=503` to the URL for the full retry → give-up flow, or open `?debug` for Weather control: it recovers after two 429s, fails every time, simulates a broken key, or drops the stream partway through. Simulated failures are answered by our server and never reach Parasail.
- **Real countdowns on the preview are Parasail being busy, not a bug.** Parasail sometimes answers `429` "The engine is currently overloaded", with no `Retry-After`. The countdown waits it out, and the stats line notes "after N retries".
- **Against the mock (locally), compare columns show the same text, and that's the mock, not a bug.** The mock picks its reply from your last message only and ignores the system prompt, model and settings. Hover an answer's stats to see the exact settings it sent. Against the real API (the preview), the columns differ.
- **The auth surface is small on purpose.** Where to look:
  - `src/server/upstream/client.ts`: the only place the key is used (the `Authorization` header);
  - `src/server/config.ts`: refuses to start against the real API without a key;
  - `scripts/check-bundle-secrets.mjs`: fails the build if a `psk-` key reaches the page;
  - `.dockerignore`: keeps `.env` out of the image;
  - `fly.toml`: the key is a Fly secret.
- **From the playground to code.** **Code**, next to Share, shows the setup as a curl or Python call to Parasail's API. It's generated from the same request builder the server uses, so the model, prompt and settings match what the playground sent, and it uses your own `PARASAIL_API_KEY`.
- **An agent's proposal you can check.** People often ask a coding agent to find good prompts and settings, then want proof. The agent hands back its top two as a setup link: its claims sit above the columns, and ⌘↵ runs both live, so the answers can't be its best runs picked out.
  - **Example:** [a hospital scheduling assistant on the preview](https://speedboat-playground-yukunl.fly.dev/#s=eJztWFFv2zgS_isD4YAmgCLIdtyk2oei26K7wW3aoi1QHNb7MBZHFs8UqeNQdoSi__0wpGU72Ra49-tba43Ib2a--eZTvma7rJrlWecUZVXGFIY-y7PamaGznFV_fpXfgrYbzqqvMcxkVdajR0ZtrozBDq8Wi6ubcn3V9LdZnvHIgbqsyv7lBkBPEFoCrltSg9F2A8isOaAN0DgPH_WOPGtF8BtZ8mjgd8e9DmgKkAOcNSO0ZHroMWiygWHt3DaHzu0InIcabU0GsO-dtqGTiGJlV_azUziCZrh3VuGYw_s6uDV5mD_PYV7OnxfwuSWmI8R4k-vJAhsXuID3TUM-_RwkMge0CiztyENtUHcQHDARoB1DK6mRkShtazOomOoE-hkDPWgO8cfHSD-3mmFPtK1W9gruP95V8NZrQQuLEjDAbTVbwqt7yXVWXZfw4V4CX6NX2hm3GSv4QirGz28lfjarSnlBoj543aEfoUZPFXxuhxT3QuKuq1k67B09hCcI7p2Fd24Hcwm8qZbl4bzzW-U0iVlKzLxaLA_I3pDvMByCHh00K6v5lIpglgfX8mAhKcrbK_txMMRSQ3Beka9WdlbAXQPsOnKWQBHXXq-JgceuD65jCC0GqN1gFKylGUAd-Q3ZeoSLuiUO0KO2OQTvhrUhWHvC2K8cWG8sg2uAg3dbyqEl3I2wNkQqBoTWDZs2pBgyzVWLvrvMIZAxwopOkI5u8NBozwGYbCBbk1CjRmPgxWwm6W6c_CI0s4ReMJ1Aeuc6sG5fwBtnnwVwkXfBRaKfyKVtytRTb8ZiZecFvItc3OgdQUdK12gA1U7XVIF16S1cuyGkp9pKZaeySQ4sp_FgJD8PrdvLrb2nHj0V8Akj8bWP9IFA2Mm0AVrek0_TEO-OaQ2eCYy2VMHFcrm8hHJWXl1f39wUK7uYoHIrJx1TSuBQsJKHnjw7-4wfTYgA81Q7rzjdqGKNeNhsBP4eRxbQGwqxHTLUGA5HRbS1swHrAAPHACazI5m766QvNcbjiKZb0oWxKAV8EBzQk-sNTQ28H0-adRhv6J0XxVrZZQFvnT9lGDumOd5xlMAcGEdYe01N1BYMQqGI9iR3ex3ap1rxPI7C1NpGB4a9vB1aGgF5S0o0NR3PDnqD2ppRWEx2olWk4EM4V7ooly2Bl9mD2nWU2BwV0ibCJfpplhb2BNLNEYLuKE3oe0tn3BdMiSWx6ODpPwNxSKR9Lynu5eAIey-bYCK780nXEXaadaiSMB-Rxo0RT99qq2QmY1gOogw9-ci_HDigj1Iba7jKrmCVHSpnJbXwtGr5k7I4Sz-6K7H5lAMH6mEOLXKCmANZFS-uYJV9aXXdRnR757fpzNENL1fZygpPJhHQMpnTCMdaaWc5h2kwhH_fGYwjzVzTXAXX6zo_dCtmHrHNIqeKlf0nUR-famIYrCIPt6XgUkJ0oQoYtJsBN5SDdUc4_0a_cbbI8ixQ15PHMHjKqrKY51lw_Qf554s86_Dhs9uSmIbZsswzDq7Pqj__yjMmUll1Pf-WZwbX0T98wo4OSE9MyvJs345Zlb2CRj-QOlDtYtKbDkMdsz0UWso61epS1sgZPhB4EFx_1UNZvIjKITjgeh5ZDZwQxPdh4yIbQCuyISadsC0iLgZRKdfAIod9bGiHW2LQAQh5FPJ62mnaF3AngoqKgYNuGhk9ufjRStqQ9M4mrZQ3GIyzm6TFsXXIcHMNIRYzlznu8OHwX_Ezs2VZZN_yn8bspzH7acx-GrOfxuz_1pjtvQ6pyXscAaNRyYEeevJauK6g8c6GK0W8hdo5r7TFILYGzZYr2KPv8gTmbPXHjQXcOh8A6611e0NqQ5KqDFskY0tTJxsiw8kK6RAzL-CL8wpiKRisrGM0ZgSPkUyhRQuNM8btkxLL1jYY6KjrJ7vn_nerWMB3_M2snAzOU_cyO_Muy0fmZV6emZczy_IlFktOIwVKC1SyQQwM1u3f_Mup7kHE8Yk5mRVlLPPRnyzzRCsb95YqYAF-SAIY_mZWcEewOEGImGKtLzBAWdzmqW7zaFmmOHWZOpvs1toNVsn-iVIjG6Aohd0qWhiR9GR8eKv7ZOFr41j6NRmuHzmXF-WPncu8FOfyV54pj03Iqux3nUM3ymaTx58HYrEGGOAFdrAeDkjiTNVSgqGXh2KlC3iNFu4SBXRkxVuvFY4v4ZVhlwt_Ze_cgbQSAm7lkG4EvR567xqysKbGeXn5ZZZnvXe9YzTipdbSw9cGB0XwWv4ulmdBByN_H5ss0HdtUzX16bGtzYWqMmqx_jv0mpS4saETB5BV2W8OTSXr8bEBQ7hodC21RnMJ7XRzVCWZAE5Wi-OxyWxxmgU-N0SyCPjJFsqT3vNxeYs_eqLvEXa8B9TgY6JnC7xY2btIHlIwh967rg_AYRSdchaWE1sZLtKUWulyDudrH4_b78gq-bEdeI1WPYYTv0jUycAcBCJMHu2yguVtXOzx_g8HG5wfNtk_yqIsb2RTozEFiJcRKPWWoTcDR9MefWLsWtqj0MiQSG5rQx2nNX8Q4EPGDBdSocMXmHztfqdUOVDXh_Goc3EXcw4xtySBe93ELSb6eEo_7a7LX0QMBAofPovSOv1DDD4sigXclL9Cj8ykJDtYJilZu9BCoy2aCWwB95qDOPlPnQQuijnMr3-V0atbwl6sgwydDrGQpNI-kvLCKjuWepUlxonRFjQHq33mqNPC_gXuQGklG9bTVRQa-fIWbKmO59BW9hN2vbBHfAgLviggsUkx_iBZIu5i68TzFXHWIfhRvrXvnu0IWlRnHAPW6e8RmqFz3sYVX0fhSJjryTZrFg3pnPdu__KQoXy-i3DrjqRG3Tj1Bt7gTit43dITU3Qq2MtVln379l8gThsV), which Claude Code tuned in 58 real calls (about $0.007). Press ⌘↵ to run both choices.
  - **Format and the search log:** `docs/agent-handoff.md`.
  - **Locally:** `npm run share-link -- examples/hospital-scheduler.json` makes the same link. Against the mock both columns match; `docs/images/proposal-side-by-side.jpg` shows a real-API run.
- **Start with `architecture-notes.md`.** The full reasoning, including what's designed but not built, is in `docs/design.md`.
- **Parts I'm not happy with:**
  - The public preview has no per-visitor limit on a real key.
  - There are no end-to-end browser tests; only unit and BFF tests, plus hand checks in the browser.
  - `docker compose up` wasn't run end to end on my machine.
  - Word-by-word display pauses in a background tab (browsers stop animation frames there), so an answer finishes appearing when you come back.
  - The featured models' prices are copied by hand and dated.
