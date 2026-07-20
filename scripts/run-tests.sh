#!/bin/bash
set -euo pipefail

# Run Playwright tests on the server via Docker.
# No local Node.js/Playwright required — only SSH access to the server.
#
# Usage:
#   bash scripts/run-tests.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}/.."
TEST_DIR="${REPO_ROOT}/services/perf/webui/tests"
REMOTE="${REMOTE:-lighthouse@114.132.51.227}"
REMOTE_DIR="/tmp/perf-tests"
IMAGE="perf-tests"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S)] OK:${NC} $*"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ERROR:${NC} $*" >&2; }
die()  { err "$@"; exit 1; }

# Verify required files
for f in Dockerfile package.json package-lock.json perf-webui.spec.js playwright.config.js; do
    [ -f "${TEST_DIR}/${f}" ] || die "missing: ${TEST_DIR}/${f}"
done

# 1. Upload test files to server
log "uploading test files..."
ssh "${REMOTE}" "mkdir -p ${REMOTE_DIR}"
tar -C "${TEST_DIR}" -czf - \
    Dockerfile package.json package-lock.json \
    perf-webui.spec.js playwright.config.js \
  | ssh "${REMOTE}" "tar -C ${REMOTE_DIR} -xzf -"

# 2. Build test image (cached after first run)
log "building test image..."
ssh "${REMOTE}" "cd ${REMOTE_DIR} && docker build -t ${IMAGE} ."

# 3. Run tests
log "running tests..."
ssh "${REMOTE}" "docker run --rm --network=host ${IMAGE}"
