let loadTestRunning = false;
let loadTestSeriesId = null;
let loadTestSeriesName = '';

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

function calcStats(results) {
    const ok = results.filter(r => r.status === 'ok');
    if (!ok.length) return { avg: 0, min: 0, max: 0, p50: 0, p99: 0, ok: 0, errors: results.length, total: results.length };
    const durs = ok.map(r => r.duration_ms).sort((a, b) => a - b);
    const sum = durs.reduce((a, b) => a + b, 0);
    const avg = sum / durs.length;
    const min = durs[0];
    const max = durs[durs.length - 1];
    const p50 = durs[Math.floor(durs.length * 0.5)];
    const p99 = durs[Math.floor(durs.length * 0.99)];
    return { avg, min, max, p50, p99, ok: ok.length, errors: results.length - ok.length, total: results.length };
}

function renderResults(results, stats) {
    let html = '';
    html += '<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>User ID</th><th class="text-end">Duration</th><th>Status</th></tr></thead><tbody>';
    results.forEach((r, i) => {
        const statusBadge = r.status === 'ok'
            ? '<span class="badge badge-green">' + (r.error_code || r.candidates + ' items') + '</span>'
            : '<span class="badge badge-red">' + (r.error_msg || 'error') + '</span>';
        html += '<tr><td class="text-secondary">' + (i + 1) + '</td><td>' + r.user_id + '</td><td class="text-end fw-medium">' + r.duration_ms.toFixed(2) + ' ms</td><td>' + statusBadge + '</td></tr>';
    });
    html += '</tbody></table></div>';

    html += '<div class="stats-summary">';
    html += '<div class="stat-card" style="border-left-color:#206bc4"><div class="stat-body"><div class="stat-label">Total</div><div class="stat-value">' + stats.total + '</div><div class="stat-unit">requests</div></div></div>';
    html += '<div class="stat-card" style="border-left-color:#48bb78"><div class="stat-body"><div class="stat-label">OK</div><div class="stat-value">' + stats.ok + '</div></div></div>';
    html += '<div class="stat-card" style="border-left-color:#f56565"><div class="stat-body"><div class="stat-label">Errors</div><div class="stat-value">' + stats.errors + '</div></div></div>';
    html += '<div class="stat-card" style="border-left-color:#4299e1"><div class="stat-body"><div class="stat-label">Avg</div><div class="stat-value">' + stats.avg.toFixed(2) + '</div><div class="stat-unit">ms</div></div></div>';
    html += '<div class="stat-card" style="border-left-color:#9f7aea"><div class="stat-body"><div class="stat-label">P50</div><div class="stat-value">' + stats.p50.toFixed(2) + '</div><div class="stat-unit">ms</div></div></div>';
    html += '<div class="stat-card" style="border-left-color:#ed8936"><div class="stat-body"><div class="stat-label">P99</div><div class="stat-value">' + stats.p99.toFixed(2) + '</div><div class="stat-unit">ms</div></div></div>';
    html += '<div class="stat-card" style="border-left-color:#48bb78"><div class="stat-body"><div class="stat-label">Min</div><div class="stat-value">' + stats.min.toFixed(2) + '</div><div class="stat-unit">ms</div></div></div>';
    html += '<div class="stat-card" style="border-left-color:#f56565"><div class="stat-body"><div class="stat-label">Max</div><div class="stat-value">' + stats.max.toFixed(2) + '</div><div class="stat-unit">ms</div></div></div>';
    html += '</div>';

    return html;
}

async function runLoadTest() {
    if (loadTestRunning) return;
    loadTestRunning = true;

    const userId = parseInt(document.getElementById('lt-user-id').value) || 0;
    const payloadSize = parseInt(document.getElementById('lt-payload-size').value) || 0;
    const payloadUnit = document.getElementById('lt-payload-unit').value;
    const mode = document.getElementById('lt-mode').value;
    const count = parseInt(document.getElementById('lt-count').value) || 1;
    const idMode = document.getElementById('lt-id-mode').value;
    const useSeries = document.getElementById('lt-use-series').checked;
    const resultsContainer = document.getElementById('lt-results');
    const progressBar = document.getElementById('lt-progress-bar');
    const progressText = document.getElementById('lt-progress-text');

    const payload = generatePayload(payloadSize, payloadUnit);
    if (payload === null) { loadTestRunning = false; return; }

    let uid = userId;
    const results = [];
    resultsContainer.innerHTML = '';

    // Auto series management
    if (useSeries) {
        const name = 'loadtest-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const sr = await startSeriesReq(name);
        if (sr.id) {
            loadTestSeriesId = sr.id;
            loadTestSeriesName = name;
        }
    }

    document.getElementById('lt-send-btn').disabled = true;
    progressBar.style.display = 'block';
    progressText.style.display = 'block';

    try {
        if (mode === 'single') {
            const r = await sendSingle(uid, payload);
            results.push(r);
        } else if (mode === 'sequential') {
            for (let i = 0; i < count; i++) {
                uid = idMode === 'random' ? randUserId() : userId + i;
                const r = await sendSingle(uid, payload);
                results.push(r);
                progressBar.style.width = ((i + 1) / count * 100) + '%';
                progressText.textContent = (i + 1) + ' / ' + count;
            }
        } else if (mode === 'concurrent') {
            const promises = [];
            for (let i = 0; i < count; i++) {
                uid = idMode === 'random' ? randUserId() : userId + i;
                promises.push(sendSingle(uid, payload));
            }
            const settled = await Promise.allSettled(promises);
            for (let i = 0; i < settled.length; i++) {
                const r = settled[i].status === 'fulfilled' ? settled[i].value : { user_id: 0, duration_ms: 0, status: 'error', error_code: -1, error_msg: 'rejected', candidates: 0 };
                results.push(r);
            }
            progressBar.style.width = '100%';
            progressText.textContent = count + ' / ' + count;
        }
    } catch (e) {
        resultsContainer.innerHTML += '<p style="color: var(--red)">Fatal error: ' + e.message + '</p>';
    }

    // Auto stop series
    if (useSeries && loadTestSeriesId) {
        await stopSeriesReq();
        loadTestSeriesId = null;
    }

    document.getElementById('lt-send-btn').disabled = false;
    loadTestRunning = false;

    const stats = calcStats(results);
    resultsContainer.innerHTML = renderResults(results, stats);
}

// Init: wire up mode <-> count field
(function () {
    const modeSelect = document.getElementById('lt-mode');
    const countGroup = document.getElementById('lt-count-group');
    if (modeSelect && countGroup) {
        modeSelect.addEventListener('change', function () {
            countGroup.style.display = this.value === 'single' ? 'none' : '';
        });
    }
})();
