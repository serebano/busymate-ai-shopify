#!/usr/bin/env bash
# test-migrate-rename.sh — tiny, dependency-free proof for migrate-rename.sh:
#   1. `bash -n` syntax check.
#   2. A full --apply dry-run inside a throwaway temp dir, with `systemctl`
#      and `curl` stubbed on PATH, proving the idempotent move+symlink+unit
#      logic actually does what it claims without touching the real host.
#   3. Runs it twice (idempotency) and exercises --rollback.
#
# No npm/node dependency — plain bash + coreutils, safe to run in CI on a
# bare ubuntu-latest runner.
#
# Usage: scripts/ops/test-migrate-rename.sh

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
MIGRATE="${SCRIPT_DIR}/migrate-rename.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok  - $*"; }

# ---------------------------------------------------------------------------
# 1. Syntax check
# ---------------------------------------------------------------------------
bash -n "$MIGRATE" || fail "bash -n on migrate-rename.sh"
pass "bash -n"

# ---------------------------------------------------------------------------
# 2. Isolated temp-dir harness
# ---------------------------------------------------------------------------
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

export OPT_ROOT="$TMP/opt"
export ETC_ROOT="$TMP/etc"
export UNIT_DIR="$TMP/systemd"
export HEALTH_URL="http://127.0.0.1:3970/api/bmai/status"
export HEALTH_TIMEOUT=4
export HEALTH_INTERVAL=1
OLD_NAME="bmai-shopify-app"
NEW_NAME="busymate-ai-shopify"

mkdir -p "$OPT_ROOT/$OLD_NAME" "$ETC_ROOT/$OLD_NAME" "$UNIT_DIR" "$TMP/bin" "$TMP/repo/deploy/systemd"
echo 'placeholder app files' > "$OPT_ROOT/$OLD_NAME/marker.txt"
echo 'DATABASE_URL=postgres://x' > "$ETC_ROOT/$OLD_NAME/env"
# A minimal real-looking unit file so migrate-rename.sh has something to install.
cat > "$TMP/repo/deploy/systemd/${NEW_NAME}.service" <<EOF
[Unit]
Description=test unit
[Service]
WorkingDirectory=${OPT_ROOT}/${NEW_NAME}
EnvironmentFile=${ETC_ROOT}/${NEW_NAME}/env
[Install]
WantedBy=multi-user.target
EOF
export SOURCE_UNIT_FILE="$TMP/repo/deploy/systemd/${NEW_NAME}.service"

# Stub systemctl: records every call, always "succeeds". STATE_FILE is
# expanded now (heredoc terminator is unquoted) so the stub needs no
# post-processing.
STATE_FILE="$TMP/systemctl-state"
: > "$STATE_FILE"
cat > "$TMP/bin/systemctl" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "${STATE_FILE}"
exit 0
STUB
chmod +x "$TMP/bin/systemctl"

# Stub curl: always reports healthy, no network involved.
cat > "$TMP/bin/curl" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$TMP/bin/curl"

export PATH="$TMP/bin:$PATH"

# --- plan mode must not touch anything ---
"$MIGRATE" > "$TMP/plan.out" 2>&1 || fail "plan mode (no flags) exited non-zero"
[ -d "$OPT_ROOT/$OLD_NAME" ] || fail "plan mode moved $OPT_ROOT/$OLD_NAME (it must not)"
[ ! -L "$OPT_ROOT/$OLD_NAME" ] || fail "plan mode created a symlink (it must not)"
grep -q "plan complete" "$TMP/plan.out" || fail "plan mode did not report a plan"
pass "plan mode is a no-op"

# --- apply ---
"$MIGRATE" --apply > "$TMP/apply1.out" 2>&1 || { cat "$TMP/apply1.out" >&2; fail "first --apply exited non-zero"; }
[ -L "$OPT_ROOT/$OLD_NAME" ] || fail "apply did not leave a symlink at $OPT_ROOT/$OLD_NAME"
[ -d "$OPT_ROOT/$NEW_NAME" ] || fail "apply did not create $OPT_ROOT/$NEW_NAME"
[ -f "$OPT_ROOT/$NEW_NAME/marker.txt" ] || fail "apply lost the moved directory contents"
[ -L "$ETC_ROOT/$OLD_NAME" ] || fail "apply did not symlink the old env dir"
[ -f "$ETC_ROOT/$NEW_NAME/env" ] || fail "apply did not move the env dir"
[ -f "$UNIT_DIR/${NEW_NAME}.service" ] || fail "apply did not install the new unit"
grep -q "enable ${NEW_NAME}.service" "$STATE_FILE" || fail "apply never enabled the new unit"
grep -q "start ${NEW_NAME}.service" "$STATE_FILE" || fail "apply never started the new unit"
pass "apply moves+symlinks+installs the unit and starts it"

# --- idempotency: second --apply must be a clean no-op-ish success ---
"$MIGRATE" --apply > "$TMP/apply2.out" 2>&1 || { cat "$TMP/apply2.out" >&2; fail "second --apply (idempotency) exited non-zero"; }
grep -qi "already migrated" "$TMP/apply2.out" || fail "second --apply did not recognize prior migration"
pass "apply is idempotent"

# --- rollback ---
: > "$STATE_FILE"
"$MIGRATE" --rollback > "$TMP/rollback.out" 2>&1 || { cat "$TMP/rollback.out" >&2; fail "--rollback exited non-zero"; }
grep -q "enable ${OLD_NAME}.service" "$STATE_FILE" || fail "rollback did not re-enable the old unit"
grep -q "start ${OLD_NAME}.service" "$STATE_FILE" || fail "rollback did not start the old unit"
pass "rollback re-enables the old unit"

# --- auto-rollback on failed health check ---
cat > "$TMP/bin/curl" <<'STUB'
#!/usr/bin/env bash
exit 1
STUB
chmod +x "$TMP/bin/curl"
rm -rf "$OPT_ROOT" "$ETC_ROOT"
mkdir -p "$OPT_ROOT/$OLD_NAME" "$ETC_ROOT/$OLD_NAME"
echo 'placeholder' > "$OPT_ROOT/$OLD_NAME/marker.txt"
echo 'DATABASE_URL=x' > "$ETC_ROOT/$OLD_NAME/env"
rm -f "$UNIT_DIR/${NEW_NAME}.service"
: > "$STATE_FILE"
if "$MIGRATE" --apply > "$TMP/apply3.out" 2>&1; then
  fail "--apply with a failing health check should exit non-zero"
fi
grep -qi "auto-rolling back" "$TMP/apply3.out" || fail "unhealthy apply did not trigger auto-rollback"
grep -q "enable ${OLD_NAME}.service" "$STATE_FILE" || fail "auto-rollback did not re-enable the old unit"
pass "unhealthy apply auto-rolls-back within HEALTH_TIMEOUT"

echo "ALL OK"
