#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

trap 'log "Interrupted"; exit 130' INT

REGISTRY=""
PREFIX="${REGISTRY_PREFIX:-}"
if [[ -z "$PREFIX" ]] && [[ -f "${SCRIPT_DIR}/../deploy/docker/.env" ]]; then
    PREFIX=$(grep '^REGISTRY_PREFIX=' "${SCRIPT_DIR}/../deploy/docker/.env" | cut -d= -f2)
fi
PREFIX="${PREFIX:-linquickrec}"
DRY_RUN=false
TARGET=""

build_services() {
    cat <<EOF
etcd:${PREFIX}/etcd:latest
base:${PREFIX}/base:latest
discovery:${PREFIX}/discovery:latest
kv-worker:${PREFIX}/kv-worker:latest
feature:${PREFIX}/feature:latest
recall:${PREFIX}/recall:latest
precalc-and-rank-master:${PREFIX}/precalc-and-rank-master:latest
rank-sub:${PREFIX}/rank-sub:latest
proxy:${PREFIX}/proxy:latest
perf-collector:${PREFIX}/perf-collector:latest
perf-webui:${PREFIX}/perf-webui:latest
EOF
}

ALIASES=(
    "discovery-server:discovery"
    "kv_worker:kv-worker"
    "kv:kv-worker"
    "feature-service:feature"
    "recall-service:recall"
    "precalc-and-rank-master:precalc-and-rank-master"
    "rank_sub:rank-sub"
    "rank-sub-service:rank-sub"
    "proxy-service:proxy"
    "perf-collector-service:perf-collector"
)

log() { echo "[$(date +%H:%M:%S)] $*"; }
err() { echo "[$(date +%H:%M:%S)] ERROR: $*" >&2; }

usage() {
    cat <<EOF
Usage: $(basename "$0") -r REGISTRY [image] [options]

Tag pre-built local Docker image(s) with the private registry and push them.
If image is omitted, defaults to all.

Options:
  -r, --registry REGISTRY  Private registry address (required)
      --prefix PREFIX      Image prefix (default: linquickrec)
      --dry-run            Print commands without running them
  -h, --help               Show this help

Images:
  all, base, etcd, discovery, kv-worker, feature, recall,
  precalc-and-rank-master, rank-sub, proxy

Examples:
  $(basename "$0") -r 192.168.0.1:5000                   # push all images (default)
  $(basename "$0") -r 192.168.0.1:5000 recall            # push recall only
  $(basename "$0") -r 192.168.0.1:5000 --dry-run all     # dry-run
EOF
}

run_cmd() {
    if $DRY_RUN; then
        log "[dry-run] $*"
        return 0
    fi
    "$@"
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -r|--registry)
                if [[ $# -lt 2 ]]; then
                    err "Missing value for $1"
                    usage
                    exit 1
                fi
                REGISTRY="$2"
                shift 2
                ;;
            --prefix)
                PREFIX="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            -*)
                err "Unknown option: $1"
                usage
                exit 1
                ;;
            *)
                if [[ -n "$TARGET" ]]; then
                    err "Only one image target is supported; got '${TARGET}' and '$1'"
                    usage
                    exit 1
                fi
                TARGET="$1"
                shift
                ;;
        esac
    done
}

canonical_target() {
    local target="$1"

    if [[ -z "$target" || "$target" == "all" ]]; then
        echo "all"
        return 0
    fi

    while IFS=: read -r name _; do
        if [[ "$target" == "$name" ]]; then
            echo "$name"
            return 0
        fi
    done < <(build_services)

    for alias_row in "${ALIASES[@]}"; do
        IFS=: read -r alias canonical <<<"$alias_row"
        if [[ "$target" == "$alias" ]]; then
            echo "$canonical"
            return 0
        fi
    done

    err "Unknown image target: ${target}"
    echo "Available images: base etcd discovery kv-worker feature recall precalc-and-rank-master rank-sub proxy" >&2
    exit 1
}

selected_services() {
    local target
    target="$(canonical_target "$TARGET")"

    while IFS=: read -r name image; do
        if [[ "$target" == "all" || "$target" == "$name" ]]; then
            echo "${name}:${image}"
        fi
    done < <(build_services)
}

push_image() {
    local image="$1"
    local tagged="${REGISTRY}/${image}"

    if ! $DRY_RUN && ! docker image inspect "$image" >/dev/null 2>&1; then
        err "Local image not found: ${image}"
        return 1
    fi

    log "Tagging ${image} -> ${tagged}"
    run_cmd docker tag "$image" "$tagged"

    log "Pushing ${tagged}"
    run_cmd docker push "$tagged"
}

process_one() {
    local row="$1"
    local name image

    IFS=: read -r name image <<<"$row"

    if [[ "$name" == "discovery" ]]; then
        if ! docker image inspect "$image" >/dev/null 2>&1; then
            log "Skipping ${name}: image not built (optional)"
            return 0
        fi
    fi

    log "===== ${name} ====="
    push_image "$image" || return 1
}

main() {
    parse_args "$@"

    if [[ -z "$REGISTRY" ]]; then
        err "REGISTRY is required, use -r/--registry"
        exit 1
    fi

    log "Registry: ${REGISTRY}"
    $DRY_RUN && log "Mode: dry-run"

    local failed=0
    local count=0
    while IFS= read -r row; do
        [[ -z "$row" ]] && continue
        ((count+=1))
        if ! process_one "$row"; then
            ((failed+=1))
        fi
    done < <(selected_services)

    if [[ $count -eq 0 ]]; then
        err "No image selected"
        exit 1
    fi

    if [[ $failed -gt 0 ]]; then
        err "${failed} image(s) failed"
        exit 1
    fi

    log "All done (${count} image(s))"
}

main "$@"
