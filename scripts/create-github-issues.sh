#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-guangyang1206/adaptive-model-router}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRAFT_DIR="$ROOT_DIR/.github/ISSUE_DRAFTS"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required to create issues. Install and authenticate it first." >&2
  exit 1
fi

create_issue() {
  local title="$1"
  local labels="$2"
  local file="$3"
  gh issue create --repo "$REPO" --title "$title" --label "$labels" --body-file "$file"
}

create_issue "Add examples for routing policies" "good first issue,docs,examples" "$DRAFT_DIR/01-routing-policy-examples.md"
create_issue "Improve dashboard empty states" "good first issue,dashboard" "$DRAFT_DIR/02-dashboard-empty-states.md"
create_issue "Add CLI help snapshots" "good first issue,cli,tests" "$DRAFT_DIR/03-cli-help-snapshots.md"
create_issue "Add Qwen provider adapter" "help wanted,provider" "$DRAFT_DIR/04-qwen-provider-adapter.md"
create_issue "Add Gemini provider adapter" "help wanted,provider" "$DRAFT_DIR/05-gemini-provider-adapter.md"
create_issue "Add vLLM provider adapter" "help wanted,provider,open-source" "$DRAFT_DIR/06-vllm-provider-adapter.md"
create_issue "Improve SQLite support beyond fallback mode" "help wanted,storage" "$DRAFT_DIR/07-sqlite-compatibility.md"
create_issue "Add CI matrix" "help wanted,ci" "$DRAFT_DIR/08-ci-matrix.md"
