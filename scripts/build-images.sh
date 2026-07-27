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
          proxy recall perf-collector perf-webui
          (default: all)

Options:
  --vllm             Enable vLLM mode for recall (sets ENABLE_VLLM=true)
  --push <reg>       Tag and push to private registry after build
  --no-cache         Pass --no-cache to docker compose build
  --clean            Remove all images built by this compose file (no build)
  -h, --help         Show this help

Examples:
  bash scripts/build-images.sh                                      # build all
  bash scripts/build-images.sh perf-collector perf-webui            # build specific services
  bash scripts/build-images.sh recall --vllm                        # build recall with vLLM
  bash scripts/build-images.sh --push 127.0.0.1:5000                # build all + push to registry
  bash scripts/build-images.sh --push 127.0.0.1:5000 recall --vllm  # build recall + push
  bash scripts/build-images.sh --no-cache                           # force rebuild (no cache)
  bash scripts/build-images.sh --clean                              # remove all local images (no build)
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
            proxy|recall|perf-collector|perf-webui)
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

    local compose_opts=("-f" "$COMPOSE_FILE")
    [[ "$NO_CACHE" == true ]] && compose_opts+=(--no-cache)

    local build_services=()
    if [[ ${#SERVICES[@]} -gt 0 ]]; then
        build_services=("${SERVICES[@]}")
    else
        build_services=("etcd" "kv-worker" "feature" "precalc-and-rank-master"
                        "rank-sub" "proxy" "recall" "perf-collector" "perf-webui")
    fi

    if [[ "$CLEAN" == true ]]; then
        # Read REGISTRY_PREFIX from .env file (required — no fallback to env var)
        local env_file="${REPO_ROOT}/deploy/docker/.env"
        if [[ ! -f "$env_file" ]]; then
            die "Env file not found: ${env_file}"
        fi
        local PREFIX
        PREFIX=$(grep '^REGISTRY_PREFIX=' "$env_file" | cut -d= -f2)
        if [[ -z "$PREFIX" ]]; then
            die "REGISTRY_PREFIX not set in ${env_file}"
        fi

        # Step 1: stop all compose containers
        log "Stopping containers..."
        docker compose -f "$COMPOSE_FILE" stop 2>/dev/null || true

        # Step 2: remove all compose containers
        log "Removing containers..."
        docker compose -f "$COMPOSE_FILE" rm -f 2>/dev/null || true

        # Step 3: find image IDs matching the prefix (single source of truth)
        # Both local tags (prefix/*) and registry-pushed tags (*/prefix/*)
        local ids1=$(docker images --filter "reference=${PREFIX}/*" -q 2>/dev/null)
        local ids2=$(docker images --filter "reference=*/${PREFIX}/*" -q 2>/dev/null)
        local ids=$( (echo "$ids1"; echo "$ids2") | sort -u | sed '/^$/d' )

        if [[ -z "$ids" ]]; then
            log "No images found with prefix ${PREFIX}"
            exit 0
        fi

        # Step 4: show ALL tags referencing these image IDs
        # This ensures the user sees exactly what will be deleted (including
        # tags from other prefixes that share the same image SHA)
        log "Containers stopped and removed."
        log "The following images will be deleted:"
        echo ""
        docker images --format "{{.ID}} {{.Repository}}:{{.Tag}}" \
            | grep -Ff <(echo "$ids") \
            | awk '{printf "  %-50s (SHA: %s)\n", $2, substr($1,1,12)}'
        echo ""

        # Step 5: user confirmation (default N for safety)
        read -p "Delete ALL these images? [y/N] " confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            log "Cancelled"
            exit 0
        fi

        # Step 6: delete images by ID (docker rmi operates on SHA hashes)
        echo "$ids" | xargs docker rmi -f 2>/dev/null
        log "Clean complete"
        exit 0
    fi

    log "Building images..."
    export ENABLE_VLLM
    docker compose "${compose_opts[@]}" build "${build_services[@]}"

    log "Build complete"

    if [[ -n "$PUSH_REG" ]]; then
        log "Pushing to ${PUSH_REG}..."
        local push_targets=""
        if [[ ${#SERVICES[@]} -gt 0 ]]; then
            push_targets="${SERVICES[*]}"
        fi
        bash "${SCRIPT_DIR}/push-to-registry.sh" -r "$PUSH_REG" ${push_targets:-all}
    fi

}

main "$@"
