#!/usr/bin/env bash
# Runs the vendored Parasail mock on :3001 without Docker.
# The first run creates mock/.venv. Needs Python 3.10+: the mock's pydantic
# models use `X | None` hints, which don't work on 3.9.
set -euo pipefail
cd "$(dirname "$0")/../mock"

if [ ! -x .venv/bin/uvicorn ]; then
  py=""
  for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1 &&
      "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then
      py="$candidate"
      break
    fi
  done
  if [ -z "$py" ]; then
    echo "mock: Python 3.10+ not found. Install it, or use 'docker compose up'." >&2
    exit 1
  fi
  echo "mock: creating mock/.venv with $py"
  "$py" -m venv .venv
  .venv/bin/pip install --quiet -r mock-server/requirements.txt
fi

cd mock-server
exec ../.venv/bin/uvicorn main:app --port "${MOCK_PORT:-3001}"
