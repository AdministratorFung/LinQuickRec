var seriesAll = [];
var seriesMode = 'simple';
var seriesPage = 1;
var seriesPageSize = 100;
var SHOW_INITIAL = 10;

function renderSeriesRow(s) {
    var badgeClass = s.status === 'active' ? 'badge badge-green' : 'badge badge-gray';
    return '<tr class="clickable" onclick="viewSeries(' + s.id + ',\'' + s.name + '\')">' +
        '<td class="text-secondary">#' + s.id + '</td>' +
        '<td class="fw-medium">' + s.name + '</td>' +
        '<td><span class="' + badgeClass + '">' + s.status + '</span></td>' +
        '<td>' + (s.span_count || 0) + '</td>' +
        '</tr>';
}

function renderSeriesTable() {
    var tbody = document.getElementById('series-tbody');
    var controls = document.getElementById('series-pagination');

    if (seriesAll.length <= SHOW_INITIAL) {
        tbody.innerHTML = seriesAll.map(renderSeriesRow).join('');
        controls.innerHTML = '';
    } else if (seriesMode === 'simple') {
        tbody.innerHTML = seriesAll.slice(0, SHOW_INITIAL).map(renderSeriesRow).join('');
        controls.innerHTML = '<button class="btn btn-ghost" onclick="showMoreSeries()">Load More (' + SHOW_INITIAL + ' / ' + seriesAll.length + ')</button>';
    } else {
        var start = (seriesPage - 1) * seriesPageSize;
        var end = Math.min(start + seriesPageSize, seriesAll.length);
        tbody.innerHTML = seriesAll.slice(start, end).map(renderSeriesRow).join('');
        var totalPages = Math.ceil(seriesAll.length / seriesPageSize);
        var html = renderPageNav(seriesPage, totalPages, 'goSeriesPage');
        html += renderPageSizeSelector(seriesPageSize, 'changeSeriesPageSize');
        html += '<span style="font-size:12px;color:var(--text-secondary);margin-left:8px">' + (start + 1) + '-' + end + ' of ' + seriesAll.length + '</span>';
        controls.innerHTML = html;
    }
}

function showMoreSeries() {
    seriesMode = 'paginated';
    seriesPage = 1;
    renderSeriesTable();
}

function goSeriesPage(p) {
    seriesPage = p;
    renderSeriesTable();
}

function changeSeriesPageSize(size) {
    seriesPageSize = parseInt(size);
    seriesPage = 1;
    renderSeriesTable();
}

async function loadSeries() {
    document.getElementById('series-list').style.display = '';
    document.getElementById('series-hint').style.display = '';
    document.getElementById('series-detail').style.display = 'none';
    console.log('[series] loading...');
    var list = await fetchSeriesList();
    console.log('[series] loaded:', list.length, 'series');
    var hint = document.getElementById('series-hint');

    var hasActive = list.some(function(s) { return s.status === 'active'; });
    if (hint) {
        hint.textContent = hasActive
            ? 'A series is currently active. Stop it before creating a new one.'
            : 'Create a new series to start recording spans.';
        hint.className = 'series-hint' + (hasActive ? ' hint-active' : '');
    }

    seriesAll = list;
    seriesMode = 'simple';
    seriesPage = 1;

    if (!list.length) {
        document.getElementById('series-tbody').innerHTML = '';
        document.getElementById('series-pagination').innerHTML = '';
        document.getElementById('series-list').style.display = 'none';
        document.getElementById('series-empty').style.display = '';
        return;
    }
    document.getElementById('series-list').style.display = '';
    document.getElementById('series-empty').style.display = 'none';
    renderSeriesTable();
}

async function startSeries() {
    var list = await fetchSeriesList();
    if (list.some(function(s) { return s.status === 'active'; })) {
        showToast('A series is currently active. Stop it before creating a new one.', 'error');
        return;
    }
    var name = prompt('Series name:', 'baseline-' + new Date().toISOString().slice(0, 19));
    if (!name) return;
    console.log('[series] starting:', name);
    var result = await startSeriesReq(name);
    if (result.error) {
        showToast('Failed to start series: ' + result.error, 'error');
        return;
    }
    showToast('Series "' + name + '" started', 'success');
    loadSeries();
}

async function stopSeries() {
    console.log('[series] stopping active series');
    var result = await stopSeriesReq();
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

    var list = await fetchSeriesList();
    var info = list.find(function(s) { return s.id == id; });
    if (!info) return;

    var hasActive = list.some(function(s) { return s.status === 'active'; });
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
    var result = await reactivateSeriesReq(id);
    if (result.error) {
        showToast('Failed to activate series: ' + result.error, 'error');
        return;
    }
    showToast('Series activated', 'success');
    loadSeries();
}

function showToast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 2500);
}

loadSeries();
