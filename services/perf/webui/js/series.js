async function loadSeries() {
    console.log('[series] loading...');
    const list = await fetchSeriesList();
    console.log('[series] loaded:', list.length, 'series');
    const container = document.getElementById('series-list');
    const btn = document.getElementById('new-series-btn');
    const hint = document.getElementById('series-hint');

    // Active mutual exclusion: can only create new when no active exists
    const hasActive = list.some(s => s.status === 'active');
    if (btn) {
        btn.disabled = hasActive;
        btn.title = hasActive ? 'Stop the active series first' : '';
    }
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
    document.getElementById('series-detail').style.display = 'block';
    document.getElementById('series-detail-title').textContent = 'Series: ' + name;

    const list = await fetchSeriesList();
    const info = list.find(s => s.id == id);
    const container = document.getElementById('series-stats');
    if (info) {
        const badgeClass = info.status === 'active' ? 'badge badge-green' : 'badge badge-gray';
        container.innerHTML = `
            <div class="stat-card" style="border-left-color:#206bc4">
                <div class="stat-body">
                    <div class="stat-label">Status</div>
                    <div class="stat-value"><span class="${badgeClass}">${info.status}</span></div>
                </div>
            </div>
            <div class="stat-card" style="border-left-color:#4299e1">
                <div class="stat-body">
                    <div class="stat-label">Span Count</div>
                    <div class="stat-value">${info.span_count || 0}</div>
                    <div class="stat-unit">spans</div>
                </div>
            </div>`;
    }
}

function showToast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
}

loadSeries();
