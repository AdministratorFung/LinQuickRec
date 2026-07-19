const SERVICE_COLORS = {
    proxy: '#206bc4',
    feature: '#4299e1',
    recall: '#48bb78',
    precalc: '#ed8936',
    rank_master: '#9f7aea',
    rank_sub: '#ed64a6',
    _default: '#94a3b8',
};

function svcColor(svc) { return SERVICE_COLORS[svc] || SERVICE_COLORS._default; }
function statusBadge(status) {
    if (!status) return '';
    const c = status === 'ok' ? 'badge-green' : status === 'error' ? 'badge-red' : 'badge-yellow';
    return '<span class="badge ' + c + '">' + status + '</span>';
}

let traceOffset = 0;
const TRACE_PAGE = 20;

async function loadTraceList(append) {
    if (!append) { traceOffset = 0; document.getElementById('trace-list').innerHTML = ''; }
    const list = await fetchTraces(TRACE_PAGE, traceOffset);
    console.log('[trace] list loaded:', list.length, 'items, offset:', traceOffset);
    const container = document.getElementById('trace-list');

    if (!list.length && !append) {
        container.innerHTML = '<div class="empty-state">No traces found. Send some requests from the Test tab first.</div>';
        document.getElementById('trace-load-more').style.display = 'none';
        return;
    }
    document.getElementById('trace-load-more').style.display = list.length >= TRACE_PAGE ? '' : 'none';

    list.forEach(function(t, i) {
        const row = document.createElement('tr');
        row.className = 'clickable';
        row.innerHTML = '<td class="text-secondary">#' + (traceOffset + i + 1) + '</td>' +
            '<td class="fw-medium">' + t.trace_id + '</td>' +
            '<td class="text-secondary">' + new Date(t.ts_us / 1000).toISOString().slice(0,19).replace('T',' ') + '</td>' +
            '<td>' + t.span_count + '</td>' +
            '<td class="text-end fw-medium">' + t.total_duration_ms.toFixed(1) + ' ms</td>';
        row.onclick = function () { showTraceDetail(t.trace_id); };
        container.appendChild(row);
    });
    traceOffset += list.length;
}

async function searchTrace() {
    const traceId = document.getElementById('traceIdInput').value.trim();
    console.log('[trace] searching:', traceId);
    if (!traceId) return;
    document.getElementById('trace-load-more').style.display = 'none';
    showTraceDetail(traceId);
}

async function showTraceDetail(traceId) {
    const container = document.getElementById('trace-result');
    container.innerHTML = '<div class="empty-state">Loading...</div>';
    document.getElementById('trace-table').style.display = 'none';
    container.style.display = 'block';

    const result = await fetchTrace(traceId);
    if (!result || !result.tree) {
        console.warn('[trace] not found:', traceId);
        container.innerHTML = '<div class="empty-state">Trace not found.</div>';
        return;
    }

    const allSpans = [];
    function collect(node) { if (node.duration_ms !== undefined || node.virtual) allSpans.push(node); for (const c of (node.children || [])) collect(c); }
    collect(result.tree);
    if (!allSpans.length) { container.innerHTML = '<div class="empty-state">No spans in tree.</div>'; return; }

    const minTs = allSpans[0].ts_us || 0;
    const maxDuration = Math.max(...allSpans.map(s => s.duration_ms || 0), 1);
    const totalRange = ((allSpans[allSpans.length - 1].ts_us || 0) - minTs) / 1000;
    const refMs = Math.pow(10, Math.floor(Math.log10(maxDuration || 1)));

    let html = '<button class="btn btn-ghost" onclick="showTraceTable()" style="margin-bottom:12px">← Back to List</button>';
    html += '<div class="table-wrap"><table class="table"><thead><tr><th>Service</th><th>Stage</th><th class="text-end">Duration</th><th>Waterfall</th><th>Status</th></tr></thead><tbody>';
    function render(node, depth) {
        if (!node || (node.duration_ms === undefined && !node.virtual && !(node.children && node.children.length))) return;
        const indent = depth * 20;
        const offset = node.ts_us ? ((node.ts_us - minTs) / 1000) : 0;
        const dur = node.duration_ms || 0;
        const barScale = 600 / totalRange;
        const barOffset = offset * barScale;
        const barWidth = Math.max(dur * barScale, 3);
        html += '<tr><td style="padding-left:' + (indent + 12) + 'px"><span class="svc-dot" style="background:' + svcColor(node.service) + '"></span>' + (node.service || '') + '</td>' +
            '<td class="text-secondary">' + (node.stage || '') + '</td>' +
            '<td class="text-end fw-medium">' + dur.toFixed(2) + ' ms</td>' +
            '<td><div class="waterfall-bar" style="margin-left:' + barOffset + 'px"><div style="background:' + svcColor(node.service) + ';height:20px;width:' + barWidth + 'px;border-radius:3px;opacity:' + (node.virtual ? 0.4 : 0.85) + '"></div></div></td>' +
            '<td>' + statusBadge(node.status) + (node.virtual ? '<span class="badge badge-gray">virtual</span>' : '') + '</td></tr>';
        for (const c of (node.children || [])) render(c, depth + 1);
    }
    render(result.tree, 0);
    html += '</tbody></table></div>';

    const totalMs = totalRange.toFixed(1);
    console.log('[trace] found:', allSpans.length, 'spans,', totalMs, 'ms total');
    html += '<div class="trace-summary">' + allSpans.length + ' spans &middot; ' + totalMs + ' ms total &middot; reference bar = ' + refMs + ' ms</div>';
    const refWidth = refMs * (600 / totalRange);
    html += '<div class="waterfall-ref"><div style="background:rgba(32,107,196,0.18);height:20px;width:' + Math.min(refWidth, 600) + 'px;border-radius:3px;border:1px dashed rgba(32,107,196,0.3)"></div><span class="text-secondary" style="font-size:10px;margin-left:4px">' + refMs + ' ms</span></div>';

    container.innerHTML = html;
}

function showTraceTable() {
    document.getElementById('trace-result').style.display = 'none';
    document.getElementById('trace-table').style.display = 'block';
}

loadTraceList(false);
