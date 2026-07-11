const API_BASE = '';

async function fetchStats(service, stage) {
    const url = `${API_BASE}/api/v1/stats/current?service=${encodeURIComponent(service)}&stage=${encodeURIComponent(stage)}`;
    try {
        const resp = await fetch(url);
        if (!resp.ok) return { error: `HTTP ${resp.status}` };
        return await resp.json();
    } catch (e) {
        return { error: e.message };
    }
}

async function fetchSeriesList() {
    try {
        const resp = await fetch(`${API_BASE}/api/v1/series`);
        if (!resp.ok) return [];
        const data = await resp.json();
        return data.series || [];
    } catch (e) {
        return [];
    }
}

async function startSeriesReq(name) {
    try {
        const resp = await fetch(`${API_BASE}/api/v1/series/start?name=${encodeURIComponent(name)}`, { method: 'POST' });
        return await resp.json();
    } catch (e) {
        return { error: e.message };
    }
}

async function stopSeriesReq() {
    try {
        const resp = await fetch(`${API_BASE}/api/v1/series/stop`, { method: 'POST' });
        return await resp.json();
    } catch (e) {
        return { error: e.message };
    }
}

async function fetchTrace(traceId) {
    const url = `${API_BASE}/api/v1/trace/${encodeURIComponent(traceId)}`;
    try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        return await resp.json();
    } catch (e) {
        return null;
    }
}

async function fetchOutliers(service, stage) {
    const url = `${API_BASE}/api/v1/outliers?service=${encodeURIComponent(service)}&stage=${encodeURIComponent(stage)}`;
    try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        return await resp.json();
    } catch (e) {
        return null;
    }
}
