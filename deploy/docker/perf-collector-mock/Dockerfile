FROM python:3-slim

COPY deploy/docker/perf-collector-mock/mock_server.py /app/mock_server.py

EXPOSE 8080

CMD ["python3", "/app/mock_server.py"]
