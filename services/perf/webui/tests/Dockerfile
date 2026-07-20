FROM mcr.microsoft.com/playwright:v1.61.1-jammy
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY perf-webui.spec.js playwright.config.js ./
CMD ["npx", "playwright", "test", "--reporter=list"]
