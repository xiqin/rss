#!/usr/bin/env bash
# loom — 公共函数库
# 被 install.sh 和 uninstall.sh 共享

REPO="xiqin/loom"
VERSION="3.0.1"
# AUTO-SYNC: updated by scripts/generate-tooling.mjs and scripts/sync-version.mjs
SUPPORTED_TOOLS=("claude-code" "cursor" "copilot" "opencode" "codex")

# ── Flags ──────────────────────────────────────────────────────────────
DRY=0
FROM_RELEASE=0
TOOLS=()
NO_COLOR=0
FAILURE_COUNT=0

# ── Color ──────────────────────────────────────────────────────────────
if [ ! -t 1 ]; then NO_COLOR=1; fi
if [ "$NO_COLOR" = 1 ]; then
  c_info=""; c_dim=""; c_ok=""; c_warn=""; c_err=""; c_reset=""
else
  c_info=$'\033[38;5;39m'
  c_dim=$'\033[2m'
  c_ok=$'\033[32m'
  c_warn=$'\033[33m'
  c_err=$'\033[31m'
  c_reset=$'\033[0m'
fi

say()   { printf '%s%s%s\n' "$c_info" "$1" "$c_reset"; }
note()  { printf '%s%s%s\n' "$c_dim" "$1" "$c_reset"; }
ok()    { printf '%s%s%s\n' "$c_ok" "$1" "$c_reset"; }
warn()  { printf '%s%s%s\n' "$c_warn" "$1" "$c_reset" >&2; }
err()   { printf '%s%s%s\n' "$c_err" "$1" "$c_reset" >&2; }

# ── Parse args ─────────────────────────────────────────────────────────
parse_args() {
  local help_func="$1"
  shift

  while [ $# -gt 0 ]; do
    case "$1" in
      --tool)
        shift
        if [ $# -eq 0 ]; then err "error: --tool requires an argument"; exit 2; fi
        TOOLS+=("$1") ;;
      --dry-run)       DRY=1 ;;
      --from-release)  FROM_RELEASE=1 ;;
      --no-color)      NO_COLOR=1 ;;
      --version)
        shift
        if [ $# -eq 0 ]; then err "error: --version requires an argument"; exit 2; fi
        VERSION="$1" ;;
      -h|--help)       $help_func; exit 0 ;;
      *)
        err "error: unknown flag: $1"; echo "run '$0 --help' for usage"; exit 2 ;;
    esac
    shift
  done
}

# ── Validate ───────────────────────────────────────────────────────────
validate_tools() {
  if [ ${#TOOLS[@]} -eq 0 ]; then
    err "error: --tool is required"
    echo "  Supported: ${SUPPORTED_TOOLS[*]}"
    echo "  Example: $0 --tool claude-code"
    exit 2
  fi
  for t in "${TOOLS[@]}"; do
    valid=0
    for s in "${SUPPORTED_TOOLS[@]}"; do [ "$t" = "$s" ] && valid=1; done
    if [ "$valid" = 0 ]; then
      err "error: unsupported tool '$t'. Supported: ${SUPPORTED_TOOLS[*]}"
      exit 2
    fi
  done
}

# ── Detect repo root ──────────────────────────────────────────────────
detect_repo_root() {
  local src="${BASH_SOURCE[1]:-${BASH_SOURCE[0]:-}}"
  if [ -n "$src" ] && [ -f "$src" ]; then
    local d
    d="$(cd "$(dirname "$src")" 2>/dev/null && pwd)"
    if [ -n "$d" ] && [ -f "$d/bin/loom.js" ] && [ -f "$d/package.json" ]; then
      echo "$d"
      return 0
    fi
  fi
  return 1
}

# ── Resolve loom source ─────────────────────────────────────────────────
LOOM_CLI=""
CLEANUP_DIR=""

resolve_source() {
  local repo_root="$1"

  if [ "$FROM_RELEASE" = 0 ] && [ -n "$repo_root" ]; then
    note "  mode: local ($repo_root)"
    LOOM_CLI="$repo_root/bin/loom.js"
    return 0
  fi

  # Remote: download from release tag
  if ! command -v curl >/dev/null 2>&1; then
    err "error: curl is required for --from-release"
    exit 1
  fi
  if ! command -v tar >/dev/null 2>&1; then
    err "error: tar is required for --from-release"
    exit 1
  fi

  note "  mode: release (v$VERSION)"
  CLEANUP_DIR="$(mktemp -d)"
  local tarball="$CLEANUP_DIR/loom.tar.gz"

  say "  downloading loom v$VERSION from $REPO..."
  curl -fsSL "https://github.com/$REPO/archive/refs/tags/v$VERSION.tar.gz" -o "$tarball"

  note "  extracting..."
  tar xzf "$tarball" -C "$CLEANUP_DIR"
  if [ $? -ne 0 ]; then
    err "error: extraction failed"
    rm -rf "$CLEANUP_DIR"
    exit 1
  fi

  local extracted="$CLEANUP_DIR/loom-$VERSION"
  if [ ! -d "$extracted" ]; then
    extracted="$(ls -d "$CLEANUP_DIR"/*/ 2>/dev/null | head -1)"
    extracted="${extracted%/}"
  fi

  if [ ! -f "$extracted/bin/loom.js" ]; then
    err "error: download appears incomplete — bin/loom.js not found"
    rm -rf "$CLEANUP_DIR"
    exit 1
  fi

  note "  installing dependencies..."
  (cd "$extracted" && npm install --production 2>/dev/null) || \
    warn "  warning: npm install failed, some features may not work"

  LOOM_CLI="$extracted/bin/loom.js"
}

cleanup() {
  if [ -n "$CLEANUP_DIR" ] && [ -d "$CLEANUP_DIR" ]; then
    rm -rf "$CLEANUP_DIR"
  fi
}
trap cleanup EXIT

# ── Check Node.js ──────────────────────────────────────────────────────
check_node() {
  if ! command -v node >/dev/null 2>&1; then
    err "error: Node.js is required (https://nodejs.org)"
    err "  Install Node.js >= 22 and re-run"
    exit 1
  fi
  local node_ver
  node_ver="$(node -v | sed 's/v//' | cut -d. -f1)"
  if [ "$node_ver" -lt 22 ]; then
    err "error: Node.js >= 22 required (found: $(node -v))"
    exit 1
  fi
}
