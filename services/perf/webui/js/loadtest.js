let loadTestRunning = false;
let loadTestSeriesId = null;
let loadTestSeriesName = '';

let ltAllResults = [];
let ltShownCount = 10;
let ltAllStats = null;

function generatePayload(size, unit) {
    const multipliers = { B: 1, KB: 1024, MB: 1024 * 1024 };
    const bytes = size * (multipliers[unit] || 1);
    if (bytes > 10 * 1024 * 1024) {
        if (!confirm('Payload is ' + (bytes / (1024 * 1024)).toFixed(1) + ' MB. Continue?')) return null;
    }
    return '0'.repeat(bytes);
}

function randUserId() {
    return Math.floor(Math.random() * 900000) + 100000;
}

async function sendSingle(userId, payload) {
    const start = performance.now();
    try {
        const resp = await fetch('/Proxy/Recommend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, payload: payload }),
        });
        const data = await resp.json();
        const ms = (performance.now() - start).toFixed(2);
        return { user_id: userId, duration_ms: parseFloat(ms), status: 'ok', error_code: data.error_code || 0, candidates: (data.candidates || []).length };
    } catch (e) {
        const ms = (performance.now() - start).toFixed(2);
        return { user_id: userId, duration_ms: parseFloat(ms), status: 'error', error_code: -1, error_msg: e.message, candidates: 0 };
    }
}

function getUserIds(idMode, userInput, mode, count) {
    if (idMode === 'random') {
        if (mode === 'single') return [randUserId()];
        return Array.from({ length: count }, function () { return randUserId(); });
    }
    // input mode
    var raw = userInput.split(',').map(function (s) { return parseInt(s.trim()); }).filter(function (n) { return !isNaN(n); });
    if (raw.length === 0) return getUserIds('random', '', mode, count);
    if (mode === 'single') return [raw[0]];
    return Array.from({ length: count }, function (_, i) { return raw[i % raw.length]; });
}

function calcStats(results) {
    const ok = results.filter(function (r) { return r.status === 'ok'; });
    if (!ok.length) return { avg: 0, min: 0, max: 0, p50: 0, p99: 0, stddev: 0, ok: 0, errors: results.length, total: results.length };
    const durs = ok.map(function (r) { return r.duration_ms; }).sort(function (a, b) { return a - b; });
    const sum = durs.reduce(function (a, b) { return a + b; }, 0);
    const avg = sum / durs.length;
    const min = durs[0];
    const max = durs[durs.length - 1];
    const p50 = durs[Math.floor(durs.length * 0.5)];
    const p99 = durs[Math.floor(durs.length * 0.99)];
    const variance = durs.reduce(function (s, d) { return s + (d - avg) * (d - avg); }, 0) / durs.length;
    const stddev = Math.sqrt(variance);
    return { avg: avg, min: min, max: max, p50: p50, p99: p99, stddev: stddev, ok: ok.length, errors: results.length - ok.length, total: results.length };
}

function renderResultsTable() {
    var shown = ltAllResults.slice(0, ltShownCount);
    var hasMore = ltShownCount < ltAllResults.length;
    var html = '<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>User ID</th><th class="text-end">Duration</th><th>Status</th></tr></thead><tbody>';
    shown.forEach(function (r, i) {
        var statusBadge = r.status === 'ok'
            ? '<span class="badge badge-green">' + r.candidates + ' items</span>'
            : '<span class="badge badge-red">' + (r.error_msg || 'error') + '</span>';
        html += '<tr><td class="text-secondary">' + (i + 1) + '</td><td>' + r.user_id + '</td><td class="text-end fw-medium">' + r.duration_ms.toFixed(2) + ' ms</td><td>' + statusBadge + '</td></tr>';
    });
    html += '</tbody></table></div>';
    if (hasMore) {
        html += '<div style="text-align:center;margin-top:8px"><button class="btn btn-ghost" onclick="loadMoreResults()">Load More (' + ltShownCount + ' / ' + ltAllResults.length + ')</button></div>';
    }
    return html;
}

function loadMoreResults() {
    ltShownCount = Math.min(ltShownCount + 10, ltAllResults.length);
    document.getElementById('lt-results-table').innerHTML = renderResultsTable();
}

function renderResults(results, stats) {
    ltAllResults = results;
    ltAllStats = stats;
    ltShownCount = 10;

    var html = '<div id="lt-metrics"></div>';
    html += '<div id="lt-results-table">' + renderResultsTable() + '</div>';
    document.getElementById('lt-results').innerHTML = html;

    renderMetricsGraph('lt-metrics', { count: stats.total, success: stats.ok, fail: stats.errors, avg: stats.avg, p50: stats.p50, p99: stats.p99, min: stats.min, max: stats.max, stddev: stats.stddev }, { chartId: 'lt-chart', chartHeight: 240, countLabel: 'Total', showSuccessFail: true, title: 'Latency Distribution' });
}

async function runLoadTest() {
    if (loadTestRunning) return;
    loadTestRunning = true;

    var mode = document.getElementById('lt-mode').value;
    var count = parseInt(document.getElementById('lt-count').value) || 1;
    var payloadSize = parseInt(document.getElementById('lt-payload-size').value) || 0;
    var payloadUnit = document.getElementById('lt-payload-unit').value;
    var idMode = document.getElementById('lt-id-mode').value;
    var userInput = document.getElementById('lt-user-id').value;
    var useSeries = document.getElementById('lt-use-series').checked;
    var seriesName = document.getElementById('lt-series-name').value.trim();
    var resultsContainer = document.getElementById('lt-results');
    var progressBar = document.getElementById('lt-progress-bar');
    var progressText = document.getElementById('lt-progress-text');

    var payload = generatePayload(payloadSize, payloadUnit);
    if (payload === null) { loadTestRunning = false; return; }

    if (mode === 'single') count = 1;

    console.log('[loadtest] starting:', mode, count, 'requests, payload:', payloadSize, payloadUnit);
    var uids = getUserIds(idMode, userInput, mode, count);
    var results = [];
    resultsContainer.innerHTML = '';

    // Series lifecycle: stop active → start new
    if (useSeries) {
        var list = await fetchSeriesList();
        var active = list.find(function (s) { return s.status === 'active'; });
        if (active) {
            console.log('[loadtest] stopping active series:', active.id);
            await stopSeriesReq();
        }
        var name = seriesName || 'loadtest-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        var sr = await startSeriesReq(name);
        if (sr.id) {
            loadTestSeriesId = sr.id;
            loadTestSeriesName = name;
            console.log('[loadtest] series started:', sr.id, name);
        }
    }

    document.getElementById('lt-send-btn').disabled = true;
    progressBar.style.display = 'block';
    progressText.style.display = 'block';

    try {
        if (mode === 'single') {
            var r = await sendSingle(uids[0], payload);
            results.push(r);
        } else if (mode === 'sequential') {
            for (var i = 0; i < count; i++) {
                var r = await sendSingle(uids[i], payload);
                results.push(r);
                var pct = (i + 1) / count * 100;
                document.getElementById('lt-progress-bar').querySelector('.progress-fill').style.width = pct + '%';
                progressText.textContent = (i + 1) + ' / ' + count;
            }
        } else if (mode === 'concurrent') {
            progressText.textContent = 'Sending ' + count + ' concurrent requests...';
            var promises = [];
            for (var i = 0; i < count; i++) {
                promises.push(sendSingle(uids[i], payload));
            }
            var settled = await Promise.allSettled(promises);
            for (var i = 0; i < settled.length; i++) {
                var s = settled[i];
                var r = s.status === 'fulfilled' ? s.value : { user_id: 0, duration_ms: 0, status: 'error', error_code: -1, error_msg: 'rejected', candidates: 0 };
                results.push(r);
            }
            document.getElementById('lt-progress-bar').querySelector('.progress-fill').style.width = '100%';
            progressText.textContent = count + ' / ' + count;
        }
    } catch (e) {
        resultsContainer.innerHTML += '<p style="color: var(--red)">Fatal error: ' + e.message + '</p>';
    }

    if (useSeries && loadTestSeriesId) {
        await stopSeriesReq();
        console.log('[loadtest] series stopped:', loadTestSeriesId);
        loadTestSeriesId = null;
    }

    document.getElementById('lt-send-btn').disabled = false;
    loadTestRunning = false;

    var stats = calcStats(results);
    console.log('[loadtest] done:', results.length, 'requests, avg:', stats.avg.toFixed(2), 'ms');
    renderResults(results, stats);
}

(function () {
    var modeSelect = document.getElementById('lt-mode');
    var countGroup = document.getElementById('lt-count-group');
    var userIdInput = document.getElementById('lt-user-id');
    var idModeSelect = document.getElementById('lt-id-mode');
    var userIdGroup = document.getElementById('lt-user-id-group');
    var useSeriesCb = document.getElementById('lt-use-series');
    var seriesNameGroup = document.getElementById('lt-series-name-group');
    var seriesNameInput = document.getElementById('lt-series-name');

    function applyModeUI() {
        var mode = modeSelect.value;
        countGroup.style.display = mode === 'single' ? 'none' : '';
        if (mode === 'single') {
            userIdInput.type = 'number';
            userIdInput.placeholder = 'e.g. 1000';
        } else {
            userIdInput.type = 'text';
            userIdInput.placeholder = 'e.g. 1000,1001,1002 (loops if < count)';
        }
    }

    function applyIdModeUI() {
        userIdGroup.style.display = idModeSelect.value === 'input' ? '' : 'none';
    }

    function applySeriesUI() {
        seriesNameGroup.style.display = useSeriesCb.checked ? '' : 'none';
    }

    modeSelect.addEventListener('change', applyModeUI);
    idModeSelect.addEventListener('change', applyIdModeUI);
    if (useSeriesCb) useSeriesCb.addEventListener('change', applySeriesUI);

    // Init defaults
    seriesNameInput.value = 'loadtest-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    applyModeUI();
    applyIdModeUI();
    applySeriesUI();
})();
