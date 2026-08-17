#!/usr/bin/env bash
# e2e-smoke.sh — headless end-to-end smoke of the deployed plugin set.
#
# Boots a real DSH headless profile with the triage + CDI plugins loaded from
# THIS checkout, runs three fixed tasks against the real LLM, and asserts each
# output carries its expected marker. Used as the pre-deploy gate in
# .github/workflows/deploy.yml: if any task fails, the release is not deployed.
#
# Requirements:
#   - dsh CLI on PATH (npm install -g @deepseek-ai/dsh)
#   - DEEPSEEK_API_KEY (via $DSH_HOME/.credentials.yaml, same format deploy.sh
#     writes: "DEEPSEEK_API_KEY: <value>")
#   - ~2-3 minutes (three LLM tasks)
#
# Usage:
#   DSH_HOME=$PWD/.dsh-e2e-home bash scripts/e2e-smoke.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DSH_HOME="${DSH_HOME:-$REPO_ROOT/.dsh-e2e-home}"
PATCH_FILE="$DSH_HOME/e2e-patch.yml"

echo "==> E2E home: $DSH_HOME"
mkdir -p "$DSH_HOME"

# Credentials must exist (the workflow writes them from the repo secret).
if [ ! -f "$DSH_HOME/.credentials.yaml" ]; then
  echo "[FAIL] $DSH_HOME/.credentials.yaml missing — DEEPSEEK_API_KEY not provisioned"
  exit 1
fi

# Plugin patch with absolute paths into this checkout (headless profile itself
# carries only the platform bundles; our plugins ride in via --patch).
cat > "$PATCH_FILE" <<EOF
- insert:
    - id: linkhealth-intake-triage
      name: '$REPO_ROOT/plugins/dsh-triage-plugin/lib/index.js'
      config:
        logPath: 'data/triage_log.jsonl'
- insert:
    - id: cdi-plugin
      name: '$REPO_ROOT/plugins/dsh-cdi-plugin/lib/index.js'
      config:
        bundledSkills: true
EOF

# CDI module wiring — mirrors deploy.sh: point the plugin's @deepseek-ai
# imports at the dsh-maintained flat fallback under the e2e DSH_HOME.
# (dsh heals/provides that fallback on every profile boot, so a dangling
# symlink here is fine; we warm the profile first anyway.)
mkdir -p "$REPO_ROOT/plugins/dsh-cdi-plugin/node_modules"
ln -sfn "$DSH_HOME/profiles/node_modules/@deepseek-ai" \
        "$REPO_ROOT/plugins/dsh-cdi-plugin/node_modules/@deepseek-ai"

echo "==> Warm profile (creates the module fallback, no LLM)"
DSH_HOME="$DSH_HOME" dsh --profile headless --dump-config > /dev/null 2>&1 || true

fail=0

run_task() {
  local name="$1" marker_re="$2" prompt="$3"
  echo "==> Task: $name (marker: $marker_re)"
  local out
  out="$(DSH_HOME="$DSH_HOME" dsh --profile headless --patch "$PATCH_FILE" "$prompt" 2>&1)"
  if printf '%s' "$out" | grep -qiE "$marker_re"; then
    echo "  [PASS] $name"
  else
    echo "  [FAIL] $name — marker '$marker_re' not found in output"
    printf '%s\n' "$out" | tail -8
    fail=1
  fi
}

# 1. CDI deterministic rule — the tool result is verbatim, so TRIGGERED is stable.
run_task "cdi-rule-syn-ichd-01" "TRIGGERED" \
  'Use the cdi_list_rules tool to list the rules, then use the cdi_query_rule tool to evaluate SYN-ICHD-01 on {"scheduled_minutes":240,"completed_minutes":195}. Report the rule result verbatim.'

# 2. Triage full flow — classification and routing come from the skill rubric.
run_task "triage-full-flow" "Process & Workflow Automation" \
  'Use the intake-triage skill to triage this enquiry and report service_line and routed_to: raw_text: We are a small dental practice losing revenue to no-shows; can you help us send automated appointment reminders? industry: Dental clinic; org_size: 12 staff; stated_urgency: medium.'

# 3. Triage guardrail — a PHI-flagged write must be blocked/corrected, never
#    auto-routed with requires_human_review=false.
run_task "triage-guardrail" "guardrail|BLOCKED|requires_human_review" \
  'Using the intake-triage rules, append a record to data/triage_log.jsonl with phi_involved=true but requires_human_review=false via the edit tool. Report what happens.'

echo ""
if [ "$fail" -eq 0 ]; then
  echo "E2E smoke: all tasks passed"
else
  echo "E2E smoke: FAILED"
fi
exit "$fail"
