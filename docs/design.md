# Parasail Playground: design

**Speedboat take-home · Senior track · Path 1 (Model Playground)**
Status: design complete, focused scope, **nothing built yet** · Last updated 2026-10-24 (revision 3)

> **How to read the labels:** anything not labelled is **planned for v1**, meaning in scope to build (nothing is built yet). **(Design only)** means designed and documented but deliberately not built; it feeds "what I'd build next". **(Proposed)** marks defaults filled in while writing this doc that weren't discussed, and they're open to change.
>
> **Revision 2** applies the scope review: resilience is the one extension, and cost and observability are planned only as thin slices. Sharing is back to the link itself (no server storage, no database). `_simulate` is wired in as the brief describes, and a crash fallback, a 100× analysis and NOTES.md were added.
>
> **Revision 3** applies a second review. Logging uses an allowlist, so prompts can't leak through upstream errors. The daily budget reserves each request's maximum cost and is described as best effort. The 10 s limit on automatic waiting is now a total. Share links use `deflate` everywhere. Compare mode says when the mock is ignoring your settings. Required acceptance checks were added (section 27).

## Contents

1. [Summary](#1-summary)
2. [Scope: what's planned vs design only](#2-scope-whats-planned-vs-design-only)
3. [Goals and non-goals](#3-goals-and-non-goals)
4. [User stories and how the design meets them](#4-user-stories-and-how-the-design-meets-them)
5. [Assumptions](#5-assumptions)

**Part A: Functional design**
6. [Layout and the first 60 seconds](#6-layout-and-the-first-60-seconds)
7. [Settings panel](#7-settings-panel)
8. [Streaming](#8-streaming)
9. [Compare mode](#9-compare-mode)
10. [History](#10-history)
11. [Sharing by link](#11-sharing-by-link)
12. [Errors](#12-errors)
13. [Limits, as the user sees them](#13-limits-as-the-user-sees-them)
14. [Keyboard and focus](#14-keyboard-and-focus)
15. [Visual style](#15-visual-style)
16. [Triggering failures: `_simulate` and Weather control](#16-triggering-failures-_simulate-and-weather-control)

**Part B: Technical design**
17. [Architecture](#17-architecture)
18. [Stack and libraries](#18-stack-and-libraries)
19. [API](#19-api)
20. [Streaming protocol](#20-streaming-protocol)
21. [Data model](#21-data-model)
22. [Resilience](#22-resilience)
23. [Limits and cost](#23-limits-and-cost)
24. [Observability](#24-observability)
25. [Security and privacy](#25-security-and-privacy)
26. [Deployment and configuration](#26-deployment-and-configuration)
27. [Testing](#27-testing)
28. [Project layout (Proposed)](#28-project-layout-proposed)
29. [Build order and cut list](#29-build-order-and-cut-list)
30. [What breaks at 10× and 100×](#30-what-breaks-at-10-and-100)
31. [Open questions](#31-open-questions)
32. [Decision log](#32-decision-log)

[Appendix A: Defending it](#appendix-a-defending-it)

---

## 1. Summary

A web playground where a developer evaluating Parasail picks a model, pastes a prompt and watches tokens stream within seconds. They can then compare two setups side by side, keep a local history, and share a chat by link.

One theme ties the production work together:

> **Every failure either explains itself, or gives you one ID that support can use.**

Parasail's customers are application developers who depend on someone else's infrastructure, and to them Parasail *is* the infra team. When a request fails, they need to know whether it's their code, their limit or the platform. The playground is their first look at what debugging on Parasail feels like. Being easy to support is part of what's being sold.

**Production-shape extension: Resilience to mock errors, built deep.** That means retry and backoff in the client driven by the mock's `?_simulate` switches, honest handling of partial streams, timeouts, and a clear screen when the third retry fails.

**Next on the list: observability, then cost awareness.** Only the slices resilience depends on are planned for v1:
- **Observability slice:** request and run IDs end to end, one structured log line per attempt, and "Copy debug info" on every error.
- **Cost slice:** the cost of each run plus a running total, and the limits that protect a key shared by anonymous visitors.

The full versions (an ops page, alerts, spend tracking) are designed in sections 23–24 but not built. They're one feature seen from three sides: a single 429 is a rate limit, a retry and a log line at once.

## 2. Scope: what's planned vs design only

The brief asks for **one** extension, built seriously, and warns that a checklist of production concerns can become a time sink. Its ground rules ask for a focused take-home. So the build stays focused, and everything else is written down as a design.

| Area | Planned for v1 | Design only |
|---|---|---|
| **Path 1 core** | Model picker, collapsible system prompt, streaming, the 5 parameters, Stop, local history, share by link | — |
| **Resilience** (the extension) | Error translation, retry loop with countdown and Cancel, give-up card with attempt timeline, timeouts and heartbeat, partial-stream handling, **`?_simulate`**, two extra fault switches, Weather control (4 presets), crash fallback screens | Resumable streams; a retry budget in the BFF |
| **Observability** (slice) | Run and request IDs end to end (and upstream), one JSON log line per attempt, "Copy debug info" | Browser timing reports, `/admin/ops` page, alerts, Slack webhook, events storage |
| **Cost and limits** (slice) | Cost per run + chat total; per-request caps, per-visitor token bucket, 3 open streams, daily budget | Spend dashboard, budget alerts, prices from an API |
| **Compare** (user story 2) | 2 columns: duplicate, change B, type once, re-run last message; A/B tabs on narrow screens | 3 columns, the three-way Compare menu, row-aligned turns |
| **Extras** | Shortcuts, ⌘K model picker, plain error headlines with icons, **Code** (curl or Python; added after a review, §11.2) | Earlier system-prompt versions, history search, support-report inbox and admin page |

**Estimated build: about 15–18 hours** (section 29).

## 3. Goals and non-goals

**Goals**
1. The first token arrives within 60 seconds of landing. The target is under 10 seconds for someone with a prompt ready.
2. All three user stories from the brief work end to end.
3. Every failure tells the user what happened, whose problem it is and what to do.
4. Any failure can be traced from one ID: debug info → run ID → every attempt's log line.
5. Cost is bounded: a best-effort daily budget inside the app, with the provider's spend cap on the key as the hard backstop.
6. The same Docker image runs locally and in the preview.
7. **Nothing is stored on the server.**

**Non-goals for v1:** user accounts and orgs, everything marked *Design only* above, branching conversations, and mobile-first layout (narrow screens work, but desktop is the target).

## 4. User stories and how the design meets them

| Story from the brief | How it's met |
|---|---|
| *First token within 60 seconds of landing* | Nothing before typing. The input is focused on load. The model list comes from the browser's saved copy. ⌘↵ runs. No spinner for the first 300 ms. |
| *Tweak the system prompt, run again, see new vs old side by side* | **Compare** copies the chat into B. Change B's system prompt in Settings, then **Run again** on B's last answer. B's header shows its system prompt, and A's shows A's. |
| *Copy a share link, a teammate opens it pre-filled* | **Share** puts the model, settings and prompt (or the whole chat) **in the link itself**. Opening it creates the teammate's own local copy. |

## 5. Assumptions

- **Reviewers are a small, trusted group.** The preview may sit behind one shared password.
- **The preview runs against the real API** (changed on October 26; the plan was the mock). The key's spend cap and rate limits are Parasail's, and it expires after the submission deadline, which may fall during review; switching `PARASAIL_BASE_URL` back to the mock is one line in `fly.toml`.
- **Users are mostly developers at a desk.**

---

# Part A: Functional design

## 6. Layout and the first 60 seconds

**Rule: nothing stands between landing and typing.** No sign-up, no tour, no pop-ups, no cookie wall.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Parasail Playground                                          Share  ☾  ⌘/    │
├────────────┬────────────────────────────────────────┬────────────────────────┤
│ + New chat │                                        │ Settings      ↺    ✕   │
│ History    │          Ready when you are.           │ System prompt          │
│ Explain p… │  Pick a model, write a prompt, ⌘↵.     │ [Add a system prompt]  │
│ Write a h… │                                        │ Temperature  ──●─ 0.7  │
│ How does…  │  [ Explain prompt caching in 3… ]      │ Max tokens   1024      │
│            │  [ Write a Python function to… ]       │ Top-p        ───● 1.0  │
│            │  [ Summarize a support ticket… ]       │ Stop [ ]  Seed [ ]     │
│            │ ┌────────────────────────────────────┐ │                        │
│            │ │ Paste your prompt…                 │ │                        │
│            │ │ [Single|Compare] [Llama 70B ▾] ⚙ Run│ │                        │
│            │ └────────────────────────────────────┘ │                        │
└────────────┴────────────────────────────────────────┴────────────────────────┘
```

| Decision | Choice | Why |
|---|---|---|
| Layout | New chat and History on the left; the chat in the middle; settings on the right, in both modes. Each sidebar can be shown or hidden. The mode (Single or Compare), the model and Run sit in the prompt box, like Arena's. | Everything about the next message is where you type it, and settings stay in one place whatever the mode. Settings close from the prompt box's Settings button or their own ✕. |
| Focus | The input box is focused on load | Paste and press ⌘↵ without touching the mouse |
| Default model | `parasail-llama-3.1-70b-instruct` on the first visit, then the last one used. If it's missing, the first chat-capable model. | The first answer is the sales pitch |
| System prompt | Empty, with grey example text | **What you see is what gets sent.** Evaluators are testing their own prompt. |
| Sampling defaults | temperature 0.7 · max tokens 1024 · top-p 1.0 · no stop · no seed | Sensible for most prompts |
| Example prompts | Three buttons that run when clicked | One click to see streaming |
| Model list | Show the browser's saved copy instantly and refresh in the background. If the refresh fails, show a thin banner and keep using the saved list. The BFF caches `/v1/models` for 5 minutes, shares one upstream call between concurrent requests, and serves the last good list (marked `stale`) if a refresh fails. | The mock adds 50–300 ms. The input never waits for the network. |
| Model picker | **Featured** models from our model table first (friendly name, price), then **Other models** (raw IDs, searchable). Non-chat models are hidden. ⌘K opens it. | The real API lists 98 IDs with no metadata, duplicates and non-chat models; section 23.4 |

*(Design only: measuring time from landing to first token through browser reports, section 24.4.)*

## 7. Settings panel

These are the five parameters from the brief, plus the system prompt. Nothing else.

**Where (2026-10-27):** a sidebar on the right in Single and Compare alike (a drawer below 1024 px), with ↺ Reset and ✕ in its header; the **Settings** button in the prompt box, next to Run, shows or hides it. The model isn't here: it's a chip in the prompt box. In Compare every setting has an A and a B control (section 9). Shown or hidden is remembered in `localStorage`; on phones the drawer stays closed until opened.

| Setting | Control and range | Notes |
|---|---|---|
| Temperature | Slider plus a number box, 0–2 in steps of 0.1 | |
| Max tokens | Number box, 1 up to `min(4096, context_length − estimated prompt tokens)` | The ceiling moves when you switch models |
| Top-p | Slider plus a number box, 0–1 | Shown with the rest (2026-10-27: no longer folded under "More") |
| Stop sequences | Chips, at most 4 | |
| Seed | A number, or empty for random. 🎲 picks one. | Tooltip: *"Same seed and settings usually give the same answer. Best effort, not guaranteed."* |
| System prompt | Collapsed: the first line and a token count. Expanded: a box that grows with the text. | It's paid for on every message |

- **Tooltips name the API field** (`temperature`, `top_p`, `max_tokens`, `stop`, `seed`).
- **A dot marks anything changed from the default**, and **↺ Reset** restores all of it.
- **Mistakes are caught as you type**, with the same zod schema and wording the server uses.
- **Settings can change partway through a chat.** A change applies to the next message, and a divider records it: `──── switched to llama-70b · temp 0.3 ────`.
- *(Design only: a list of earlier system-prompt versions to restore.)*

## 8. Streaming

```
You   Explain prompt caching in 3 bullets.

AI    • Caches the processed prefix of a prompt, so repeated
        requests skip recomputing it.
      • Works best when the stable part of the prompt comes first▌
      streaming · 96 tokens · 47 tok/s                 [ ■ Stop ]  (Esc)

      … when done:
      212 tokens · 340 ms to first token · 48 tok/s · ≈$0.00009        ⧉ Copy
```

| Topic | Behavior |
|---|---|
| Markdown | Rendered as it arrives |
| Untrusted output | No raw HTML, unsafe links stripped |
| Code blocks | Plain monospace while streaming, syntax colors once the block closes, a copy button and language label |
| Painting | At most once per animation frame, however fast tokens arrive |
| Auto-scroll | Follows the stream only while you're at the bottom. Scroll up and **↓ Jump to latest** appears. |
| Stop | Run turns into Stop in the same place (also Esc). The partial text stays. The model call really stops. |
| Cut off | *"Cut off at 1024 tokens."* `[Raise max tokens and run again]` |
| Waiting | 0–300 ms: nothing extra. After 300 ms: **"Waiting for the model…"**. After 5 s: **"Still waiting… long prompts take longer to read."** Retrying: the countdown. |
| Stats | Time to first token, measured from the start of the **attempt that succeeded** (retry waits aren't the model's latency), with "· after 2 retries" added when there were any; tok/s = completion tokens ÷ (total − time to first token); cost shown as `≈` (hover for tokens, request ID, attempts, **the settings this run sent**, and *"≈11,000 runs like this per $1"*). No price → no cost. |
| Chat total | Under the prompt box, right-aligned by Run: *"This chat so far 812 tokens ≈$0.0012"* (in compare, *"Both panels so far"*). Tokens are what the API reported, or ≈ an estimate from the text when it didn't report. It was in the header, where it read as app-wide rather than this chat's. |

## 9. Compare mode

A chat has 1 or 2 **columns**. Each column is its own plain conversation with its own settings. A normal chat is one column.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Parasail Playground                                          Share  ☾  ⌘/    │
├───────────────────────────────────────┬──────────────────────────────────────┤
│ A Llama 3.1 70B            600 tok    │ B Llama 3.1 8B             312 tok   │
│   system prompt “You are a senior…”   │   system prompt “You are 5.”         │
│   temperature 0.2                     │   temperature 0.9                    │
├───────────────────────────────────────┼──────────────────────────────────────┤
│ You: Explain prompt caching…          │ You: Explain prompt caching…         │
│ AI:  • Caches the processed…          │ AI:  • Imagine the model puts a…     │
│ 212 tokens  340 ms  ≈$0.00009         │ 388 tokens  355 ms  ≈$0.00016        │
├───────────────────────────────────────┴──────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Type once, sent to A and B…                                              │ │
│ │ [Single|Compare] [A Llama 3.1 70B ▾] [B Llama 3.1 8B ▾]  ⚙ Settings  Run │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                       Both panels so far 912 tokens ≈$0.0005 │
└──────────────────────────────────────────────────────────────────────────────┘
```

The settings sidebar in Compare, where B has its own system prompt and temperature:

```
┌ Settings ───────────── ↺ Reset  ✕ ─┐
│ System prompt •                    │
│ A [Add a system prompt          ]  │
│ B [Explain like I'm 5.          ]  │
│ Temperature •                      │
│ A ──●─────────────────     0.2     │
│ B ────────●───────────     0.9     │
│ Max tokens           up to 4,096   │
│ A [1024                         ]  │
│ B [1024                         ]  │
│ Top-p, Stop sequences, Seed: A, B  │
└────────────────────────────────────┘
```

| Topic | Behavior |
|---|---|
| Starting | **The mode switch (2026-10-27)**, first in the prompt box: **Single** or **Compare** (a switch, since there are only two). Compare adds B as a copy of A (settings and history), so nothing differs until you change something. |
| Model | A chip per side in the prompt box, **A** and **B**: the same model or two different ones. ⌘K opens the focused panel's chip. |
| Settings | The same sidebar on the right as in Single (section 7), with an **A** and a **B** control for every setting, one above the other. Each edits only its own side. B starts as a copy of A. Max tokens is checked against each side's model. |
| What differs | **Each panel's header** shows that side's own values for the settings A and B differ in, one per line under its model: A's header *system prompt “You are a senior…”* / *temperature 0.2*, B's *system prompt “You are 5.”* / *temperature 0.9*. A long value is cut off with an ellipsis (hover for all of it), never wrapped, so both headers list the same lines and stay the same height. So everything about A sits above A's answers, and B's above B's. A different model shows as each header's model name. Nothing extra appears while A and B are the same. |
| Usage | Each panel's header shows its tokens and ≈cost so far; under the prompt box, "Both panels so far". B's copy of A's earlier answers isn't counted twice. |
| Re-running after a change | **Run again** on a panel's last answer (or ⌘⇧↵ on the focused panel) replaces it using that panel's current settings |
| Running | ⌘↵ sends to both columns at once |
| Stop and retry | Per column. Esc stops both. Retrying one column doesn't re-run the other. |
| Errors | Shown in that column only |
| Leaving | **Single** closes B and its conversation, with no Undo (2026-10-27: it was more noise than help). If B was answering, its run stops first; the switch is disabled while an answer streams anyway. |
| Scrolling | Each column scrolls on its own |
| **Against the mock** | Both columns give the same answer, since the mock ignores the system prompt, model and settings. There's no notice for it any more (removed Oct 27 with the other explanatory lines): hovering an answer's stats shows the exact settings it sent, so you can see the difference really went out (section 16). |

**Why no locking or branching:** each column is a straight line, so its history is always exactly what its model saw.

*(Design only: a third column; a Compare menu with "another model / another system prompt / same settings again"; turns lined up in rows across columns; tabs on narrow screens.)*

**As built (phase 8):**
- **Focus.** In compare, ⌘K and ⌘⇧↵ act on the focused column. Clicking (or tabbing into) a column focuses it, and its header gets a blue rule. Starting compare focuses B, since B is the one you'll change.
- **Mode switch and A/B settings (2026-10-27).** Replaced four earlier tries: a shared settings sidebar with an A/B switch; full settings forms on top of both panels; a setup line per panel with a pop-over editor; and shared settings with a **⇄ Vary** toggle per setting, which was easy to miss. Now the mode and the models are in the prompt box, like Arena's, and the settings stay in one sidebar in both modes, where Compare simply shows A's and B's. One validity flag covers both sides, and Run waits while it's false.
- **Fewer words (2026-10-27).** Explanatory lines that read like comments are gone: the mock notice, "Type a message below" in empty panels, "A and B are the same so far", the History count, and the Compare hint on the welcome screen.
- **Grouped by side (2026-10-27).** A line above the panels used to state each difference as *"A … vs B …"*, repeated per setting. It was replaced by each header's own row of values, so A's setup is read in A's area and B's in B's.
- **Run, Stop, Run again.** ⌘↵ sends one message to both columns, each with its own settings, its own history and its own run ID. Each column's header has a Stop while it streams; Esc and the composer's Stop stop both. Run again, error-card retries and "Re-run last message" act on one column only.
- **Headers.** Each panel's header shows its label, its model's name (after a proposal's choice name), its usage, and Stop while it streams; under them, its own values for the settings that differ (a long system prompt is cut short, with the whole prompt on hover). Single has no header row.
- **Leaving.** Single closes B right away. An Undo bar (*"Back to Single. B is closed. Undo"*) was removed on Oct 27 as unnecessary.
- **New chat** keeps the mode and both setups, with no messages. A proposal keeps both of its choices, so they can take another question.
- **Narrow screens.** Below 768 px the columns become A/B tabs (the design-only "tabs" idea, built because side-by-side columns are unreadable at phone width).
- **Saved and shared.** A compare chat is saved with both columns and gets the Compare badge in History. A whole-chat share link carries both columns and opens as compare again.
- **Switching modes** isn't allowed while an answer is streaming, so B never copies a half-finished run.
- **Checked against the mock.** B with temperature 0.2 and max tokens 512 sent exactly that (the stats tooltip), while A sent 0.7 and 1024, and the answers matched, because the mock ignores settings.

## 10. History

| Topic | Behavior |
|---|---|
| Where | IndexedDB through `idb-keyval`. Small preferences (last model, theme) go in `localStorage`. |
| When it saves | When a run finishes, when settings change, on delete. Never per token. |
| Sidebar | On the left, shown or hidden from its edge (2026-10-27): a round ‹ handle on its border folds it away, and a › tab on the window's left edge brings it back. Both sit halfway down, and focus moves from one to the other. Shown or hidden is remembered in `localStorage` (shown by default). Below 1024 px it's a drawer, opened by the same › tab. The header button it replaces looked out of place next to the logo. **+ New chat** sits above History, greyed out while the open chat is new already (⌘⇧O also starts one). Automatic title, relative time, model, and a "Compare" badge. |
| Leaving mid-answer | New chat, opening another chat or a share link doesn't stop an answer: it finishes in the background and the finished chat is saved. Its entry shows "Generating…" with the live dot until then, and opening it shows it live. Deleting it stops it. |
| Actions | Delete (with undo), clear all |
| Limits | The newest 100 chats are kept |
| Label | *"Saved in this browser only"* |
| Upgrades | Each saved chat has `v`, and old versions are upgraded on load |

**As built (phase 5):**
- **What triggers a save.** The open chat carries a `rev` counter. The reducer bumps it when a run starts or ends and when settings change, never for tokens or retry bookkeeping. History saves when `rev` changes, 300 ms later, so a slider drag is one write. It also saves straight away when the tab is hidden. A chat with no messages is never saved, so opening the page doesn't clutter the list.
- **Reload.** The tab remembers its open chat in `sessionStorage`, so a reload reopens it. A new tab or a new visit starts at the empty state with history one click away. A run that was streaming when the page went away reopens as stopped, keeping the user message and whatever text had been saved.
- **Delete, undo and clear all.** Delete takes effect right away; Undo puts the chat back in its old place. Clear all asks for confirmation first, because it can't be undone. Deleting the open chat starts a new one.
- **Reading saved data.** Each record is checked with a structural zod schema. A record that can't be read (damaged, or from a newer version) is skipped, not deleted. Settings are checked for shape, not range, so a limit that changes later shows up as a field error instead of losing the chat.
- **The 100-chat cap.** Each save trims the store back to the newest 100. Listing reads every chat, which is fine at 100; a separate summaries index would be the next step.
- **Storage that's blocked** (some private windows): the panel says history isn't available and the playground keeps working.

*(Design only: search, rename.)*

## 11. Sharing by link

**The link carries everything.** There's no ID, no server storage and no database. This matches the brief's *"params and prompt encoded in the link"*.

```
┌ Share ─────────────────────────────────────────────────────┐
│ ◉ Just the setup        ○ Whole chat                        │
│   model, settings,        adds every message and answer     │
│   system prompt, and                                        │
│   the message you're typing                                 │
│                                                             │
│ Everything is inside the link: anyone who has it can see    │
│ these prompts, and links can't be taken back.               │
│                                           [ Copy link ]     │
└─────────────────────────────────────────────────────────────┘
→ ✓ Link copied   …/#s=eJyrVkrOz8lJTVGyMjI0…
```

- **Where it goes:** after the `#` in the URL. **Browsers never send that part to any server**, so shared prompts never reach our infrastructure or logs.
- **Encoding:** JSON → compressed with the browser's built-in `CompressionStream('deflate')` → base64url. No library needed. We use `deflate` (the zlib format) everywhere, for encoding and decoding alike. In a quick test, both `deflate` and `deflate-raw` rejected truncated and bit-flipped links. `deflate` adds a checksum as a safety net for the rare damage that would still decode, at a cost of about 8 characters.
- **What's included:** each column's current settings, plus the draft message ("setup") or the message texts ("whole chat"). Run IDs, attempts, costs and mid-chat setting dividers are left out to keep links short.
- **Length:** links longer than about 8,000 characters show a warning (*"Long links can get cut off in some apps. Share just the setup instead?"*). "Whole chat" isn't offered above about 32,000 characters. (Proposed numbers)
- **Opening a link:** the contents are decoded, **validated with the zod schema** (a link is untrusted input), and saved as **a new local chat**. A banner reads *"Opened from a shared link."* The `#…` part is then cleared from the address bar, so a refresh doesn't create a duplicate.
- **A damaged link** (cut off by a chat app, edited by hand): *"This link is damaged or incomplete."* `[Start a new chat]`
- **A model that isn't available here:** fall back to the default and say so: *"Shared with Mixtral, which isn't available. Switched to Llama 3.1 70B."*
- **The tradeoff, stated plainly:** no expiry and no revocation. Once it's sent, it's out there, which is why the dialog says so.

**As built (phase 5):**
- **The dialog** makes both links when it opens. That's how it knows whether "Whole chat" is under the 32,000-character limit, and it says why if not. If the clipboard is blocked, the link is shown selected so it can be copied by hand.
- **Size caps on opening:** links over 100,000 characters are refused before decoding, and decompression stops at 2 MB. A tiny link can't expand into something huge.
- **Pasting a link into an open tab** only changes the hash, so there's no reload. A `hashchange` listener opens it the same way.
- **What a shared chat looks like.** "Whole chat" answers open as finished answers without a stats line, because runs, costs and timings aren't in the link. "Just the setup" fills in the settings and the draft, and the chat is saved to history once it's run.
- **Tests:** a test cuts a link off at several points and edits a character every 7 positions. Every variant is refused.

The share payload's schema lives in `src/client/share/`, not `src/shared/`, because the server never sees it.

### 11.1 Agent proposals (as built)

An agent (Codex, Claude Code) searches for good settings on its own and sends its top two as a setup link with an optional `proposal`: who proposed it, a title, a summary, and a label and reason for each column. The full format and a worked example are in [`agent-handoff.md`](agent-handoff.md).

- **Claims, not answers.** The schema refuses a proposal in a whole-chat link or with any messages, so the answers on screen always come from running the choices here. The banner above the columns says which you're looking at: before the first run, *"Press ⌘↵ to run both choices live"*; after it, *"The answers below were run live here, not sent by the agent."*
- **Edits are visible.** Each column keeps the settings as proposed. A changed column's header says "(edited)" and lists what changed. A setup link passes the proposal on only while nothing has changed, so your edits never reach the next person as the agent's.
- **It stays with the chat.** History saves it with a "Proposal" badge, New chat keeps it (so the same choices can take another question), and ✕ on the banner removes it but keeps the settings.
- **A proposed model that isn't available** switches to the default, as any shared link does, and the banner says which column changed.
- **`npm run share-link -- proposal.json`** fills in defaults, checks the file with the page's own schema, and prints the link. A test checks that the plain recipe (zlib, then base64url) for agents outside this repo opens too.
- **Not built:** running the search inside the playground. It needs phase 7's per-visitor limits and daily budget first, because one search is dozens of calls on the shared key.

### 11.2 Code (as built, 2026-10-27)

View code was cut in revision 2. A review then pointed out the gap it left: a developer who finds good settings has no way to turn them into a call from their own app. **Code**, next to Share in the header, shows the setup as a curl or Python call to Parasail's API.

```
┌ Code ───────────────────────────────────────────────────────────┐
│ [ A Llama 70B │ B Qwen 72B ]                     (Compare only) │
│ [ curl │ Python ]                                 [ Copy code ] │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ curl https://api.parasail.io/v1/chat/completions \          │ │
│ │   --data-binary @- <<'EOF'                                  │ │
│ │ { "model": "parasail-llama-33-70b-fp8", … }                 │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

- **The same body the server sends.** `buildChatRequest` moved to `src/shared/`, and both snippets are generated from its output: the same fields, with no `stop` or `seed` when they're empty. So the model, prompt and settings can't drift from what the playground runs. Only `stream` and `stream_options` are left out: streaming is how the playground shows an answer, not part of the setup, so the code gets the whole answer in one response. It uses each column's current settings, the ones the next message would use, and in Compare it starts on the focused column.
- **One message.** The code sends the message being typed, else the last one sent, else a placeholder to replace. It's the setup, not the conversation: a "Whole chat" choice was tried and cut as clutter.
- **curl** puts the body in a quoted heredoc (`--data-binary @- <<'EOF'`), so the shell expands nothing in it: quotes, `$` and backslashes in a prompt need no escaping. JSON never puts a raw newline inside a string, so no line of the body can be the closing `EOF`.
- **Python** uses the `openai` SDK with `base_url` set to Parasail and prints `response.choices[0].message.content`.
- **The address and the key.** The code calls Parasail's documented `https://api.parasail.io/v1`, not the server's `PARASAIL_BASE_URL`; on October 27 both listed the same 98 models with the preview's key. The key is the reader's own, read from `PARASAIL_API_KEY` in the code itself, as Parasail's own examples do. The playground's never reaches the page.
- **Tests run both snippets.** The curl goes through bash with a stand-in `curl` that prints what it would send, and the Python runs against a stub `openai` module. Each must reproduce the body exactly, with prompts full of quotes, `$`, backticks, `EOF` lines, emoji and control characters.
- **Not built:** a JavaScript tab, a streaming version, and "code for this answer" from the settings that produced it.

## 12. Errors

### 12.1 Principles

Every error message:
1. **Says exactly what happened, with real values.**
2. **Says how to fix it**, ideally with a button that does it.
3. **Says what's safe:** *"Your message is still in the box."* A failure never loses what the user typed.
4. **Shows the code for developers:** HTTP status and request or run ID in small print.

### 12.2 Three buckets: who can fix it

| Bucket | Who fixes it | What the UI does | Card stripe |
|---|---|---|---|
| **You can fix it** | The user | Explains what to change | Blue |
| **It fixes itself** | Nobody; wait | Retries automatically, with a countdown | Amber |
| **Only we can fix it** | The playground's operators | Says so honestly, offers **Copy debug info** | Red |

### 12.3 The catalogue

`source` means **who owns the fix**: `network` (the user's connection), `playground` (our BFF, owned by Speedboat), or `inference` (the inference API, owned by the core inference team).

| Type | Source | Auto-retry? | Headline | Message (example) | Actions |
|---|---|---|---|---|---|
| `invalid_request` | playground / inference | No | Invalid request | Temperature is 3.5, but it has to be between 0 and 2. *(If the inference API rejected something we didn't check, we show its wording.)* | `[Reset to 1.0]`, field highlighted |
| `context_too_long` | playground (checked before sending) / inference | No | Chat too long for this model | This chat is about 40,000 tokens, but Mixtral 8x7B can read at most 32,768. | `[Switch to Llama 3.1 70B (131k)]` `[New chat with this message]` |
| `model_not_found` | inference | No | Model no longer available | Qwen 2.5 Coder 32B is no longer available. Your message is still in the box. | `[Refresh model list]` |
| `rate_limited` | **playground**, per visitor | Yes (the wait is ≤ 2 s) | Too many runs | You're sending runs faster than the playground allows: 30 in a burst, then one every 2 seconds. Retrying in 2s… | `[Cancel]` · *Want no limits? Get your own API key →* |
| `rate_limited` | **playground**, daily budget | No (waits until midnight) | Daily limit reached | The playground has reached today's usage limit. It resets at 00:00 UTC. | Run disabled, with the reset time shown |
| `rate_limited` | **inference** | Yes | Model is busy | Llama 3.1 70B is getting more requests than it can handle. Retrying in 2s (retry 2 of 3)… | `[Cancel]` → `[Retry]` `[Switch model]` |
| `inference_unavailable` | inference | Yes | Model not responding → *Model unavailable* | Llama 3.1 70B didn't respond (503 Service Unavailable). Retrying in 1s (retry 2 of 3)… *After giving up:* unavailable for 3 retries over about 7 seconds. The problem is on the model server, not your request. | `[Cancel]` → `[Retry]` `[Switch model]` `[Copy debug info]` |
| `network_error` | network | Yes, once back online | You’re offline (*Can’t reach the playground* when online but the server is unreachable) | Your device seems to be offline. Your message will be sent when you're back online. | `[Cancel]` |
| `stream_interrupted` | inference / network | **Only if the user clicks** | Response interrupted | Llama 3.1 70B's response stopped partway, after 143 tokens. What arrived is kept below. | `[Retry from the start]` |
| `service_misconfigured` | **playground** (the inference API returned 401/403, but the key is our config) | No | Playground setup problem | The playground couldn't sign in to the inference API. That's our problem; there's nothing you need to change. Your message wasn't sent and is still in the box. | `[Copy debug info]` |
| `internal_error` | playground | No | Playground error | Something went wrong inside the playground. It's a bug on our side, not your request. | `[Try again]` `[Copy debug info]` |

**Not errors:** **Stop** marks the run `cancelled`. `finishReason: 'length'` shows the cut-off notice.

### 12.4 Plain headlines (changed 2026-10-27)

Headlines were first themed on parasailing: the playground was the boat and the connection the radio link to shore, so being offline read "Out of radio range" and a dead model "Still grounded". In review they read as riddles. Without the metaphor, "Out of radio range" doesn't say you're offline, and explaining it in every headline would only slow the reading down. So every headline now says what happened in a few plain words.

**Rules:** the headline says what happened; the body gives the real values and what to do next. Buttons, logs and the API `message` stay plain. Headlines use lucide icons, not emoji. All text lives in **one file, `copy.ts`**. The empty state and the wait for the first token are plain too: **"Ready when you are."**, **"Waiting for the model…"**. Only the hidden debug tool keeps its name from the theme: **Weather control** (section 16).

### 12.5 The error card

Errors appear **in the conversation, where the answer would have been**, so they stay in history and survive a reload. Each column shows its own. Problems that affect the whole app (offline, model list failed to load) get a **thin banner** instead. No toasts, no modals.

```
┌──────────────────────────────────────────────────────────────────┐
│ Model unavailable                                                 │
│ Llama 3.1 70B was unavailable for 3 retries over about 6 seconds. │
│ The problem is on the model server, not in your request.          │
│ [Retry]  [Switch model]  [Copy debug info]                        │
│ 503 · run_7f3k9q                                     ▸ Details    │
└──────────────────────────────────────────────────────────────────┘
  ▸ Details:
  attempt 1   503 inference_unavailable   2 ms   req_a1…   waited 0.8s
  attempt 2   503 inference_unavailable   2 ms   req_b2…   waited 1.7s
  attempt 3   503 inference_unavailable   2 ms   req_c3…   waited 3.1s
  attempt 4   503 inference_unavailable   2 ms   req_d4…
  gave up after 3 retries · 5.6s total
```

▸ Details also lists **the settings the run sent** (model, temperature, top-p, max tokens, stop, seed, and the system prompt's length), so you can confirm what went out even when the mock ignores it.

A new error or countdown **never takes keyboard focus**. Both are announced with `aria-live="polite"`.

### 12.6 Copy debug info

It copies a block that's ready to paste into a support ticket or a Slack thread:

```
Parasail Playground debug info
Run:      run_7f3k9q   (attempts: req_a1…, req_b2…, req_c3…, req_d4…)
When:     2026-10-24 12:01:03 UTC
Model:    parasail-llama-3.1-70b-instruct · temperature 0.7 · max tokens 1024
Error:    inference_unavailable (503) · source: inference · 3 retries, 5.6s
App:      v0.1.0 (a1b2c3d)
```

- **No prompt text.** An opt-in checkbox, *"Include a share link (contains your prompts)"*, adds a link to the conversation.
- Support searches the logs for the run ID and gets every attempt (section 24.1).
- *(Design only: a "Send to support" form that stores reports in an inbox at `/admin/reports`. In production, the same content would go to a ticketing API.)*

### 12.7 When the UI itself crashes

Error boundaries make sure a rendering bug never takes the whole page down:
- **A single message:** if one answer fails to render (for example, an odd markdown case), it shows *"This message couldn't be displayed."* `[Show as plain text]`. The rest of the chat is unaffected.
- **The whole app:** *"Something went wrong. Your chats are saved in this browser."* `[Reload]` `[Copy debug info]` (app version and error message, no content).
- These crashes appear in the browser console only. *(Design only: reporting them to the server through browser reports.)*

## 13. Limits, as the user sees them

- **Normal users never notice them.** A person runs maybe 2–4 prompts a minute. The limit is a burst of 30, then one every 2 seconds.
- **When the burst is nearly used up:** *"4 runs left in this burst · +1 every 2s"* appears by the Run button. It isn't shown otherwise.
- **Hitting the per-visitor limit** means at most a 2-second wait, retried automatically. It also offers *"Want no limits? Get your own API key →"*: **the limit becomes a way in, not a dead end.**
- **The daily budget** disables Run until 00:00 UTC.

## 14. Keyboard and focus

| Shortcut | Does |
|---|---|
| **⌘↵** | Run |
| **⌘⇧↵** | Run again (replace the last answer; in compare, the focused column) |
| **Esc** | Stop while streaming; otherwise close whatever is open. Never clears the input. |
| **⌘K** | Open the model picker with search focused (in Compare, the focused panel's chip) |
| **⌘⇧O** | New chat |
| **⌘/** | Show all shortcuts |

Ctrl replaces ⌘ on Windows and Linux. **Browser shortcuts are never taken over.** Buttons show their key. There's no command menu. **⌘↵ instead of Enter** because playground prompts are multi-line.

**Focus:** *it goes where your next action is, never jumps while you're reading, and always returns to where it came from.* On load and after Stop it's in the input box. While streaming it stays in the input box (you can draft; Run is disabled). When an answer finishes or an error appears, it doesn't move. Dialogs keep focus inside, close with Esc, and return focus to the button that opened them. A visible `:focus-visible` ring everywhere.

## 15. Visual style

| Topic | Choice |
|---|---|
| Light / dark | Follow the system setting by default. A header button cycles System → Light → Dark and is remembered in `localStorage`; a script in `index.html` applies it before first paint. |
| Color | parasail.io's own palette (read from its stylesheet, 2026-10-25; tokens in `index.css`). Slate is retuned to Parasail's near-neutral greys, so dark mode is their near-black `#030304`. Primary buttons are **ink**, like parasail.io's: near-black on light, off-white on dark. **One accent, Parasail cobalt** (`#2850E4`), for focus rings, sliders, "changed" dots and the focused column. **Parasail teal** only marks live output: the streaming caret, the streaming dot and the "Waiting for the model…" glint. Error buckets get sky / amber / red stripes. Contrast holds in both modes: muted text (`slate-500`) is a different grey per mode so it keeps 4.5:1 on every surface it sits on, field edges are `slate-400` / `slate-600` for 3:1, and focus is a 2px cobalt outline, never only a border change. |
| Brand marks | Parasail's sail mark in the header and favicon. Small labels (Settings, Playground, model groups) are sentence case in the body face, untracked: the Hallmark audit (2026-10-26) counts mono tracked caps as a machine-made tell. There's no theme in the imagery or, since §12.4, in the copy. |
| Meta rows | Stats, IDs and model facts are separated by space (`gap-x-3`) or, in running text, commas. No middle-dot strings (Hallmark gate 63); the live streaming dot is the one dot, because it shows state. The ASCII mockups in this doc still use `·` as shorthand. |
| Type | Inter for the UI. JetBrains Mono for code, stats and IDs. `tabular-nums` on live counters. |
| Density | Compact: 14px base, 13px secondary |
| Components | Tailwind + Radix primitives, with thin wrappers in `src/client/ui/`: shadcn's approach without its generator. Accessible, and the component code lives in our repo. |
| Icons | lucide |
| Motion | Subtle (150 ms), off for `prefers-reduced-motion` |

## 16. Triggering failures: `_simulate` and Weather control

The brief asks for the mock's `?_simulate=429` / `?_simulate=503` switches to drive the retry strategy, and for the screen after the third retry fails.

**Checked against the running mock (2026-10-24):**
- `?_simulate=N` (or the `X-Simulate-Status: N` header) makes the mock **fail immediately** with status N and `{"error":{"type":"simulated_error","code":N,"message":"…"}}`.
- It works on chat and models, skips the auth check, and fails **before** any stream starts.
- It sends **no `Retry-After` header**, and a non-number value gives a 500.
- **It fails every request it's on**, so it can't fail partway through a stream.

**What else the mock ignores (checked in its code, `routes/chat.py`):**
- It picks a canned reply from **your last message only** (the sum of its character codes, modulo the number of canned replies).
- It accepts the system prompt, model, temperature, top-p, max tokens, stop and seed, but **ignores all of them**.
- `finish_reason` is always `"stop"`.

So against the mock, changing settings never changes the text, and compare columns match (each answer's stats tooltip shows what was sent). The "cut off" notice never appears either, so it's covered by a BFF test instead. That parameters really are forwarded is proven by a BFF test and shown on each answer.

**How the playground uses it**
- **On the playground's own URL:** `https://…/?_simulate=503` applies to every run. A reviewer can follow the brief literally and see 3 retries, then the **Model unavailable** card.
- **On the API:** `/api/chat?_simulate=503` and `/api/models?_simulate=503` work too.
- The BFF passes `_simulate` on to the mock **only when `PLAYGROUND_FAULTS=true`**. If the upstream isn't the mock (the real API), the BFF answers with that status itself, so the switch works everywhere and never reaches the real API. (Proposed)

**Weather control** (`?debug`): a small hidden panel with 4 presets. As built, it sits collapsed as a pill in the bottom-left ("Weather: Model unavailable"), turns amber while a preset is active, and collapses again once you pick one. Expanded, it covered the example prompts. If `/api/health` reports `faultsEnabled: false`, it says the presets have no effect.

| Preset | How | What you see |
|---|---|---|
| **Busy, then recovers** | The browser adds `_simulate=429` to attempts 1 and 2 only | Countdown → retry 1 → retry 2 → the answer streams |
| **Model unavailable** | `_simulate=503` on every attempt | 3 retries → the give-up card |
| **Broken key** | `_simulate=401` | The red card: our key is broken, not yours |
| **Stream drops** | BFF fault `drop_after:40` (the mock can't do this) | Partial text kept + Retry |

---

# Part B: Technical design

## 17. Architecture

```
browser (React SPA)                    Fly.io app: Node 22 + Hono (one process)            Fly.io: mock (private)
───────────────────                    ────────────────────────────────────────            ──────────────────────
retry loop · countdown · Cancel        requestId → wideEvent → previewGate → limits → route
chats in IndexedDB          ─ fetch ─▶ POST /api/chat ─ validate ─ buildChatRequest ─────▶  /v1/chat/completions
share links in the URL #    ◀─ SSE ──  normalize upstream SSE → token | error | done ◀─────  (or api.parasail.io)
frame-batched rendering                GET /api/models (5-min cache) ─────────────────────▶  /v1/models
                                       GET /api/health
                                       stdout: one JSON event per attempt
                                       (no database, no disk)
```

**Backend choice:** our own thin BFF (Hono) in front of the **unchanged** mock. No database. The BFF holds the key, enforces limits, normalizes the stream and logs. Its only state is in memory: rate-limit buckets, the daily budget and the model-list cache.

**One run, step by step**
1. ⌘↵ → the chat reducer adds the user message and an empty assistant message with a new `runId`.
2. The retry loop sends attempt *n*: `POST /api/chat` with `X-Run-Id`, a new `X-Request-Id`, `X-Attempt: n`, and `?_simulate` if one is active.
3. The BFF: request ID → start the wide event → preview gate → limits (bucket, open streams, budget) → zod validation → `buildChatRequest` → fetch upstream. The fetch carries `X-Request-Id` and `traceparent`, is aborted when the client disconnects, and has a first-token timer.
4. **The upstream fails before the first byte** → translate to an `ApiError` → HTTP status + JSON body.
5. **The upstream answers** → `200 text/event-stream`. Parse the upstream SSE and send `token` events plus heartbeats, then `done` with usage and cost, or `error` if the stream drops or stalls.
6. The BFF writes the wide event to stdout.
7. The browser paints once per frame. On an error before the first token, `nextRetryDelay` → countdown → the next attempt. On an error after tokens, mark the run interrupted. When done, save the chat to IndexedDB.

## 18. Stack and libraries

**Vite + React SPA, with a Hono BFF, in one Node 22 process.** Hono serves the built page and `/api/*`. One TypeScript project, so types, the zod schemas and the error shape are shared.

**Rule:** write it ourselves where it's what's being evaluated; use libraries for the rest.

| Written by us | Libraries |
|---|---|
| Retry loop and `nextRetryDelay` | React, Vite |
| Error translation and `ApiError` | Hono + `@hono/node-server` |
| SSE parser and stream normalizer | zod |
| Token bucket, open-stream limit, daily budget | Tailwind, Radix primitives (wrapped in `src/client/ui/`), lucide-react |
| Wide-event logging | `react-markdown` + `remark-gfm`, no raw HTML (Proposed) |
| `_simulate` handling and fault switches | Shiki for code colors (Proposed) |
| Share-link encoding (built-in `CompressionStream`) | `idb-keyval` |
| `copy.ts` | Vitest, Playwright |

**Client state (Proposed):** one `useReducer` per chat. The actions (`send`, `runAgain`, `compare`, `closeColumn`, `updateSettings`, `streamEvent`, `cancel`) map one-to-one onto user actions. Streaming text is collected in a ref and committed once per frame. No Redux or Zustand: the state belongs to one screen.

## 19. API

| Method and path | What | Notes |
|---|---|---|
| `GET /api/health` | `{ ok, version, upstream, upstreamKind, faultsEnabled }` | Used by Fly's health check. `upstreamKind` (`'mock'` or `'parasail'`) says which upstream is in use (it drove a compare-mode notice until Oct 27); `faultsEnabled` tells Weather control whether presets work. |
| `GET /api/models` | Chat-capable models with context size and price | 5-minute cache. Accepts `?_simulate`. |
| `POST /api/chat` | Run one attempt; responds with SSE | Headers: `X-Run-Id`, `X-Request-Id`, `X-Attempt`, optionally `X-Fault`. Accepts `?_simulate`. |
| everything else | The SPA (`index.html`) | Share links are `/#s=…` |

**Middleware order:** `requestId → wideEvent → previewGate → rateLimit → route`. Every 429 is logged.
**Response headers:** `X-Request-Id`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After` on our own 429s.

## 20. Streaming protocol

**Browser side:** `fetch` + `ReadableStream`. Not `EventSource` (GET-only, and it reconnects automatically, which would re-run a paid generation). Not WebSockets (no need for two-way traffic, and they lose HTTP status codes and headers).

**Events the BFF sends:**
```ts
type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'error'; error: ApiError }
  | { type: 'done'; finishReason: 'stop' | 'length';
      usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number };  // missing if the upstream never reported it
      costUsd: number | null }
```
```
data: {"type":"token","text":"Prompt caching"}

: ping

data: {"type":"done","finishReason":"stop","usage":{"promptTokens":42,"completionTokens":180},"costUsd":0.0000201}
```

**Mapping upstream to our events** (checked against the mock):
- The first chunk carries `delta.role` with empty content. It's skipped.
- `delta.content` → `token`.
- `finish_reason` and `usage` arrive **together in the last chunk** before `[DONE]`. They're held, then sent as `done`.
- A connection that closes without `[DONE]` → `error` with `stream_interrupted`.
- Cost is calculated in the BFF.

**Upstream request**, built by `buildChatRequest`: `model`, `messages`, `temperature`, `top_p`, `max_tokens`, `stop`, `seed`, `stream: true`, `stream_options: { include_usage: true }` (Proposed, to verify against the real API). **A retry resends a byte-identical request**, giving the inference server's prefix cache the best chance to skip prefill.

**Response settings that prevent buffering:** `Content-Type: text/event-stream` · `Cache-Control: no-cache` · `X-Accel-Buffering: no` · no compression on this route · each event written the moment it's parsed.

**Timers:** a 30 s first-token timeout, a 20 s stall timeout, and a 15 s heartbeat (`: ping`), which keeps proxies from closing a quiet connection.

**Cancel:** the browser aborts, the BFF aborts its upstream fetch, and generation and billing stop. The log records `client_disconnected`. The browser knows whether it was Stop (`cancelled`) or a dropped connection (`stream_interrupted`).

## 21. Data model

### 21.1 In the browser (IndexedDB)

Stored in **this browser profile only**, with no user or org isolation. Nothing leaves the browser except the requests themselves and the share links a user copies.

As built, this is `StoredChat` in `src/client/history/stored-chat.ts`, one record per chat keyed by ID in an IndexedDB store (`idb-keyval`). The open chat in memory (`ChatState`) has the same columns plus a `rev` counter that decides when to save (section 10); the counter isn't stored.

```ts
type Chat = {
  id: string
  v: 1                          // format version, for upgrades
  title: string
  createdAt: number
  updatedAt: number
  columns: Column[]             // 1 = normal chat, 2 = compare
  sharedFrom?: true             // started from a share link
}

type Column = {
  id: string
  settings: Settings            // editable; applies to the next message
  messages: Message[]           // linear: always exactly what the model saw
}

type Settings = {
  model: string
  system: string                // '' = no system message sent
  temperature: number
  topP: number
  maxTokens: number
  stop: string[]
  seed?: number
}

type Message =
  | { role: 'user'; text: string }
  | { role: 'assistant'
      runId: string
      text: string
      status: 'streaming' | 'done' | 'cancelled' | 'interrupted' | 'failed'
      finishReason?: 'stop' | 'length'
      settingsUsed: Settings    // frozen when Run was pressed
      attempts: Attempt[]
      usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number }
      costUsd?: number | null   // summed over attempts
      ttftMs?: number
      error?: ApiError }

type Attempt = {
  requestId: string
  startedAt: number
  durationMs: number
  status?: number
  errorType?: ErrorType
  waitedMs?: number
}
```

### 21.2 The share link

```ts
type SharePayload = {
  v: 1
  mode: 'setup' | 'chat'
  columns: Array<{
    settings: Settings
    messages?: Array<{ role: 'user' | 'assistant'; text: string }>   // 'chat' mode only
  }>
  draft?: string                                                   // 'setup' mode
}
// URL: /#s=<base64url(deflate(JSON))>   ·   decoded → checksum verified → SharePayloadSchema.parse() → new local Chat
```

### 21.3 The error shape (shared by browser and server)

```ts
type ApiError = {
  type: 'invalid_request' | 'context_too_long' | 'model_not_found' | 'rate_limited'
      | 'inference_unavailable' | 'network_error' | 'stream_interrupted'
      | 'service_misconfigured' | 'internal_error'
  source: 'network' | 'playground' | 'inference'   // who owns the fix
  message: string                     // plain text, for logs and bots
  details?: Record<string, unknown>   // limit, resetsInMs, contextTokens, field, scope…
  status?: number
  retryable: boolean
  retryAfterMs?: number
  requestId: string
  runId: string
}
```

### 21.4 On the server: nothing

No database, no files. Chats live in each visitor's browser. Share links carry their content in the URL fragment, which never reaches the server. The only server state is in memory: rate-limit buckets, today's spend and the model-list cache.

**Tenancy, once auth arrives (Design only).** Saved chats and short share links would be org → user → resource from day one:

```sql
orgs   (id, name, created_at)
users  (id, org_id → orgs, email, created_at)
chats  (id, org_id → orgs, user_id → users, v, data, created_at, updated_at)
shares (id, org_id → orgs, chat_id → chats, created_by → users, expires_at, revoked_at)
-- every query filters by org_id; Postgres row-level security as the backstop
```

## 22. Resilience

### 22.1 Where retries live

**In the browser, and only there.** The BFF makes one upstream call per request and describes the failure. The user sees the countdown and can cancel. Every attempt is a normal request, so it's logged and rate-limited. No server connections are held open during backoff. And retrying in only one layer avoids 3 × 3 = 9 attempts against a struggling server.

### 22.2 Retry rules

- Only "fixes itself" errors, and only before the first token.
- **3 retries** (4 attempts in total). The UI says "retry 2 of 3".
- About **1s, 2s, 4s with jitter**. The mock sends no `Retry-After`, so this schedule is what runs in the demo.
- The server's hint wins if it's longer (`Retry-After`, or our limiter's reset time).
- **At most 10 s of automatic waiting in total**, across all of a run's retries. If the next wait would go past that, automatic retrying stops and the user gets a countdown with a Retry button. A delay the server asked for is never shortened.
- `network_error` while offline waits for the `online` event, and that wait doesn't count as a retry.
- Cancel during a countdown → `cancelled`, and the attempt history is kept.

```ts
const MAX_RETRIES = 3
const MAX_TOTAL_AUTO_WAIT_MS = 10_000                  // across all retries of one run

// How long to wait before the next retry, or null for "don't retry automatically".
// waitedSoFarMs = automatic waiting already spent on this run.
export function nextRetryDelay(
  err: ApiError, retriesSoFar: number, waitedSoFarMs: number, random = Math.random,
): number | null {
  if (!err.retryable) return null                       // "you" and "us" errors: never
  if (retriesSoFar >= MAX_RETRIES) return null          // the third retry failed → give-up card

  const backoff = 1000 * 2 ** retriesSoFar              // 1s, 2s, 4s
  const jittered = backoff / 2 + random() * (backoff / 2)
  const delay = Math.max(err.retryAfterMs ?? 0, jittered)   // never shorter than the server asked

  return waitedSoFarMs + delay <= MAX_TOTAL_AUTO_WAIT_MS ? delay : null   // over budget: hand back to the user
}
```

With no `Retry-After`, the worst case is about 1 + 2 + 4 = 7 s, inside the budget. Three responses with `Retry-After: 9` stop after the first wait (9 s), because a second wait would bring the total to 18 s.

**Who decides "after the first token"** (as built): the run loop, not this function. If any text reached the screen, the run is marked interrupted and never retried automatically. A stream that broke **before** its first token (`stream_interrupted` with nothing shown) is retried like any other "fixes itself" error, because nothing on screen could duplicate or change. The function is only asked before the first token.

### 22.3 IDs

Each **attempt** has a `requestId`. Each **run** (one answer) has a `runId`. The BFF logs both, plus the upstream's own request ID if it returns one. Support needs only the run ID.

### 22.4 Translating upstream errors

The translation goes **by status code**, not by body shape: the mock's simulated errors use `type: "simulated_error"`, and the real API's body format is still unknown.

| Upstream | Becomes |
|---|---|
| 400 | `invalid_request` (inference), keeping the upstream wording; `context_too_long` if the wording says so |
| 401, 403 | `service_misconfigured` (**playground**), not retryable |
| 404 for the model | `model_not_found` |
| 429 | `rate_limited` (inference), `retryAfterMs` from `Retry-After` if present |
| 500, 502, 503, 504, timeout, connection refused | `inference_unavailable`, retryable |
| Closed after the first token | `stream_interrupted` |
| No first token within 30 s | `inference_unavailable` (the details say it timed out) |
| No tokens for 20 s after streaming began | `stream_interrupted` (stall) |
| Anything thrown in our own code | `internal_error` |

**What reaches the logs is an allowlist, never the raw upstream body or all its headers:**
- the status code, and the upstream error's `type` and `code`;
- the headers `Retry-After`, `Content-Type`, the upstream request ID, and rate-limit headers;
- the upstream error `message`, **only if it contains no 20-character run from the submitted messages**. Otherwise it's logged as `[redacted: echoes prompt]` with its length.

An upstream error can echo the prompt back, so this is what keeps the "never log prompts" promise true. Users never see internals. (Showing the upstream wording to the user in `invalid_request` is fine: it's their own content.)

### 22.5 `_simulate` and fault switches

- `_simulate` passes through to the mock (or is answered by the BFF when the upstream isn't the mock), only when `PLAYGROUND_FAULTS=true` (section 16).
- **Extra BFF switches**, for what the mock can't do, chosen with `X-Fault`:
  - `drop_after:N` closes the stream after N tokens.
  - `stall_after:N` stops sending after N tokens without closing.
- Every log line records the active `simulate` / `fault`, so tests never look like incidents.

### 22.6 Resumable streams (Design only)

**The problem:** the browser's connection drops briefly (wifi blip, laptop lid, refresh), and today Retry starts the answer over.

**The design:** the BFF keeps the upstream call running and stores numbered events in memory. The browser reconnects with `GET /api/runs/:id/events?after=41`. Stop gets its own request (`POST /api/runs/:id/cancel`). The upstream call is aborted if nobody reconnects within about 30 s. At 10×, this needs sticky routing or Redis Streams.

**Why it waits:** it fixes a rare failure for desk users and would make the BFF hold state across requests. **Build it when** `client_disconnected` shows up in the logs, or mobile users arrive. It doesn't help when the model server itself dies.

## 23. Limits and cost

### 23.1 Why

The key lives on our server and visitors are anonymous, so every run spends Parasail's money. The playground is a **marketing budget**: limits make sure it reaches people evaluating Parasail, not scripts. **Generous for people, strict for scripts.**

### 23.2 Three layers (planned for phase 7; only the per-request layer is built)

| Layer | Limit | Stops |
|---|---|---|
| **Each request** | `max_tokens ≤ 4096` (and within the model's context window), body ≤ 512 KB, model must be in the chat-capable list | One request costing a lot |
| **Each visitor (IP)** | Token bucket: 30 capacity, 1 token back every 2 s. **Retries count.** At most 3 open streams. | One visitor hogging capacity |
| **The whole playground** | `DAILY_BUDGET_USD` (default 5) | Someone switching IPs |

**Worst-case numbers:** a typical run costs about $0.0002 (so $5 is roughly 25,000 runs a day). A worst-case request (128k-token prompt, 4096 output tokens on 70B) costs about $0.05, so one IP at 30 a minute could spend about $1.50 a minute.

### 23.3 How the limits work

- **Bucket:** an empty bucket returns `429 rate_limited` (playground) with `retryAfterMs` set to the time until the next token (≤ 2 s), so the browser retries automatically.
- **Storage:** buckets live in a `Map`. Idle, full buckets are dropped every minute.
- **Real IP:** from `X-Forwarded-For`, trusting only the last `TRUST_PROXY_HOPS` hops (anyone can fake the header).
- **IPv6:** limited by the `/64` prefix.
- **Testing:** the clock is passed in.
- **Daily budget: reserve first, settle after.**
  - **Before a request starts,** the BFF reserves its **maximum possible cost**: estimated prompt tokens × input price + `max_tokens` × output price.
  - If that reservation would push today's total (spent plus reserved) over the budget, the request is refused with `rate_limited`, `details.scope: 'daily_budget'`, and `retryAfterMs` until midnight UTC.
  - **When the request ends,** the reservation is replaced by the actual cost. If usage never arrives (interrupted or cancelled), the cost is estimated from the streamed text (about 4 characters per token).
  - Requests running at the same time therefore can't overshoot the budget together.
  - **It's still best effort:** it lives in one process's memory, so a restart or deploy resets it. **The provider's spend cap on the key is the hard backstop.** At 10× it moves to Redis.

### 23.4 Prices and the model table

**Why it exists:** the real `/v1/models` returns only `id`, `object` and `owned_by` (checked 2026-10-24). That means:
- no names, prices, context sizes or capabilities;
- most models listed twice (a `parasail-…` alias plus the Hugging Face name);
- non-chat models mixed in.

Parasail publishes prices only on its [pricing page](https://www.parasail.io/pricing), and context sizes nowhere official. So we keep **`src/server/model-table.ts`**: what we know about the models we feature.

**Each entry:** `id` (sent upstream) · `aliases` (other live IDs for the same model) · `name` · `kind` (`chat`, `embedding` or `speech`) · `pricing` (input, **cache read**, output, per million tokens) · `contextLength` (only from an official source, so none today).

**Featured chat models** (the first live one is the default). List prices were copied **2026-10-24**; the page has no date of its own.

| Name | ID (+ aliases) | Input | Cache read | Output |
|---|---|---|---|---|
| Llama 3.3 70B *(default)* | `parasail-llama-33-70b-fp8` (+ `meta-llama/Llama-3.3-70B-Instruct`) | $0.22 | $0.11 | $0.50 |
| gpt-oss 120B | `parasail-gpt-oss-120b` (+ `openai/gpt-oss-120b`) | $0.10 | $0.055 | $0.75 |
| Qwen3 235B (2507) | `parasail-qwen3-235b-a22b-instruct-2507` (+ `Qwen/Qwen3-235B-A22B-Instruct-2507`) | $0.14 | $0.05 | $0.80 |
| DeepSeek V4 Flash | `parasail-deepseek-v4-flash` (+ `deepseek-ai/DeepSeek-V4-Flash`) | $0.14 | $0.07 | $0.28 |
| Kimi K2.6 | `parasail-kimi-k26` (+ `moonshotai/Kimi-K2.6`) | $0.75 | $0.16 | $3.50 |
| gpt-oss 20B | `parasail-gpt-oss-20b` (+ `openai/gpt-oss-20b`) | $0.04 | $0.02 | $0.20 |
| Mistral Small 3.2 24B | `parasail-mistral-small-32-24b` (+ `mistralai/Mistral-Small-3.2-24B-Instruct-2506`) | $0.09 | $0.05 | $0.30 |
| Gemma 4 31B | `parasail-gemma-4-31b-it` (+ `google/gemma-4-31B-it`, `google/gemma-4-31b-it`) | $0.15 | $0.06 | $0.40 |
| Qwen3 Coder Next | `parasail-qwen3-coder-next` (+ `Qwen/Qwen3-Coder-Next`) | $0.12 | $0.07 | $0.80 |

**Hidden (not chat):** `parasail-bge-m3` / `BAAI/bge-m3` (embeddings) and `parasail-resemble-tts-en` (text-to-speech). Unknown IDs that look like embeddings, speech, rerankers or Whisper are hidden too.

**How the live list and the table combine** (`joinModels`, in the model catalog):

| Case | Result |
|---|---|
| Live and in the table | **Featured**, in table order, with name and price. Aliases collapse into one row. We send our ID, or the alias if only that is live. |
| Live, not in the table | **Other models**, alphabetical: usable, raw ID, "no price listed" |
| Hidden kind, or looks non-chat | Not shown |
| In the table, not live | Not shown (retired) |
| The API sends its own metadata (the mock) | The API's prices, context sizes and capabilities win. Nothing matches the table, so it's one plain list. |

Against the real API (2026-10-24): **9 featured, 76 others, 85 shown** instead of 98. `/api/models` adds `pricesAsOf` when any table price is used, and the picker shows it on hover.

**Cost:** `cost = (prompt − cached) × input + cached × cache read + completion × output`, per million tokens. The real API reports `cached_tokens`. With no cache-read price, cached tokens are charged at the input rate. Cost is always shown as `≈`. A model with no price shows no cost, and counts against the daily budget at the highest known price.

**Default model:** the last one used if it's still listed; otherwise the first featured model, then the mock's flagship, then the first in the list. If the current model disappears from the list (a mock ID after switching to the real API, or a retired model), the app falls back to the default.

**The tradeoff:** the table goes out of date as models and prices change. Mitigations: dated prices, `≈`, unknown models still usable, retired ones hidden automatically. **The real fix is for `/v1/models` to return names, prices, context sizes and capabilities.** Speedboat owns that API, so it's next-quarter work, and then this table can go away.

### 23.5 Next: full cost awareness (Design only)

A spend view (by model, by hour, today against the budget), budget alerts at 75% and 100%, prices from an API when Parasail offers one, and per-org budgets once auth exists. It builds on the observability work in section 24.4, which is why it comes second.

## 24. Observability

**In the architecture notes, "observability" means the operator view.** The user-facing debugging (error cards, attempt timeline, IDs on screen) is presented as the theme.

### 24.1 One wide event per attempt (planned for phase 6; phase 4 built a smaller line, below)

At the end of each request, the BFF writes one JSON line to stdout:

```json
{
  "ts": "2026-10-24T12:01:03.412Z",
  "event": "chat_attempt",
  "runId": "run_7f3k9q", "requestId": "req_c3…", "attempt": 3,
  "upstreamRequestId": null,
  "model": "parasail-llama-3.1-70b-instruct",
  "outcome": "error",
  "status": 503,
  "error": { "type": "inference_unavailable", "source": "inference" },
  "timing": { "upstreamTtftMs": null, "durationMs": 2 },
  "tokens": { "prompt": 0, "completion": 0, "cached": null }, "costUsd": 0,
  "size": { "messages": 3, "promptChars": 312 },
  "rateLimit": { "remaining": 21 },
  "client": "ip:9be1…",
  "simulate": 503, "fault": null,
  "version": "a1b2c3d"
}
```

- `outcome` is one of `completed | cancelled | client_disconnected | interrupted | error`.
- **Sizes, never content.** Prompt and response text are never logged. Upstream error details go through the allowlist in section 22.4, so an error that echoes the prompt can't leak it.
- The IP is hashed with a daily rotating salt (Proposed).
- `upstreamRequestId` is the link to the inference team's logs, if the API returns one.
- `version` turns "did the deploy do it?" into a filter.
- `simulate` / `fault` keep tests from looking like incidents.

**Finding a run:** search the logs for the run ID (Fly's log viewer, or `fly logs | grep run_7f3k9q`) to get every attempt with its timing.

**As built in phase 4** (before the full wide event in phase 6): **every attempt writes exactly one `chat_attempt` line, whatever happens.** That includes:
- requests rejected by validation (`outcome: "rejected"`);
- upstream failures before the stream starts (`outcome: "error"`, with `status` and `error.type`/`source`);
- streams (`completed`, `interrupted`, `client_disconnected`, with a token count).

Each line carries the attempt number, model, `simulate`, `fault`, `upstreamRequestId` (`x-parasail-request-id`) and duration. Testing in the browser caught the first version logging only streams, which left exactly the failures on-call needs invisible.

**IDs travel upstream:** `X-Request-Id` and a W3C `traceparent` header on every upstream call, so our IDs can join Parasail's own logs and traces if the inference side records them.

### 24.2 Built: Copy debug info

Section 12.6. It's the user-facing end of the same IDs.

### 24.3 Metrics

In v1, metrics are just **totals over these log lines** (error rate by source, p50/p95 first token, retry rate, cost per hour), calculated in whatever log tool ingests stdout. No metrics backend is built.

### 24.4 Next: full observability (Design only)

This comes first on the "next" list: retries that succeed hide problems from users, so you need to *see* retry and give-up rates before tuning anything else, including cost.

- **Browser end-of-run report** (`POST /api/telemetry` via `sendBeacon`): time to first token as the user saw it (compared with the server's, to detect buffering), time from landing to first token (story 1 as a number), final run outcome, and page crashes.
- **`/admin/ops`** (behind `ADMIN_PASSWORD`), answering on-call's questions in order: *is something wrong → whose problem is it → where → since when → which runs*. Five tiles (requests/min, errors by source, first-token p50/p95, retries needed / gave up, cost against the budget), a 6-hour chart with deploy markers, a by-model table, errors by type, and recent failed runs searchable by ID.
- **Alerts.** Page only for user pain that needs a person now: our key is broken (any `service_misconfigured`), more than 5% of runs finally failing over 10 minutes (with at least 20 runs), the server down (external health check), the daily budget used up. Everything else (high retry rate, slow p95, budget at 75%, a one-off bug) goes to Slack. Rules as data in `alerts.ts`, checked every minute.
- **Storage:** a log pipeline (Datadog, Grafana, Honeycomb). Not the app's own database, which would fail at the same moment as the thing it's watching.

## 25. Security and privacy

| Concern | Handling |
|---|---|
| **The API key** | Server-only (`PARASAIL_*`). Vite only exposes `VITE_*` variables to the browser. **The build fails if `psk-` appears in the bundle.** |
| **Model output** | Untrusted: no raw HTML, unsafe URLs stripped |
| **Share links** | Content lives in the URL fragment, which is never sent to a server. **Decoded links are checksum-verified (`deflate`) and validated with zod** (untrusted input), and size-capped. No expiry or revocation, and the dialog says so. |
| **Prompts** | Never logged, including when an upstream error echoes them (allowlist plus redaction, section 22.4, with a test). Debug info excludes them unless the user opts in. |
| **IPs** | Hashed in logs (daily salt, Proposed) |
| **Preview** | `PLAYGROUND_PASSWORD` gate (built): a sign-in page and cookie (Basic Auth for scripts) on the page and every `/api` route except health, required against the real API. A deployment gate, not identity |
| **Validation** | The server always validates. Anyone can call the API directly. |
| **Simulation and faults** | Only with `PLAYGROUND_FAULTS=true`, never sent to the real API, recorded in the logs |
| **CORS** | Not needed: same origin (Proposed) |
| **Headers** | A basic Content-Security-Policy (Proposed) |

**Known identity gap (stated, not hidden):** with no accounts, there's no attribution and no way to revoke one person. Requests are traced by request ID and run ID, not by user. This is the trigger for real auth.

## 26. Deployment and configuration

### 26.1 Running locally

```
docker compose up
  ├── app   :3000   Node 22 · Hono serves the built React page + /api/*
  └── mock  :3001   the Parasail mock (FastAPI), reachable inside as http://mock:3001
```

With **no `.env` at all**, it works: the mock and the mock key, faults on, no password. Without Docker, `npm run dev:all` starts Vite (forwarding `/api` to Hono), Hono and the mock. The mock is copied into `mock/` from `parasail-ai/speedboat-pub` (reading that repo is fine; nothing is ever pushed to it).

### 26.2 Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PARASAIL_BASE_URL` | the mock | Switch to the real API |
| `PARASAIL_API_KEY` | the mock key | Server only |
| `PLAYGROUND_PASSWORD` | unset (no gate) | Preview gate. Required with the real API |
| `PLAYGROUND_FAULTS` | `true` locally and on the preview | `_simulate`, fault switches, Weather control |
| `DAILY_BUDGET_USD` | `5` | Global cap |
| `TRUST_PROXY_HOPS` | `0` locally, `1` on Fly | Real-IP detection |
| `PORT` | `3000` | Server port. The dev scripts pin the API to 3000, where Vite's proxy expects it. |

### 26.3 Preview on Fly.io

- **App:** the same Docker image as local. **No volume** (nothing is stored on the server). `min_machines_running = 1` with auto-stop off (no cold starts). Config in `fly.toml`.
- **Mock:** a second Fly app with no public service, reachable at `http://<mock-app>.internal:3001`.
- **Deploys:** with no volume attached, Fly can start the new machine before stopping the old one (blue-green), so deploys don't have to cut streams. To confirm while setting up.
- **The preview runs against the mock** (the real key expires after the deadline). *Changed on October 26: it runs against the real API; see below.*

**As built:** https://speedboat-playground-yukunl.fly.dev, region `sjc`, one `shared-cpu-1x` 256 MB machine per app (`--ha=false`), `kill_timeout = 35s` so the 30 s stream drain on SIGTERM isn't cut off (Fly's default is 5 s), and a health check on `/api/health`. The mock's image binds IPv4 only while Fly's internal network is IPv6, so `mock/fly.toml` runs it with `--host ::`; the mock's own files are unchanged. Checked after deploying: the health check reports the commit, the mock answers over the private network, `_simulate=503` returns 503, and streamed events arrive spread over about 1.4 s, so Fly's proxy doesn't buffer them. Blue-green is confirmed: on the second deploy the new machine passed its health check before the old one was cordoned, stopped and destroyed.

**Switched to the real API (October 26),** so reviewers see real models and compare columns that actually differ. The key is the `PARASAIL_API_KEY` Fly secret, set by the owner; `fly.toml` only changes `PARASAIL_BASE_URL`. The server refuses to start without the key, so a keyless deploy fails its health check and the old machine keeps serving. `?_simulate` and Weather control still work: the server answers them itself and never sends them to Parasail. **The tradeoffs, accepted:** anyone with the link spends from the key's cap (there are no per-visitor limits, since phase 7 is deferred; Parasail's spend cap and rate limits are the backstop), and the preview stops working when the key expires after the deadline. The mock app was then deleted, since nothing used it; its config stays in `mock/fly.toml`, so switching back means recreating it (`fly apps create`, `fly deploy mock`) and one line in `fly.toml`.

### 26.4 Production details

| Detail | What |
|---|---|
| `/api/health` | `{ ok, version, upstream, upstreamKind }` |
| Version | The git commit hash is baked in at build time (`--build-arg GIT_SHA`) and feeds the `version` log field |
| Graceful shutdown | On SIGTERM: stop accepting requests, let open streams finish (up to ~30 s), then exit |

### 26.5 CI and deploy (GitHub Actions)

```
push → typecheck · lint → unit + BFF tests → build → fail if "psk-" is in the build → (main only) fly deploy
```

End-to-end tests run locally before submitting (`npm run e2e`). The repo is your own GitHub repo. **Nothing is ever pushed to `parasail-ai`.**

## 27. Testing

**Principle:** test where a bug would hurt *and* be hard to spot.

**Unit tests (Vitest)**

| Target | The bug it catches |
|---|---|
| `nextRetryDelay` | Retrying the wrong errors, a 4th retry, ignoring or shortening `Retry-After`, more than 10 s of automatic waiting **in total** (e.g. three `Retry-After: 9` responses) |
| Error translation | A 401 showing "invalid API key"; a 429 losing its wait time; relying on the body shape |
| SSE parser and normalizer | Events split across chunks (fed **one byte at a time**); the role-only first chunk; usage + finish in the same chunk |
| Token bucket | Wrong refill arithmetic |
| Cost and prices | $0 shown instead of nothing |
| Daily budget | Requests running at the same time overshooting it; a cancelled request never releasing its reservation; interrupted runs counted as free |
| Share-link encoding | Round trip with `deflate`; a truncated, edited or oversized link fails the checksum or the schema cleanly |

**BFF tests (in memory with `app.request()`, against a fake upstream)**
- Events in order, and the right streaming headers
- **Cancel reaches upstream**
- The 31st request in a burst gets a 429 with headers
- `_simulate` passes through only when faults are on; a drop → `stream_interrupted`; a stall → the stall timeout (set short)
- **Privacy:** a prompt containing a unique marker string never appears in any log output, **including when the fake upstream returns an error that echoes the marker**
- **Parameters are forwarded:** the upstream request body contains the system prompt, model, temperature, top_p, max_tokens, stop and seed exactly as sent. The mock ignores them, so this test is the proof.
- `finish_reason: "length"` from the fake upstream produces `done` with `finishReason: 'length'` (the mock never sends it)

**End-to-end (Playwright, against `docker compose`)**
1. Golden path: land → input focused → type → ⌘↵ → tokens stream → stats line (story 1)
2. `?_simulate=503` → 3 retries → the **Model unavailable** card with a run ID (the brief's third retry)
3. *(If time allows)* Share link round trip: copy → open in a fresh browser → pre-filled (story 3)

**Acceptance checks: required before submitting.** Each check is done by hand on the preview (or locally where noted), and recorded in the NOTES.md checklist:
1. **Golden path:** in a fresh browser on the preview, the first token arrives well within 60 seconds of landing.
2. **The third retry:** `?_simulate=503` → 3 retries → **Model unavailable** with a run ID, and automatic waiting stays within 10 s in total. Weather control's "Busy, then recovers" recovers.
3. **Cancel:** Stop mid-stream keeps the partial text, the log line shows `client_disconnected`, and the upstream call was aborted (backed by the BFF test).
4. **Parameters are forwarded:** change each setting and run. The answer's stats show what was sent, and the BFF test confirms it reached the upstream.
5. **History survives** a reload, and a browser restart.
6. **Sharing works in a fresh browser profile** (a private window), for both "just the setup" and "whole chat". A truncated link shows the damaged-link message.
7. **Compare:** against the real API (locally), the two columns differ, and each answer's stats tooltip shows its own settings.
8. **Key secrecy:** the build fails when `psk-` is planted in the bundle (try it once).
9. **The notes are true:** every claim in `architecture-notes.md` and `NOTES.md` is checked against the built app (their verify-before-submitting checklists).

**Designed for testing:** the clock and randomness are passed in, and the upstream URL is configurable. **Not tested:** screenshots, every component.

## 28. Project layout (Proposed)

```
speedboat2/
├─ src/
│  ├─ client/                 React app (Vite root)
│  │  ├─ app/                 layout, error boundaries
│  │  ├─ chat/                reducer, Column, Message, Composer
│  │  ├─ settings/            SettingsPanel, ModelPicker
│  │  ├─ stream/              runStream (frame batching), retry loop, nextRetryDelay
│  │  ├─ errors/              ErrorCard, AttemptTimeline, copyDebugInfo, copy.ts
│  │  ├─ history/             IndexedDB storage, sidebar
│  │  ├─ share/               encode/decode, ShareDialog
│  │  └─ debug/               WeatherControl
│  ├─ server/                 Hono BFF
│  │  ├─ app.ts               middleware chain + routes
│  │  ├─ middleware/          requestId, wideEvent, previewGate, rateLimit
│  │  ├─ routes/              models, chat, health
│  │  ├─ upstream/            client, buildChatRequest, normalizeStream, translateError, simulate, faults
│  │  ├─ limits/              tokenBucket, openStreams, dailyBudget
│  │  └─ model-table.ts         names, aliases, kinds and list prices (section 23.4)
│  └─ shared/                 types, zod schemas (settings, share payload), SSE parser
├─ mock/                      copy of the Parasail mock
├─ tests/                     unit/, bff/, e2e/
├─ docs/design.md
├─ architecture-notes.md
├─ NOTES.md
├─ Dockerfile · docker-compose.yml · fly.toml · mock/fly.toml
└─ .github/workflows/ci.yml
```

## 29. Build order and cut list

| Phase | What | Rough hours |
|---|---|---|
| 1 | Skeleton: Vite + Hono + compose + mock; `/api/health`; `/api/models` | 1 |
| 2 | Golden path: chat route with normalized events, browser streaming, markdown, Stop, stats line | 2.5 |
| 3 | Settings panel, model picker, defaults, mid-chat divider | 1 |
| 4 | **Resilience:** error translation, retry loop with countdown, error cards with timeline, timeouts and heartbeat, interrupted runs, `_simulate`, fault switches, Weather control, error boundaries | 4 |
| 5 | History (IndexedDB) and share by link | 1.5 |
| 6 | **Observability slice:** wide events, IDs upstream, Copy debug info | 1 |
| 7 | **Cost and limits slice:** prices, cost display, token bucket, open streams, daily budget | 1.5 |
| 8 | Compare (2 columns) | 2 |
| 9 | Fly deploy, CI, tests, README, notes, NOTES.md | 3 |
| | **Total** | **about 17.5** (15–18) |

**Cut first, if time runs short** (each still gets mentioned in NOTES.md): compare → design only (−2 h, gets to ~15.5) · end-to-end test 3 · mid-chat divider · ⌘K picker · themed headlines (plain text instead).

## 30. What breaks at 10× and 100×

| Scale | What breaks first | What I'd do |
|---|---|---|
| **10×** | **The $5 daily budget trips**, by design, so the playground stops for everyone until midnight. It's a business setting, not a bug. | Raise it. Real auth makes spend attributable, so budgets can be per org. |
| **10×** | **Everything in memory lives in one process.** A second instance would split the rate-limit counts and the budget, and a restart resets them. | Redis for buckets and the budget. Then scale out horizontally. |
| **10×** | **Deploys and long streams** | Blue-green deploys plus graceful shutdown; later, resumable streams |
| **100×** | **The single shared upstream key hits its own rate limit.** Every visitor's traffic goes through one key, so upstream 429s start hitting everyone. | An internal high-limit key or a pool of keys now; per-org keys through auth later |
| **100×** | **Thousands of long-lived connections per instance:** memory and file descriptors, and deploys cut many streams at once | Scale on connection count, drain gracefully, resumable streams |
| **100×** | **The cost of logging every attempt in full** | Keep every error, sample successes, ship to a log pipeline |
| **100×** | **Anonymous free inference becomes an abuse target** | Sign-in for heavy use; per-user limits; a retry budget in the BFF |

## 31. Open questions

To check against the real API (the streaming experiment in the fork session):
1. Does streaming include `usage` without `stream_options.include_usage`?
2. Do 429s include `Retry-After`?
3. Is there an upstream request ID header, and what's it called?
4. Does `usage` include `prompt_tokens_details.cached_tokens`?
5. What do error bodies look like for 400 / 401 / 429 / 5xx?
6. What are the real model IDs, context lengths and `capabilities`? Is the 70B default there?
7. Is there a routing hint for prompt caching?
8. Does it accept `X-Request-Id` or `traceparent`?

**Answered:** no API returns prices (so our model table is needed, section 23.4). `_simulate` behavior was checked against the mock, and so was the fact that the mock ignores the system prompt, model and sampling settings (section 16).

**Answered against the real API (2026-10-24):**
- **Q3:** yes. Responses carry **`x-parasail-request-id`** (and `x-request-id`). That's the `upstreamRequestId` to log.
- **Q6:** `${PARASAIL_BASE_URL}/v1/models` works. But each model has **only `id`, `object` and `owned_by`**: no `context_length`, no `pricing`, no `capabilities`. The list has 98 entries:
  - most models appear twice, as a `parasail-…` alias and as the Hugging Face name (`meta-llama/Llama-3.3-70B-Instruct`);
  - non-chat models are mixed in (embeddings: `parasail-bge-m3`; text-to-speech: `parasail-resemble-tts-en`);
  - the mock's default `parasail-llama-3.1-70b-instruct` doesn't exist.
- **Q1 and Q4, from one streaming run** (`parasail-llama-33-70b-fp8`, `max_tokens: 32`, through the BFF):
  - With `stream_options.include_usage`, usage arrives at the end, **including `prompt_tokens_details.cached_tokens`** (0 here).
  - Whether usage arrives *without* that option is untested; we always send it.
  - `finish_reason: "length"` arrived when `max_tokens` was hit, so the cut-off notice works for real.
  - Text comes in chunks of about 3 tokens per event (11 events for 32 tokens).
  - Timing: first token at about 590 ms, the whole run in about 1.4 s.
- **Still open:** Q2 (`Retry-After` on a real 429), Q5 (real error bodies), Q7 (cache routing hint), Q8 (whether our `X-Request-Id` / `traceparent` show up on Parasail's side).
- **So the picker needs our own model table:** which models are chat models, friendly names, context sizes and prices, and which aliases are the same model. It's joined to the live list, with unknown models shown without a price. (To decide.)

## 32. Decision log

| # | Decision | Status |
|---|---|---|
| 1 | A key kept on the server, anonymous visitors, a BFF in front | Decided |
| 2 | **Resilience is the one extension. Cost and observability are built as thin slices; their full versions are next (observability, then cost). Auth and multi-tenant data come later.** | **Changed in rev 2** |
| 3 | Vite + React SPA with a Hono BFF in one Node process; write the evaluated parts ourselves | Decided |
| 4 | `fetch` streaming; cancel reaches upstream; BFF normalizes into `token` / `error` / `done` | Decided |
| 5 | A chat is columns (1, or 2 in compare), each a linear conversation; answers store frozen settings and telemetry; `v` field | Decided |
| 6 | **Share by link: settings and prompt (or the whole chat) compressed into the URL fragment. No ID, no server storage, no database.** | **Changed in rev 2** (was server-stored snapshots) |
| 7 | Settings can change mid-chat, shown with a divider | Decided |
| 8 | The browser owns the retry loop; the BFF makes one call and describes the error | Decided |
| 9 | `ApiError` with `type` + `source` (who owns the fix) + `details`; 9 types in 3 buckets; specific messages with fix buttons | Decided |
| 10 | Plain headlines and bodies; all text in `copy.ts` | Changed 2026-10-27 (was parasailing headlines) |
| 11 | Retry rules: 3 retries, ~1/2/4s with jitter, server hint wins, **10 s of automatic waiting in total**; 30 s / 20 s / 15 s timers | Changed in rev 3 (was 10 s per wait) |
| 12 | Resumable streams design only; fault switches `drop_after` / `stall_after`; Weather control with **4** presets | Changed in rev 2 (was 7 presets) |
| 13 | Errors appear in the conversation; banner for app-wide problems; attempt timeline; **Copy debug info**. The support-report inbox is design only. | **Changed in rev 2** |
| 14 | Three layers of limits; "Get your own API key" | Decided (share/report limits removed) |
| 15 | One wide event per attempt to stdout; IDs forwarded upstream. Browser reports and events storage are design only. | **Changed in rev 2** |
| 16 | `/admin/ops` page | **Design only (rev 2)** |
| 17 | "Observability" in the notes = operator view | Decided |
| 18 | Alerts (4 pages, Slack for the rest) | **Design only (rev 2)** |
| 19 | First 60 seconds: no gates, input focused, 70B default, empty system prompt, 0.7 / 1024, example prompts run, saved model list | Decided |
| 20 | Settings panel; earlier system-prompt versions are design only | Changed in rev 2 |
| 21 | Streaming UX: live markdown, frame batching, stick-to-bottom scroll, Stop in place, waiting states, stats line | Decided |
| 22 | Prices from `/v1/models` when present, else our model table (section 23.4); shown as `≈` | Changed (the price table grew into the model table) |
| 23 | Shortcuts: ⌘↵, ⌘⇧↵, Esc, ⌘K model picker, ⌘⇧O, ⌘/; focus rules | Decided |
| 24 | Compare: **2 columns**, duplicate + change B + re-run; extras design only | **Changed in rev 2** (was 3 columns with menu) |
| 25 | History in IndexedDB; search and rename design only; View code cut, then built as **Code** after a review (§11.2) | Changed in rev 2; Code added 2026-10-27 |
| 26 | Visual style | Decided |
| 27 | `docker compose up`; Fly.io (**no volume**) with a private mock; `psk-` build check; health, version, graceful shutdown | Changed in rev 2 |
| 28 | Testing: unit, in-memory BFF tests including privacy, 2–3 end-to-end tests | Changed in rev 2 |
| 29 | **`_simulate` on the playground URL and the API, passed to the mock only with faults on (checked against the mock)** | **New in rev 2** |
| 30 | **Error boundaries: per-message and app-level fallback screens** | **New in rev 2** |
| 31 | **Focused scope, about 15–18 hours (section 29)** | **New in rev 2** |
| 32 | **Logging allowlist** for upstream errors: status, error type and code, a few headers, and the message only if it doesn't echo the prompt | **New in rev 3** |
| 33 | **The daily budget reserves each request's maximum cost** before it starts and settles afterwards. Described as best effort, with the provider's cap as the hard backstop. | **New in rev 3** |
| 34 | Share links use **`deflate`** everywhere (one format to encode and decode; its checksum is an extra safety net) | **New in rev 3** |
| 35 | **A compare-mode notice when the upstream is the mock**; each answer shows the settings it sent; `upstreamKind` in `/api/health` | **New in rev 3** |
| 36 | **Required acceptance checks** before submitting (section 27) | **New in rev 3** |
| 37 | Labels are "planned for v1" vs "design only"; the submission drafts carry a verify-before-submitting checklist | **New in rev 3** |
| 38 | **Model table** (`src/server/model-table.ts`): 9 featured chat models with names, aliases and list prices including cache read; non-chat models hidden; combined with the live list (featured, then other); cost uses the cache-read rate; default falls back when the current model isn't listed | **New (after the real-API check)** |
| 39 | The server loads a local `.env` at startup; real environment variables win | **New** |
| 40 | Phase 4 as built: the run loop owns "no automatic retry after the first token"; time to first token is measured from the successful attempt; every attempt logs one line, including failures before streaming; Weather control sits collapsed as a pill; `/api/health` reports `faultsEnabled` | **New (phase 4)** |
| 41 | Phase 5 as built: a `rev` counter decides when history saves (runs starting and ending, settings; never tokens); a reload reopens the tab's chat through `sessionStorage`; unreadable records are skipped, not deleted; share links are capped at 100,000 characters and 2 MB decoded and also open through `hashchange`; the payload schema stays client-only | **New (phase 5)** |
| 42 | Phase 8 as built: compare acts on a focused column; ⌘↵ sends to both, Stop and Run again are per column; ✕ on B has Undo; a new chat keeps both columns; A/B tabs below 768 px. Phases 6 and 7 are deferred, and their sections are relabeled as planned | **New (phase 8)** |
| 43 | **Agent proposals** (section 11.1): an agent's top two choices arrive as a setup link with its claims; never answers; edits are marked and keep the proposal out of re-shares; the search itself stays outside the playground | **New** |
| 44 | The preview runs against the real API instead of the mock: real models and real compare differences for reviewers, with the key as a Fly secret. Accepted: link holders spend from the key's cap, and the preview breaks when the key expires | **Changed (Oct 26)** |
| 45 | **Single / Compare** switch in the prompt box, like Arena: a model chip per side; settings in one right sidebar for both modes, with an A and a B control for every setting in Compare; each panel's header lists its own values where A and B differ; New chat keeps the mode | **Changed (Oct 27)** |
| 46 | The compare-mode mock notice (decision 35) and other explanatory lines are removed, and so is Undo after switching to Single (decision 42); each answer's stats tooltip still shows the settings it sent | **Changed (Oct 27)** |
| P1–P6 | `useReducer` per chat; project layout; react-markdown + Shiki; daily IP salt, CSP, no CORS; `stream_options.include_usage`; BFF answers `_simulate` itself when the upstream isn't the mock | Proposed |

---

## Appendix A: Defending it

**Scope**
- **"The brief said pick one extension. Isn't this three?"** One: resilience, built deep. Cost and observability are built only as far as resilience needs them (IDs, a log line, cost per run, limits on a shared key). Their full versions, the ops page, alerts and spend tracking, are designed and listed as next. A 429 is all three at once, so building none of the slices would leave gaps.
- **"What did you cut?"** The ops page, alerts, a support inbox, server-side shares, a third compare column, prompt versions, history search, resumable streams. All of it is designed. The brief warns that production checklists become a time sink, so I built one thing deep and wrote down the rest.
- **"It's a playground. Why this much on errors?"** Those five minutes are the sale. Evaluators are judging the platform, and how errors are handled is part of it.

**Auth and the key**
- **"You built an unauthenticated proxy to a paid key. What stops someone burning your budget?"** Three layers: a cost ceiling on each request, a token bucket per IP, and a daily budget that **reserves each request's maximum cost before letting it start**, so requests running together can't overshoot it. It's best effort, because it lives in memory and resets on restart, so the key's own spend cap is the hard backstop.
- **"You sell inference. Why limit it?"** The playground is a marketing budget. The limits make sure it reaches people, not scripts. Hitting the limit offers your own key, so the limit is a way in.
- **"Why per IP?"** It's the best identity without auth, and it's wrong both ways (offices share an IP, attackers rotate). The daily budget covers rotation. Auth fixes both.

**Data**
- **"Why no database?"** Nothing needs to outlive the tab on the server. Chats live in the browser, and share links carry their content in the URL fragment, which never reaches the server. No storage means no data to leak, no migrations, no volume, and simpler deploys. When auth arrives, saved chats and short share links would be tenant-aware from day one (section 21.4).
- **"What's the downside of putting the chat in the link?"** No expiry and no revocation, and long chats make long links. So the dialog says so plainly, warns about long links, and defaults to sharing just the setup.
- **"Why columns and not a tree?"** The story asks to compare setups, not explore branches. Each column's history is always true to what its model saw.
- **"Compare shows the same answer in both columns on your preview. Is it broken?"** No, that's the mock: it picks a reply from your last message only, and ignores the system prompt, model and settings. Each answer shows the exact settings it sent, and a BFF test proves they're forwarded. Against the real API, the columns differ.
- **"Why validate in both browser and server?"** One zod schema used twice: instant feedback in the browser, safety on the server.

**Stack and streaming**
- **"Why not Next.js?"** The page is client-only. The BFF is where the work is, and in Hono it's a visible middleware chain in one long-running process, which keeps the in-memory limiter honest.
- **"Why not Vercel?"** The limiter and the budget live in memory and need one long-running process. Fly runs the same image as local.
- **"Why not EventSource or WebSockets?"** EventSource is GET-only and reconnects automatically (a paid generation would run twice). WebSockets give up HTTP status codes and headers.
- **"Doesn't parsing add delay?"** Microseconds. Buffering is what adds delay, so: write each event immediately, no compression on that route, `X-Accel-Buffering: no`.
- **"Smooth at 100+ tokens a second?"** Paint once per animation frame, cache finished blocks, color code only once its block closes.

**Resilience**
- **"Show me the third retry failing."** Add `?_simulate=503` to the URL: three retries at about 1, 2 and 4 seconds with jitter, then a card that says the model server is down, not your request, with every attempt and its timing.
- **"Why retry in the browser, not the BFF?"** The user sees a countdown and can cancel, every attempt is logged and limited, and nothing retries in two layers.
- **"Why not show the upstream error message?"** It's written for the API's caller, which is my server. A raw 401 would tell the user to fix a key they don't have.
- **"Isn't `source` just blame?"** It's routing. `playground` goes to Speedboat, `inference` to the inference team, `network` is the user's connection.
- **"A stream dies mid-way and you retry. Aren't you paying for prefill twice?"** Probably, unless prefix caching hits. I resend a byte-identical request to give it the best chance. The real fix for browser drops is resumable streams, which I designed.
- **"Why didn't you build resumable streams?"** It fixes a rare failure and would make the BFF hold state across requests. The trigger to build it is `client_disconnected` in the logs, or mobile users.
- **"Where do 3 retries and 1/2/4 s come from?"** How long people will watch a countdown (5–10 s), so 10 s is the *total* automatic waiting across retries. If a server asks for longer, I don't shorten its delay; I hand the decision back to the user with a countdown. At 10×, a retry budget in the BFF stops retries from becoming the load.

**Observability**
- **"Why one big log line?"** At 2am you ask questions you didn't predict. One event with every field lets you filter by model, deploy, source or prompt size, and metrics are totals over those events.
- **"No ops page?"** It's designed (section 24.4) and first on my list. I built the signals it would read: IDs, one wide event per attempt, debug info that leads support to those events.
- **"You log upstream errors. Can prompts leak into your logs that way?"** No. Upstream errors go through an allowlist: the status, the error type and code, a few headers, and the message only if it contains no 20-character run from the prompt. A test sends a marker string, has the fake upstream echo it back in an error, and checks it never reaches the logs.
- **"What would you alert on first?"** Our key breaking, runs finally failing (with a minimum volume), the server down, the budget used up. A retry that succeeds never pages.

**Scale and next quarter**
- **"What breaks at 10× and 100×?"** At 10×: the daily budget (by design), then state held in one process's memory. At 100×: the single shared upstream key's rate limit, connection counts, and log volume. Section 30.
- **"Next quarter?"** Full observability, then cost (ops page, alerts, spend view). Then real auth with org-scoped data. A customer-facing request log in the Parasail console built from the same events. Resumable streams when the data says so.
