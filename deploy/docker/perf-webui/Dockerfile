FROM nginx:alpine
COPY services/perf/webui/index.html /usr/share/nginx/html/
COPY services/perf/webui/js/ /usr/share/nginx/html/js/
COPY deploy/docker/perf-webui/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 32000
