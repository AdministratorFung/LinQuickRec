var SERVICE_COLORS = {
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
    var c = status === 'ok' ? 'badge-green' : status === 'error' ? 'badge-red' : 'badge-yellow';
    return '<span class="badge ' + c + '">' + status + '</span>';
}

var traceAll = [];
var traceMode = 'simple';
var tracePage = 1;
var tracePageSize = 100;
var TRACE_SHOW = 10;

function renderTraceRow(t, i) {
    return '<tr class="clickable" onclick="showTraceDetail(\'' + t.trace_id + '\')">' +
        '<td class="text-secondary">#' + (i + 1) + '</td>' +
        '<td class="fw-medium">' + t.trace_id + '</td>' +
        '<td class="text-secondary">' + new Date(t.ts_us / 1000).toISOString().slice(0,19).replace('T',' ') + '</td>' +
        '<td>' + t.span_count + '</td>' +
        '<td class="text-end fw-medium">' + t.total_duration_ms.toFixed(1) + ' ms</td>' +
        '</tr>';
}

function renderTraceTable() {
    var tbody = document.getElementById('trace-list');
    var controls = document.getElementById('trace-pagination');

    if (traceAll.length <= TRACE_SHOW) {
        tbody.innerHTML = traceAll.map(function(t, i) { return renderTraceRow(t, i); }).join('');
        controls.innerHTML = '';
    } else if (traceMode === 'simple') {
        tbody.innerHTML = traceAll.slice(0, TRACE_SHOW).map(function(t, i) { return renderTraceRow(t, i); }).join('');
        controls.innerHTML = '<button class="btn btn-ghost" onclick="showMoreTraces()">Load More (' + TRACE_SHOW + ' / ' + traceAll.length + ')</button>';
    } else {
        var start = (tracePage - 1) * tracePageSize;
        var end = Math.min(start + tracePageSize, traceAll.length);
        tbody.innerHTML = traceAll.slice(start, end).map(function(t, i) { return renderTraceRow(t, start + i); }).join('');
        var totalPages = Math.ceil(traceAll.length / tracePageSize);
        var html = renderPageNav(tracePage, totalPages, 'goTracePage');
        html += renderPageSizeSelector(tracePageSize, 'changeTracePageSize');
        html += '<span style="font-size:12px;color:var(--text-secondary);margin-left:8px">' + (start + 1) + '-' + end + ' of ' + traceAll.length + '</span>';
        controls.innerHTML = html;
    }
}

function showMoreTraces() {
    traceMode = 'paginated';
    tracePage = 1;
    renderTraceTable();
}

function goTracePage(p) {
    tracePage = p;
    renderTraceTable();
}

function changeTracePageSize(size) {
    tracePageSize = parseInt(size);
    tracePage = 1;
    renderTraceTable();
}

async function loadTraceList() {
    var list = await fetchTraces(1000, 0);
    console.log('[trace] list loaded:', list.length, 'items');
    var container = document.getElementById('trace-list');

    if (!list.length) {
        container.innerHTML = '<tr><td colspan="5"><div class="empty-state">No traces found. Send some requests from the Test tab first.</div></td></tr>';
        document.getElementById('trace-pagination').innerHTML = '';
        return;
    }

    traceAll = list;
    traceMode = 'simple';
    tracePage = 1;
    renderTraceTable();
}

async function searchTrace() {
    var traceId = document.getElementById('traceIdInput').value.trim();
    console.log('[trace] searching:', traceId);
    if (!traceId) return;
    showTraceDetail(traceId);
}

async function showTraceDetail(traceId) {
    var container = document.getElementById('trace-result');
    container.innerHTML = '<div class="empty-state">Loading...</div>';
    document.getElementById('trace-table').style.display = 'none';
    container.style.display = 'block';

    var result = await fetchTrace(traceId);
    if (!result || !result.tree) {
        console.warn('[trace] not found:', traceId);
        container.innerHTML = '<div class="empty-state">Trace not found.</div>';
        return;
    }

    var allSpans = [];
    function collect(node) { if (node.duration_ms !== undefined || node.virtual) allSpans.push(node); for (var c = 0; c < (node.children || []).length; c++) collect(node.children[c]); }
    collect(result.tree);
    if (!allSpans.length) { container.innerHTML = '<div class="empty-state">No spans in tree.</div>'; return; }

    var minTs = allSpans[0].ts_us || 0;
    var maxDuration = Math.max.apply(null, allSpans.map(function(s) { return s.duration_ms || 0; }));
    if (maxDuration < 1) maxDuration = 1;
    var maxEndTs = minTs;
    allSpans.forEach(function(s) {
        var end = (s.ts_us || 0) + (s.duration_ms || 0) * 1000;
        if (end > maxEndTs) maxEndTs = end;
    });
    var totalRange = (maxEndTs - minTs) / 1000;
    var refMs = Math.pow(10, Math.floor(Math.log10(maxDuration || 1)));

    var html = '<div style="background:var(--card-bg);border-radius:8px;padding:24px;box-shadow:var(--shadow);border:1px solid var(--card-border);margin-bottom:12px">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">';
    html += '<button class="btn btn-primary" onclick="showTraceTable()">Back to List</button>';
    html += '<span style="font-size:14px;font-weight:600;color:var(--text)">Trace ID: ' + traceId + '</span>';
    html += '</div>';
    html += '<div class="table-wrap"><table class="table"><thead><tr><th>Service</th><th>Stage</th><th class="text-end">Duration</th><th>Waterfall</th><th>Status</th></tr></thead><tbody>';
    function render(node, depth) {
        if (!node || (node.duration_ms === undefined && !node.virtual && !(node.children && node.children.length))) return;
        var indent = depth * 20;
        var offset = node.ts_us ? ((node.ts_us - minTs) / 1000) : 0;
        var dur = node.duration_ms || 0;
        var barScale = 600 / totalRange;
        var barOffset = offset * barScale;
        var barWidth = Math.max(dur * barScale, 3);
        html += '<tr><td style="padding-left:' + (indent + 12) + 'px"><span class="svc-dot" style="background:' + svcColor(node.service) + '"></span>' + (node.service || '') + '</td>' +
            '<td class="text-secondary">' + (node.stage || '') + '</td>' +
            '<td class="text-end fw-medium">' + dur.toFixed(2) + ' ms</td>' +
            '<td><div class="waterfall-bar" style="margin-left:' + barOffset + 'px"><div style="background:' + svcColor(node.service) + ';height:20px;width:' + barWidth + 'px;border-radius:3px;opacity:' + (node.virtual ? 0.4 : 0.85) + '"></div></div></td>' +
            '<td>' + statusBadge(node.status) + (node.virtual ? '<span class="badge badge-gray">virtual</span>' : '') + '</td></tr>';
        for (var c = 0; c < (node.children || []).length; c++) render(node.children[c], depth + 1);
    }
    render(result.tree, 0);
    html += '</tbody></table></div>';

    var totalMs = totalRange.toFixed(1);
    console.log('[trace] found:', allSpans.length, 'spans,', totalMs, 'ms total');
    html += '<div class="trace-summary">' + allSpans.length + ' spans &middot; ' + totalMs + ' ms total &middot; reference bar = ' + refMs + ' ms</div>';
    var refWidth = refMs * (600 / totalRange);
    html += '<div class="waterfall-ref"><div style="background:rgba(32,107,196,0.18);height:20px;width:' + Math.min(refWidth, 600) + 'px;border-radius:3px;border:1px dashed rgba(32,107,196,0.3)"></div><span class="text-secondary" style="font-size:10px;margin-left:4px">' + refMs + ' ms</span></div>';
    html += '</div>';

    container.innerHTML = html;
}

function showTraceTable() {
    document.getElementById('trace-result').style.display = 'none';
    document.getElementById('trace-table').style.display = 'block';
    if (traceAll.length) renderTraceTable();
}

loadTraceList();
