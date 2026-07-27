#!/bin/bash
set -euo pipefail

NAMESPACE="linquickrec"
TIMEOUT="600"
ETCD_NODEPORT="32379"

usage() {
    cat <<EOF
Usage: $(basename "$0") [options]

Monitor K8s cluster health — checks etcd, pod readiness, service
registration, and WebUI reachability.

Options:
  -n, --namespace <name>     K8s namespace (default: linquickrec)
  -t, --timeout <seconds>    Max wait time (default: 600)
  -e, --etcd-port <port>     etcd NodePort (default: 32379)
  -h, --help                 Show this help

Examples:
  $(basename "$0")                                    # default namespace
  $(basename "$0") -n dev-haoyu                       # custom namespace
  $(basename "$0") -n dev-haoyu -t 300                # 5 min timeout
EOF
    exit 0
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help) usage ;;
            -n|--namespace)
                [[ $# -lt 2 ]] && { echo "Missing value for $1"; exit 1; }
                NAMESPACE="$2"; shift 2 ;;
            -t|--timeout)
                [[ $# -lt 2 ]] && { echo "Missing value for $1"; exit 1; }
                TIMEOUT="$2"; shift 2 ;;
            -e|--etcd-port)
                [[ $# -lt 2 ]] && { echo "Missing value for $1"; exit 1; }
                ETCD_NODEPORT="$2"; shift 2 ;;
            *) echo "Unknown option: $1"; usage ;;
        esac
    done
}

parse_args "$@"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

START_TIME=$(date +%s)

phase()  { echo -e "\n${BOLD}${CYAN}===${NC} ${BOLD}$*${NC}"; }
ok()     { echo -e "  ${GREEN}✓${NC} $*"; }
warn()   { echo -e "  ${YELLOW}⚠${NC} $*"; }
info()   { echo -e "  ${CYAN}→${NC} $*"; }
fail()   { echo -e "  ${RED}✗${NC} $*"; }

die_block() {
    echo ""
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}ERROR: $*${NC}"
    echo -e "${RED}========================================${NC}"
    exit 1
}

die() { die_block "$@"; }

success_block() {
    local webui_status="$1"
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  ALL SYSTEMS READY${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  ✓ Cluster reachable${NC}"
    echo -e "${GREEN}  ✓ etcd cluster healthy${NC}"
    echo -e "${GREEN}  ✓ Pods ready${NC}"
    echo -e "${GREEN}  ✓ Services registered in etcd${NC}"
    if [ "$webui_status" = "ok" ]; then
        echo -e "${GREEN}  ✓ WebUI reachable${NC}"
    elif [ "$webui_status" = "skip" ]; then
        echo -e "${GREEN}  − WebUI skipped (no perf-webui pod)${NC}"
    else
        echo -e "${YELLOW}  ⚠ WebUI not reachable${NC}"
    fi
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Test: scripts/send-proxy-request.sh${NC}"
    exit 0
}

elapsed() { echo "$(($(date +%s) - START_TIME))"; }
check_timeout() {
    if [ "$(elapsed)" -ge "$TIMEOUT" ]; then
        echo ""
        echo -e "${RED}Timeout after ${TIMEOUT}s${NC}"
        echo ""
        echo "Pods not ready:"
        kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null | grep -vE 'Running.*1/1|Running.*2/2|Running.*3/3|Running.*5/5|Completed' || echo "(none)"
        die "Timed out waiting for deployment"
    fi
}

error_diagnose() {
    local pod="$1"
    echo ""
    echo "--- kubectl describe pod ${pod} -n ${NAMESPACE} (tail) ---"
    kubectl describe pod "$pod" -n "$NAMESPACE" 2>/dev/null | tail -25
    echo ""
    echo "--- kubectl logs ${pod} -n ${NAMESPACE} --tail=25 (first container) ---"
    local container
    container=$(kubectl get pod "$pod" -n "$NAMESPACE" -o jsonpath='{.spec.containers[0].name}' 2>/dev/null)
    if [ -n "$container" ]; then
        kubectl logs "$pod" -n "$NAMESPACE" -c "$container" --tail=25 2>/dev/null || echo "(no logs)"
    else
        echo "(no containers)"
    fi
}

main() {
# ============================================================================
# Phase 0: Cluster reachability
# ============================================================================
phase "Phase 0: Cluster Reachability"

if ! kubectl cluster-info >/dev/null 2>&1; then
    die_block "Cannot reach Kubernetes cluster. Check kubeconfig."
fi

if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
    die_block "Namespace ${NAMESPACE} does not exist."
fi
ok "Cluster reachable"

# ============================================================================
# Phase 1: Pod snapshot
# ============================================================================
phase "Phase 1: Pod Snapshot (${NAMESPACE})"

if ! kubectl get pods -n "$NAMESPACE" -o wide 2>/dev/null; then
    die_block "Cannot list pods in namespace ${NAMESPACE}. Does the namespace exist?"
fi
info "Snapshot captured — no health judgments made yet"

# ============================================================================
# Phase 2: etcd cluster health
# ============================================================================
phase "Phase 2: etcd Cluster Health (NodePort ${ETCD_NODEPORT})"

while true; do
    check_timeout
    health_resp=$(curl -s --connect-timeout 5 --max-time 5 "http://localhost:${ETCD_NODEPORT}/health" 2>/dev/null) || true

    if echo "$health_resp" | grep -q '"health"' && echo "$health_resp" | grep -q 'true'; then
        ok "etcd cluster healthy"
        break
    fi

    # Determine if etcd pods are failed or still initializing
    etcd_line=$(kubectl get pods -n "$NAMESPACE" -l app=etcd --no-headers 2>/dev/null) || true

    if [[ -z "$etcd_line" ]]; then
        warn "No etcd pods found in ${NAMESPACE}"
        sleep 5
        continue
    fi

    # Check for hard error states
    if echo "$etcd_line" | grep -qE "CrashLoopBackOff|ImagePullBackOff|ErrImagePull|Error|OOMKilled"; then
        bad_pod=$(echo "$etcd_line" | grep -E "CrashLoopBackOff|ImagePullBackOff|ErrImagePull|Error|OOMKilled" | awk '{print $1}' | head -1)
        fail "etcd pod ${bad_pod} is in error state"
        error_diagnose "$bad_pod"
        die "etcd cluster has errors"
    fi

    warn "etcd not yet ready — still initializing ($(elapsed)s / ${TIMEOUT}s)"
    sleep 5
done

# ============================================================================
# Phase 3: Pod readiness
# ============================================================================
phase "Phase 3: Pod Readiness Check"

while true; do
    check_timeout

    pods=$(kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null) || true
    total=$(echo "$pods" | grep -c '.' || echo 0)
    ready=$(echo "$pods" | awk '{split($2,r,"/"); if (($3=="Running" && r[1]==r[2]) || $3=="Completed") print}' | grep -c '.' || echo 0)

    echo "  → Ready pods: ${ready}/${total}  ($(elapsed)s / ${TIMEOUT}s)"

    if echo "$pods" | grep -qE "CrashLoopBackOff|ImagePullBackOff|ErrImagePull"; then
        bad_pod=$(echo "$pods" | grep -E "CrashLoopBackOff|ImagePullBackOff|ErrImagePull" | awk '{print $1}' | head -1)
        echo "  ✗ Pod ${bad_pod} is in error state"
        error_diagnose "$bad_pod"
        die "Pod has errors"
    fi

    if [ "$ready" -ge "$total" ] && [ "$total" -gt 0 ]; then
        echo "  ✓ All ${total} pods ready"
        break
    fi

    sleep 3
done

# ============================================================================
# Phase 4: etcd service registration
# ============================================================================
phase "Phase 4: etcd Service Registration"

reg_output=$(kubectl exec -n "$NAMESPACE" etcd-0 -- \
    etcdctl get --prefix /linquickrec/services/ --keys-only 2>/dev/null) || reg_output=""

if [[ -z "$reg_output" ]]; then
    fail "No services registered in etcd"
    die "Service registration failed"
fi

echo "$reg_output" | grep -oP '/linquickrec/services/\K[^/]+' | sort -u | while read svc; do
    count=$(echo "$reg_output" | grep -c "/linquickrec/services/${svc}/") || count=0
    echo -e "  ${GREEN}✓${NC} ${svc}: ${count} instance(s)"
done
ok "Services registered in etcd"

# ============================================================================
# Phase 5: WebUI reachability
# ============================================================================
phase "Phase 5: WebUI Reachability"

webui_status="skip"
webui_exists=$(kubectl get pods -n "$NAMESPACE" -l app=perf-webui --no-headers 2>/dev/null) || true

if [[ -z "$webui_exists" ]]; then
    info "perf-webui pod not found — skipping WebUI check"
else
    webui_resp=$(curl -s --connect-timeout 5 --max-time 5 http://localhost:32000/ 2>/dev/null) || true
    if echo "$webui_resp" | head -1 | grep -q '<!DOCTYPE html\|<html'; then
        ok "WebUI reachable (http://localhost:32000/)"
        webui_status="ok"
    else
        warn "WebUI not reachable — cluster health is not affected"
        webui_status="fail"
    fi
fi

success_block "$webui_status"
}

main "$@"
