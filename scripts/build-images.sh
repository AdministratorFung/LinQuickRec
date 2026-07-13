#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}/.."
COMPOSE_FILE="${REPO_ROOT}/deploy/docker/docker-compose.yml"

CLEAN=false
NO_CACHE=false
ENABLE_VLLM="${ENABLE_VLLM:-false}"
PUSH_REG=""
SERVICES=()

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ERROR:${NC} $*" >&2; }
die()  { err "$@"; exit 1; }

usage() {
    cat <<EOF
Usage: $(basename "$0") [service...] [options]

Build LinQuickRec Docker images.

Services: etcd kv-worker feature precalc-and-rank-master rank-sub
          proxy recall perf-collector perf-webui discovery
          (default: all)

Options:
  --vllm             Enable vLLM mode for recall (sets ENABLE_VLLM=true)
  --push <reg>       Tag and push to private registry after build
  --no-cache         Pass --no-cache to docker compose build
  --clean            Remove all images built by this compose file (no build)
  -h, --help         Show this help

Examples:
  $(basename "$0")                                        # build all
  $(basename "$0") perf-collector perf-webui              # build specific services
  $(basename "$0") recall --vllm                          # build recall with vLLM
  $(basename "$0") --push 127.0.0.1:5000                  # build all + push to registry
  $(basename "$0") --push 127.0.0.1:5000 recall --vllm    # build recall + push
  $(basename "$0") --no-cache                             # force rebuild (no cache)
  $(basename "$0") --clean                                # remove all local images (no build)
EOF
    exit 0
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)     usage ;;
            --clean)       CLEAN=true; shift ;;
            --vllm)        ENABLE_VLLM=true; shift ;;
            --no-cache)    NO_CACHE=true; shift ;;
            --push)
                [[ $# -lt 2 ]] && die "Missing value for --push"
                PUSH_REG="${2%/}"; shift 2 ;;
            etcd|kv-worker|feature|precalc-and-rank-master|rank-sub|\
            proxy|recall|perf-collector|perf-webui|discovery)
                SERVICES+=("$1"); shift ;;
            *) die "Unknown option or service: $1" ;;
        esac
    done
}

main() {
    parse_args "$@"

    if ! docker compose version >/dev/null 2>&1; then
        die "docker compose not available (requires Docker CLI v2+)"
    fi

    log "Compose file: ${COMPOSE_FILE}"
    log "vLLM mode:    ${ENABLE_VLLM}"

    local compose_args=()
    compose_args+=(-f "$COMPOSE_FILE")
    [[ "$NO_CACHE" == true ]] && compose_args+=(--no-cache)

    if [[ ${#SERVICES[@]} -gt 0 ]]; then
        compose_args+=("${SERVICES[@]}")
    else
        compose_args+=("etcd" "kv-worker" "feature" "precalc-and-rank-master"
                       "rank-sub" "proxy" "recall" "perf-collector" "perf-webui")
        # discovery is profile-only, build explicitly if requested or when all
        compose_args+=("--profile" "discovery-server")
    fi

    if [[ "$CLEAN" == true ]]; then
        log "Cleaning images..."
        docker compose -f "$COMPOSE_FILE" down --rmi all
        log "Clean complete"
        exit 0
    fi

    log "Building images..."
    export ENABLE_VLLM
    docker compose "${compose_args[@]}" build

    log "Build complete"

    if [[ -n "$PUSH_REG" ]]; then
        log "Pushing to ${PUSH_REG}..."
        local push_targets=""
        if [[ ${#SERVICES[@]} -gt 0 ]]; then
            push_targets="${SERVICES[*]}"
        fi
        "${SCRIPT_DIR}/push-to-registry.sh" -r "$PUSH_REG" ${push_targets:-all}
    fi

}

main "$@"
