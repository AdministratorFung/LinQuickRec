const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: '.',
    timeout: 30000,
    use: {
        baseURL: 'http://114.132.51.227:32000',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        actionTimeout: 10000,
        launchOptions: {
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
        },
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
    ],
});
