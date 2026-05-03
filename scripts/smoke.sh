#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
PI_CODING_AGENT_DIR="$TMP/agent" PI_SESSIONS_DIR="$TMP/sessions" node "$ROOT/dist/cli.js" doctor
PI_CODING_AGENT_DIR="$TMP/agent" PI_SESSIONS_DIR="$TMP/sessions" node "$ROOT/dist/cli.js" list
