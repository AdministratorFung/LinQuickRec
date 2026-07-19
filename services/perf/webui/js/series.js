async function loadSeries() {
    document.getElementById('series-list').style.display = '';
    document.getElementById('series-hint').style.display = '';
    document.getElementById('series-detail').style.display = 'none';
    console.log('[series] loading...');
    const list = await fetchSeriesList();
    console.log('[series] loaded:', list.length, 'series');
    const container = document.getElementById('series-list');
    const hint = document.getElementById('series-hint');

    // Active mutual exclusion: can only create new when no active exists
    const hasActive = list.some(s => s.status === 'active');
    if (hint) {
        hint.textContent = hasActive
            ? 'A series is currently active. Stop it before creating a new one.'
            : 'Create a new series to start recording spans.';
        hint.className = 'series-hint' + (hasActive ? ' hint-active' : '');
    }

    if (!list.length) {
        container.innerHTML = '<div class="empty-state">No series yet. Click <strong>+ New Series</strong> to start.</div>';
        return;
    }

    let html = '<div class="table-wrap"><table class="table"><thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Span Count</th></tr></thead><tbody>';
    for (const s of list) {
        const badgeClass = s.status === 'active' ? 'badge badge-green' : 'badge badge-gray';
        html += `<tr class="clickable" onclick="viewSeries(${s.id},'${s.name}')">
            <td class="text-secondary">#${s.id}</td>
            <td class="fw-medium">${s.name}</td>
            <td><span class="${badgeClass}">${s.status}</span></td>
            <td>${s.span_count || 0}</td>
        </tr>`;
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;
}

async function startSeries() {
    const list = await fetchSeriesList();
    if (list.some(s => s.status === 'active')) {
        showToast('A series is currently active. Stop it before creating a new one.', 'error');
        return;
    }
    const name = prompt('Series name:', 'baseline-' + new Date().toISOString().slice(0, 19));
    if (!name) return;
    console.log('[series] starting:', name);
    const result = await startSeriesReq(name);
    if (result.error) {
        showToast('Failed to start series: ' + result.error, 'error');
        return;
    }
    showToast('Series "' + name + '" started', 'success');
    loadSeries();
}

async function stopSeries() {
    console.log('[series] stopping active series');
    const result = await stopSeriesReq();
    if (result.error) {
        showToast('Failed to stop series', 'error');
        return;
    }
    showToast('Series stopped', 'success');
    loadSeries();
}

async function viewSeries(id, name) {
    document.getElementById('series-list').style.display = 'none';
    document.getElementById('series-hint').style.display = 'none';
    document.getElementById('series-detail').style.display = 'block';

    const list = await fetchSeriesList();
    const info = list.find(s => s.id == id);
    if (!info) return;

    const hasActive = list.some(s => s.status === 'active');
    document.getElementById('series-detail-title').textContent = 'Series: ' + name;
    var reactivateBtn = document.getElementById('series-activate-btn');
    if (info.status === 'stopped' && !hasActive) {
        reactivateBtn.style.display = '';
        reactivateBtn.setAttribute('onclick', 'activateSeries(' + id + ')');
    } else {
        reactivateBtn.style.display = 'none';
    }

    var container = document.getElementById('series-stats');
    var stats = await fetchSeriesStats(id);
    var mgStats = {
        count: info.span_count || 0,
        status: info.status,
        avg: 0, p50: 0, p99: 0, min: 0, max: 0, stddev: 0
    };
    if (stats) {
        mgStats.success = stats.success;
        mgStats.fail = stats.fail;
        mgStats.avg = stats.avg;
        mgStats.p50 = stats.p50;
        mgStats.p99 = stats.p99;
        mgStats.min = stats.min;
        mgStats.max = stats.max;
        mgStats.stddev = stats.stddev;
    }
    renderMetricsGraph('series-stats', mgStats, { chartId: 'series-chart', chartHeight: 200, countLabel: 'Span Count', showStatus: true, showSuccessFail: true, title: 'Latency Distribution' });
}

function backToSeriesList() {
    document.getElementById('series-detail').style.display = 'none';
    document.getElementById('series-list').style.display = '';
    document.getElementById('series-hint').style.display = '';
}

async function activateSeries(id) {
    console.log('[series] activating:', id);
    const result = await reactivateSeriesReq(id);
    if (result.error) {
        showToast('Failed to activate series: ' + result.error, 'error');
        return;
    }
    showToast('Series activated', 'success');
    loadSeries();
}

function showToast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
}

loadSeries();
