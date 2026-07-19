// Perf tab — fixed proxy_e2e header + call tree with proportion bars + detail panel
let selectedSvc = null;
let selectedStg = null;
let treeStats = {}; // "service|stage" → {avg, p50, p99, min, max, count, stddev}

let callTree = null;

function treeKey(svc, stg) { return svc + '|' + stg; }
function treeStat(svc, stg) { return treeStats[treeKey(svc, stg)]; }

function pctColor(pct) {
    // Blue (#206bc4) → Red (#f56565) gradient by percentage
    const t = Math.min(Math.max(pct, 0), 100) / 100;
    const r = Math.round(32 + (245 - 32) * t);
    const g = Math.round(107 + (101 - 107) * t);
    const b = Math.round(196 + (101 - 196) * t);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
}

async function refreshTop() {
    const stats = await fetchStats('proxy', 'proxy_e2e');
    if (!stats || stats.error) {
        updateMetricsGraph('perf-top-metrics', { count: 0, avg: 0, p50: 0, p99: 0, min: 0, max: 0, stddev: 0 }, { chartId: 'perf-top-chart', chartHeight: 240, title: 'Latency Distribution' });
        return;
    }
    updateMetricsGraph('perf-top-metrics', stats, { chartId: 'perf-top-chart', chartHeight: 240, title: 'Latency Distribution' });
}

async function refreshDetail() {
    if (!selectedSvc || !selectedStg) return;
    const stats = await fetchStats(selectedSvc, selectedStg);
    if (!stats || stats.error) return;
    updateMetricsGraph('perf-detail-metrics', stats, { chartId: 'perf-detail-chart', chartHeight: 160, title: selectedSvc + ' / ' + selectedStg });
    updateTreeValues();
    highlightTree();
}

async function fetchAllTreeStats() {
    if (!callTree) return;
    function collect(nodes, list) {
        for (const n of nodes) {
            list.push({ service: n.service, stage: n.stage });
            if (n.children) collect(n.children, list);
        }
    }
    const all = [];
    collect(callTree, all);
    for (const n of all) {
        const stats = await fetchStats(n.service, n.stage);
        if (stats && !stats.error) treeStats[treeKey(n.service, n.stage)] = stats;
    }
}

function selectDetailNode(svc, stg) {
    selectedSvc = svc;
    selectedStg = stg;
    document.getElementById('perf-detail').style.display = 'block';
    document.getElementById('detail-stage-name').textContent = svc + ' / ' + stg;
    highlightTree();
    refreshDetail();
}

function highlightTree() {
    document.querySelectorAll('.tree-node-name').forEach(el => {
        el.classList.toggle('selected', el.dataset.service === selectedSvc && el.dataset.stage === selectedStg);
    });
}

function renderTree() {
    const container = document.getElementById('perf-tree');
    if (!container) return;
    if (!callTree || !callTree.length) {
        container.innerHTML = '<div class="empty-state">Failed to load tree structure. <button class="btn btn-ghost" onclick="refreshTreeStructure()">Retry</button></div>';
        return;
    }
    const rootStat = treeStat('proxy', 'proxy_e2e');
    const rootAvg = rootStat && rootStat.count > 0 ? rootStat.avg : 0;

    function buildHTML(nodes, depth, parentAvg) {
        let html = '';
        for (const n of nodes) {
            const stat = treeStat(n.service, n.stage);
            const hasData = stat && stat.count > 0;
            const count = stat ? stat.count : 0;
            const avg = hasData ? stat.avg : 0;
            const pct = parentAvg > 0 && avg > 0 ? Math.round(avg / parentAvg * 100) : 0;
            const color = pctColor(pct);
            const hasChildren = n.children && n.children.length > 0;
            const isSelected = selectedSvc && n.service === selectedSvc && n.stage === selectedStg;
            const isDefault = !selectedSvc && depth === 0;

            html += '<div class="tree-node" style="padding-left:' + (depth * 22) + 'px">';
            html += '<span class="tree-arrow' + (hasChildren ? (depth < 2 ? ' expanded' : '') : ' leaf') + '"' + (hasChildren ? ' onclick="toggleTree(this)"' : '') + '>' + (hasChildren ? '▶' : '') + '</span>';
            html += '<span class="tree-node-name' + ((isSelected || isDefault) ? ' selected' : '') + '" data-service="' + n.service + '" data-stage="' + n.stage + '" onclick="selectDetailNode(\'' + n.service + '\',\'' + n.stage + '\')">' + n.stage + '</span>';

            html += '<span class="tree-bar-wrap"><span class="tree-bar-fill" style="width:' + (hasData ? Math.min(pct, 100) : 0) + '%;background:' + (hasData ? color : 'transparent') + '"></span></span>';
            html += '<span class="tree-pct">' + (hasData ? pct + '%' : '') + '</span>';
            html += '<span class="tree-val' + (hasData ? '' : ' no-data') + '">' + (hasData ? avg.toFixed(1) + ' ms (' + count + ')' : '—') + '</span>';

            html += '</div>';

            if (hasChildren) {
                html += '<div class="tree-children' + (depth < 2 ? '' : ' hidden') + '">';
                html += buildHTML(n.children, depth + 1, hasData ? avg : parentAvg);
                html += '</div>';
            }
        }
        return html;
    }
    var btnHtml = ' <button class="btn btn-ghost" onclick="refreshTreeStructure()" style="font-size:11px;padding:1px 8px;margin-left:8px">Refresh Tree</button>';
    container.innerHTML = '<div class="tree-label">Call Tree' + btnHtml + '</div>' + buildHTML(callTree, 0, rootAvg);
}

function toggleTree(arrow) {
    arrow.classList.toggle('expanded');
    const sibling = arrow.parentElement.nextElementSibling;
    if (sibling && sibling.classList.contains('tree-children')) sibling.classList.toggle('hidden');
}

function updateTreeValues() {
    if (!callTree) return;
    const rootStat = treeStat('proxy', 'proxy_e2e');
    const rootAvg = rootStat && rootStat.count > 0 ? rootStat.avg : 0;

    function update(nodes, depth, parentAvg) {
        for (const n of nodes) {
            const nameEl = document.querySelector('.tree-node-name[data-service="' + n.service + '"][data-stage="' + n.stage + '"]');
            if (!nameEl) continue;
            const nodeDiv = nameEl.parentElement;
            const stat = treeStat(n.service, n.stage);
            const hasData = stat && stat.count > 0;
            const avg = hasData ? stat.avg : 0;
            const pct = parentAvg > 0 && avg > 0 ? Math.round(avg / parentAvg * 100) : 0;
            const color = pctColor(pct);

            const barFill = nodeDiv.querySelector('.tree-bar-fill');
            const pctEl = nodeDiv.querySelector('.tree-pct');
            const valEl = nodeDiv.querySelector('.tree-val');

            if (hasData) {
                if (barFill) { barFill.style.width = Math.min(pct, 100) + '%'; barFill.style.background = color; }
                if (pctEl) pctEl.textContent = pct + '%';
                if (valEl) { valEl.textContent = avg.toFixed(1) + ' ms (' + stat.count + ')'; valEl.classList.remove('no-data'); }
            } else {
                if (barFill) { barFill.style.width = '0%'; barFill.style.background = 'transparent'; }
                if (pctEl) pctEl.textContent = '';
                if (valEl) { valEl.textContent = '\u2014'; valEl.classList.add('no-data'); }
            }

            if (n.children) update(n.children, depth + 1, hasData ? avg : parentAvg);
        }
    }
    update(callTree, 0, rootAvg);
}

async function refreshData() {
    await fetchAllTreeStats();
    updateTreeValues();
    refreshTop();
    if (selectedSvc && selectedStg) {
        const st = treeStat(selectedSvc, selectedStg);
        if (st) updateMetricsGraph('perf-detail-metrics', st, { chartId: 'perf-detail-chart', chartHeight: 160, title: selectedSvc + ' / ' + selectedStg });
    }
}

async function refreshTreeStructure() {
    const fresh = await fetchTreeStructure();
    if (fresh && fresh.length) {
        callTree = fresh;
        await fetchAllTreeStats();
        renderTree();
    }
}

async function initPerf() {
    callTree = await fetchTreeStructure();
    if (!callTree || !callTree.length) {
        renderTree();
        return;
    }
    refreshTop();
    await fetchAllTreeStats();
    renderTree();
}

initPerf();
setInterval(refreshData, 1000);

document.documentElement.addEventListener('themechange', async () => {
    const stats = await fetchStats('proxy', 'proxy_e2e');
    if (stats && !stats.error) try { drawBarChart('perf-top-chart', {}, stats, 240); } catch (e) {}
    if (selectedSvc && selectedStg) {
        const dStats = await fetchStats(selectedSvc, selectedStg);
        if (dStats && !dStats.error) try { drawBarChart('perf-detail-chart', {}, dStats, 160); } catch (e) {}
    }
});
