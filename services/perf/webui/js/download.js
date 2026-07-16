function onDownloadFilterChange() {
    const v = document.getElementById('dl-filter').value;
    document.getElementById('dl-trace-input').style.display = v === 'trace' ? '' : 'none';
    document.getElementById('dl-series-input').style.display = v === 'series' ? '' : 'none';
}

async function downloadPerf() {
    const format = document.getElementById('dl-format').value;
    const limit = document.getElementById('dl-limit').value || 10000;
    const filter = document.getElementById('dl-filter').value;
    let url = '/api/v1/download?format=' + format + '&limit=' + limit;
    if (filter === 'trace') url += '&trace_id=' + document.getElementById('dl-trace-id').value;
    if (filter === 'series') url += '&series_id=' + document.getElementById('dl-series-id').value;

    try {
        const resp = await fetch(url);
        if (!resp.ok) { showToast('Download failed: ' + resp.status, 'error'); return; }
        const blob = await resp.blob();
        const disp = resp.headers.get('Content-Disposition') || '';
        const fname = (disp.match(/filename="(.+)"/) || ['', 'perf-export'])[1];
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
        showToast('Download complete', 'success');
    } catch (e) {
        showToast('Download failed: ' + e.message, 'error');
    }
}
