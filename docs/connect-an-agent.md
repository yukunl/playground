# Connect your agent

Someone moving off a proprietary model already has a system prompt and the answers they expect. They want to know whether something on Parasail gives the same answers for less money, or faster. They bring their own coding agent (Claude Code, Codex) and connect it to the playground over MCP:

- **Your agent** tests a bounded set of models and settings against your baseline, checking accuracy, cost and latency. It judges accuracy; the playground measures speed and cost on every run.
- **The playground** opens the finalists side by side, so you can inspect them and try them yourself.

The agent never sees the playground's password or the Parasail key. It gets an **agent token** that opens the MCP endpoint and nothing else.

## Step by step

The same steps are in the playground: **Agent** in the header. There, the commands already carry this playground's address.

1. **Make a token.** In the playground, open **Agent**, pick how long it works (1 day or 7 days) and press **Make token**. Copy it: it's shown once.

2. **Put it in the terminal you'll start your agent from**, without it going into your shell history or a file:

   ```bash
   read -rs PLAYGROUND_AGENT_TOKEN && export PLAYGROUND_AGENT_TOKEN
   ```

   Paste the token and press Return. Nothing is shown.

3. **Add the playground to your agent.** Replace the address with your playground's.

   Claude Code, in your project folder:

   ```bash
   claude mcp add --transport http --scope project parasail-playground https://<playground>/api/mcp --header 'Authorization: Bearer ${PLAYGROUND_AGENT_TOKEN}'
   ```

   The single quotes matter: `.mcp.json` gets the variable's name, and Claude Code fills in the token when it starts. The file holds no secret, so it's safe to commit. The first time Claude Code starts in that folder, it asks you to approve the server; `/mcp` then shows whether it's connected.

   Codex:

   ```bash
   codex mcp add parasail-playground --url https://<playground>/api/mcp --bearer-token-env-var PLAYGROUND_AGENT_TOKEN
   ```

   Codex saves the variable's name in `~/.codex/config.toml`. `codex mcp list` shows it.

4. **Start your agent in that terminal and ask.** For example, with [this repo's example](../examples/support-triage/):

   > My system prompt is in examples/support-triage/prompt.txt, and my test cases with the answers I expect are in examples/support-triage/cases.jsonl. Today I pay $2.00 per million input tokens and $8.00 per million output tokens, with about 900 ms to the first token. Using parasail-playground, test 3 or 4 models at temperature 0 against my expected answers, and compare accuracy, cost and latency with what I have today. Then open your top two in the playground.

5. **Open the link it gives you, and press ⌘↵.** The finalists open in Compare with the agent's claims above them ([agent-handoff.md](agent-handoff.md)). Nothing has run yet: ⌘↵ runs both live, and each answer shows its time to first token, speed and cost.

## The tools

| Tool | What it does |
|---|---|
| `list_models` | The models this playground can run, with list prices per million tokens. Parasail's own model list has no prices; they come from the playground's table. |
| `run` | One setup (model, system prompt, settings) on 1 to 5 inputs. Each answer comes back with time to first token, total time, tokens per second, token counts and cost, measured the way the page measures them. Unset settings take the page's defaults. Nothing is scored: the agent judges. |
| `open_in_playground` | The agent's top one or two setups, title, summary, reasons and test question → a proposal link. It's the same link `npm run share-link` makes, checked against the schema the page opens it with. |

The endpoint is `POST /api/mcp`: MCP over Streamable HTTP in its simplest form, one JSON answer per message, with no sessions and no stream from the server.

## What keeps it safe

| | |
|---|---|
| **The token opens one route** | `/api/mcp` only. Not the page, `/api/chat`, `/api/models`, or `/api/agent-token`, so a token can't make another one. |
| **It ends on its own** | After 1 or 7 days. Changing `PLAYGROUND_PASSWORD` ends every token at once, and signs every browser out. |
| **It can only spend so much** | 300 runs per token, at most 5 inputs per call, and at most 2 calls to Parasail at a time across every agent (the key rate-limits at 4). Rate-limited calls are retried with backoff. The counts are kept in memory, so a restart resets them. |
| **Nothing is stored** | The token is signed with a key derived from the password, so the server needs no database to check it. Logs name a token by its short ID, never the token, and never prompts or answers. |
| **Web pages can't use it** | A request whose `Origin` is another site is refused. A page that points its own name at your server (DNS rebinding) gets past that check, but not the gate: it has neither the cookie nor a token. Without `PLAYGROUND_PASSWORD` there's no gate, and the server only starts that way against the mock. |
| **The tools do little** | They list, run and make links: nothing deletes, nothing reads anyone's chats. That bounds what an agent misled by text in a model's answer can do. |

An agent that runs shell commands can read its own environment, so it can see its token. That's why the token is limited, not why it's secret. If one leaks, it opens only `/api/mcp`, within its runs, until it expires.

Signing in with the password (a browser cookie or Basic Auth) also opens `/api/mcp`, with no run limit. Scripts can use that, but agents should get a token.
