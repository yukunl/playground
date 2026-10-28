# Agent handoff: proposals you can check

People often ask a coding agent to find good settings for them ("find the best prompt and parameters for my scheduling assistant, give me your top two") and then want to check its answer themselves. Here, the agent's answer is a playground link that opens its two choices side by side in Compare. The person presses ⌘↵, and both choices run live.

**The agent sends claims, never answers.** A proposal link carries the settings, a test question, and the agent's reasons. The answers on screen come only from running the choices in the playground, so they can't be the agent's own picks from its best runs. The page refuses a proposal link that contains messages, and the banner says which of the two you're looking at:

> *These are the agent's claims. Press ⌘↵ to run both choices live and judge the answers yourself.*

## The flow

1. You ask an agent (Codex, Claude Code) to find the best settings and prompts for something, and to give you its top two.
2. The agent runs its search however it likes, with its own calls to Parasail. The playground doesn't run the search.
3. The agent writes a proposal file in JSON and turns it into a link (below).
4. You open the link. The banner shows who proposed it, its summary and each choice's reasons. Column A is choice 1, column B is choice 2, and the test question is in the message box.
5. You press ⌘↵. Each answer shows time to first token, speed and cost, and hovering its stats shows the exact settings it sent. "New chat" keeps both choices, so you can try another question.

## The proposal file

```json
{
  "proposal": {
    "by": "Claude Code",
    "title": "Hospital scheduling assistant: same reply every time, or warm and varied",
    "summary": "What was tested, on how many requests, what it cost, what failed and was fixed."
  },
  "columns": [
    {
      "label": "Same reply every time",
      "why": "Why this choice, with the numbers behind it.",
      "settings": { "model": "parasail-llama-33-70b-fp8", "system": "…", "temperature": 0.2, "topP": 0.9, "maxTokens": 150, "seed": 42 }
    },
    {
      "label": "Warm, worded differently each time",
      "why": "…",
      "settings": { "model": "parasail-llama-33-70b-fp8", "system": "…", "temperature": 1.0, "topP": 0.95, "maxTokens": 200 }
    }
  ],
  "draft": "The test question that goes in the message box."
}
```

A complete one is [`examples/hospital-scheduler.json`](../examples/hospital-scheduler.json).

| Field | Limit | Notes |
|---|---|---|
| `proposal.by` | 40 characters | Shown as "Proposed by …" |
| `proposal.title` | 120 | |
| `proposal.summary` | 2,000, optional | Line breaks are kept |
| `columns` | 1 or 2 | A, then B |
| `columns[].label` | 60, optional | Defaults to "Choice 1" / "Choice 2" |
| `columns[].why` | 1,000, optional | |
| `columns[].settings` | The playground's settings | `model`, `system`, `temperature` (0–2), `topP` (0–1), `maxTokens` (1–4,096), `stop` (up to 4), `seed` (optional). There's no top-k. |
| `draft` | optional | The test question |

## Make the link

An agent connected to the playground over MCP ([connect-an-agent.md](connect-an-agent.md)) doesn't need this section: its `open_in_playground` tool makes the link, and its `run` tool measures each choice through the playground, so it needs no Parasail key of its own.

In this repo, missing settings are filled with the defaults, and the file is checked against the same schema the page uses:

```bash
npm run share-link -- examples/hospital-scheduler.json --base http://localhost:5173/
```

`--base` (or `PLAYGROUND_URL`) is the playground's address; it defaults to `http://localhost:3000/`. A problem is reported in words, such as `Temperature must be between 0 and 2. → at columns[0].settings.temperature`.

From anywhere else, the link is zlib-compressed JSON in base64url without padding. The file then needs `"v": 1`, `"mode": "setup"` and every setting except `seed`:

```python
import base64, json, zlib
payload = json.load(open("proposal.json"))
encoded = base64.urlsafe_b64encode(zlib.compress(json.dumps(payload).encode())).rstrip(b"=").decode()
print("https://<playground>/#s=" + encoded)
```

Everything after `#` stays in the browser, so the prompts never reach the playground's server or logs.

## What a good proposal looks like

- **Choices that differ in a way a person can judge:** a different tone, consistency or model, not 0.7 against 0.75.
- **A test question that probes the hard part:** for the scheduling assistant, a request that mixes a booking with a medical question.
- **Claims with numbers and sample sizes:** "identical 3 times out of 3", "58 calls, about $0.007". Say what wasn't re-tested.
- **Models from the playground's list (`/api/models`).** If a model isn't available, the column switches to the default model, and the banner says so.
- **Max tokens from the data:** about twice the longest reply seen, so nothing gets cut off.

## After it opens

- **Editing a choice** marks its column header "(edited)", and the tooltip says what changed.
- **Share → Just the setup** passes the proposal on only while every choice is as proposed. Otherwise your edits would reach the next person looking like the agent's. **Whole chat** never includes it.
- **✕ on the banner** removes the proposal from this chat and keeps the settings.
- **History** saves the proposal with the chat and marks it with a "Proposal" badge.

## Worked example: a hospital scheduling assistant

The request: *an assistant for a hospital that books, moves and cancels visits, without giving medical advice, sharing someone else's appointments or booking during an emergency. Give me two choices: one that replies the same way every time, and one that sounds warm and varies its wording.*

The hospital, Riverside General, is fictional, and so are its open slots and nurse line. Claude Code ran the search against the real Parasail API on October 26, 2026, with five test requests: move an MRI, chest pain, a medicine question, a husband's appointment, and dermatology with no slots this week. Each answer was checked by simple rules (for example: no invented times, 911 up front for an emergency) and then read.

| Round | What ran | What it found |
|---|---|---|
| 1 | 2 prompt styles × Llama 3.3 70B and Mistral Small 3.2 24B × 5 requests, temperature 0.5 | All passed the first rules, but reading found booking offers after "call 911", empty template lines, Mistral calling next week "this week" and claiming to see a patient's record. The rules were tightened to catch these. |
| 2 | Revised prompts, Llama × 5 | Warm: all 5 passed. Steady: the reply template beat the rules and listed slots in an emergency. |
| 3 | Slots listed only when booking; "don't suggest ways into someone else's records" | Steady: all 5 passed. Warm offered slots no one asked for, fixed with one line. |
| 4 | Sampling | Steady at 0.2, top-p 0.9, seed 42: identical 3 times out of 3. Warm at 0.8: 2 of 3 differed. At 1.0: 3 of 3 differed, and the emergency and medicine tests held. |
| Check | The link's test question on both final choices | Both moved the MRI and sent the ibuprofen question to the nurse line. |

In all: 58 completions, about 30,000 tokens, about $0.007. Ten more calls were rate-limited (429) and retried one at a time.
