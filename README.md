# Parasail Playground

Speedboat take-home · Senior track · Path 1 (Model Playground).

Try Parasail models, compare prompts and generation settings, and inspect streaming
responses, timing and cost. The production extension is resilience to inference
errors: visible retry countdowns, clear error cards and partial answers kept when
a stream fails.

## Preview

[Open the preview](https://speedboat-playground-yukunl.fly.dev) and sign in with
the password provided privately. The preview uses the real Parasail API.

## What to try

1. Pick a model, change its system prompt or settings, and send a prompt. Watch the
   response stream, then inspect time to first token, speed and estimated cost.
2. Switch to **Compare** in the prompt box. Choose a different model or settings
   for B, then send one prompt to both setups.
3. Reopen a chat from **History**, use **Share** to copy the setup or conversation,
   or open **Code** for the equivalent curl or Python request. History lives in
   your browser; Code examples use your own API key.
4. Open [Weather control](https://speedboat-playground-yukunl.fly.dev/?debug).
   **Busy, then recovers** retries after two 429s; **Model unavailable** retries
   and then shows the give-up card; **Stream drops** keeps the partial answer.
5. **Agent** connects your own coding agent to test models and settings and open
   its finalists in Compare. Open **Agent** in the header for token creation and
   the Claude Code or Codex setup commands. The
   [agent connection example](examples/agent-connect-example/) includes an expense
   policy prompt and test cases with expected answers.

## Run locally

```bash
git clone https://github.com/yukunl/playground.git
cd playground
```

Both options below use the vendored mock by default and need no API key or
`.env`. An existing `.env` can override those defaults.

### Docker

Requires Docker with Docker Compose.

```bash
docker compose up --build
```

Open http://localhost:3000. The mock's API docs are at
http://localhost:3001/docs. Stop the containers with `docker compose down`.

### Without Docker

Requires Node 22.12+ and Python 3.12 (recommended for the pinned mock dependencies).
On Windows, use WSL or Docker.

```bash
npm ci
npm run dev:all
```

Open http://localhost:5173. The command starts Vite, the API on port 3000 and the
mock on port 3001, creating `mock/.venv` and installing its dependencies on the
first run. Stop with Ctrl+C.

The mock chooses a canned reply from the last user message and ignores model
and settings changes, so Compare columns return the same text locally. The
preview uses real models.

### Real Parasail API (optional)

Create an ignored `.env` in the repo root with your own credentials:

```dotenv
PARASAIL_BASE_URL=https://api.parasail.io/api/v1/openai
PARASAIL_API_KEY=psk-<accesskey>-<secretkey>
PLAYGROUND_PASSWORD=<your-private-password>
```

Then run `npm run dev` or `docker compose up --build`. The password is required
when using the real API. Weather control is off by default against the real API;
add `PLAYGROUND_FAULTS=true` to enable it.

## Checks

With Node 22.12+:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Vitest covers client state, streaming, retries and API handlers. The build checks
that no Parasail key appears in the browser bundle.

## Review notes

- [Architecture notes](architecture-notes.md): stack, design choices and tradeoffs.
- [Submission notes](NOTES.md): scope, AI tooling and known gaps.
- Deployment configuration: [Dockerfile](Dockerfile),
  [docker-compose.yml](docker-compose.yml) and [fly.toml](fly.toml).

The preview uses one shared password. Per-visitor rate limits, a daily budget,
operational metrics and resumable streams are not implemented.
