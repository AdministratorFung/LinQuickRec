const { test, expect } = require('@playwright/test');

test.describe('LinQuickRec WebUI', () => {

    test('T01: tab persistence', async ({ page }) => {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(800);
        await expect(page.locator('#test-panel')).toBeVisible();
        await page.reload();
        await expect(page.locator('#test-panel')).toBeVisible();
    });

    test('T02: series detail view hides list', async ({ page }) => {
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1500);
        var rows = page.locator('#series-tbody tr.clickable');
        if (await rows.count() === 0) {
            await page.click('text=+ New Series');
            var dialog = await page.waitForEvent('dialog', { timeout: 3000 }).catch(function() { return null; });
            if (dialog) { await dialog.accept('test-series'); await page.waitForTimeout(800); }
        }
        await page.click('#series-tbody tr.clickable').catch(function() {});
        await page.waitForTimeout(800);
        await expect(page.locator('text=Back to List').first()).toBeVisible({ timeout: 3000 });
    });

    test('T03: series reactivate button', async ({ page }) => {
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1500);
        var activeEl = page.locator('.badge-green');
        var activeCount = await activeEl.count();
        if (activeCount > 0) {
            await page.click('text=Stop Active');
            await page.waitForTimeout(800);
        }
        var firstRow = page.locator('#series-tbody tr.clickable').first();
        var rowCount = await firstRow.count();
        if (rowCount > 0) {
            await firstRow.click();
            await page.waitForTimeout(800);
            await expect(page.locator('#series-activate-btn')).toBeVisible({ timeout: 3000 });
        }
    });

    test('T04: trace Back button position', async ({ page }) => {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var row = page.locator('#trace-list tr.clickable').first();
        if (await row.count() > 0) {
            await row.click();
            await page.waitForTimeout(800);
            await expect(page.locator('#trace-result .btn-primary')).toBeVisible({ timeout: 3000 });
        }
    });

    test('T05: trace sequential number', async ({ page }) => {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var firstRow = page.locator('#trace-list tr.clickable').first();
        if (await firstRow.count() > 0) {
            await expect(firstRow.locator('td').first()).toContainText('#1');
        }
    });

    test('T06: pagination all shown when <= 10', async ({ page }) => {
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1500);
        var loadMore = page.locator('#series-pagination button');
        var count = await loadMore.count();
        expect(count).toBe(0);
    });

    test('T07: pagination Load More and page nav', async ({ page }) => {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var loadMore = page.locator('text=Load More');
        if (await loadMore.isVisible()) {
            await loadMore.click();
            await page.waitForTimeout(500);
            await expect(page.locator('text=Per page')).toBeVisible({ timeout: 3000 });
        }
    });

    test('T08: trace search with Enter key', async ({ page }) => {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var td = page.locator('#trace-list tr.clickable td.fw-medium').first();
        var traceId = await td.textContent().catch(function() { return ''; });
        if (traceId) {
            await page.fill('#traceIdInput', traceId.trim());
            await page.press('#traceIdInput', 'Enter');
            await page.waitForTimeout(800);
            await expect(page.locator('#trace-result')).toBeVisible({ timeout: 3000 });
            await expect(page.locator('text=Trace ID:')).toBeVisible();
        }
    });

    test('T09: trace search back restores pagination', async ({ page }) => {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var td = page.locator('#trace-list tr.clickable td.fw-medium').first();
        var traceId = await td.textContent().catch(function() { return ''; });
        if (traceId) {
            await page.fill('#traceIdInput', traceId.trim());
            await page.press('#traceIdInput', 'Enter');
            await page.waitForTimeout(800);
            await page.click('#trace-result .btn-primary');
            await page.waitForTimeout(500);
            await expect(page.locator('#trace-pagination')).toBeVisible({ timeout: 3000 });
        }
    });

    test('T10: Test panel send request', async ({ page }) => {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(800);
        await page.selectOption('#lt-mode', 'single');
        await page.click('#lt-send-btn');
        await page.waitForTimeout(3000);
        var results = page.locator('#lt-results');
        await expect(results.locator('.stat-label:text-is("Total")')).toBeVisible({ timeout: 8000 });
        await expect(results.locator('.stat-label:text-is("Success")')).toBeVisible();
        await expect(results.locator('.stat-label:text-is("Fail")')).toBeVisible();
    });

    test('T11: Perf tree folded by default', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(3000);
        var rootExpanded = page.locator('.tree-arrow.expanded').first();
        await expect(rootExpanded).toBeVisible({ timeout: 8000 });
        var collapsed = page.locator('.tree-arrow:not(.expanded):not(.leaf)');
        var count = await collapsed.count();
        expect(count).toBeGreaterThan(0);
    });

    test('T12: Metrics component layout', async ({ page }) => {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(800);
        await page.selectOption('#lt-mode', 'single');
        await page.click('#lt-send-btn');
        await page.waitForTimeout(3000);
        var results = page.locator('#lt-results');
        var row1 = results.locator('.stats-summary').first();
        await expect(row1.locator('.stat-label:text-is("Total")')).toBeVisible({ timeout: 8000 });
        await expect(row1.locator('.stat-label:text-is("Success")')).toBeVisible();
        await expect(row1.locator('.stat-label:text-is("Fail")')).toBeVisible();
        var row2 = results.locator('.stats-summary').nth(1);
        await expect(row2.locator('.stat-label:text-is("Avg")')).toBeVisible();
        await expect(results.locator('#lt-chart')).toBeVisible();
    });

});
