FROM openeuler/openeuler:24.03-sp3-lts

ARG BUILD_BIN_DIR=bazel-bin

COPY ${BUILD_BIN_DIR}/ub_demo_server /app/ub_demo_server
COPY ${BUILD_BIN_DIR}/ub_demo_client /app/ub_demo_client

RUN chmod +x /app/ub_demo_server /app/ub_demo_client

ENV LD_LIBRARY_PATH=/usr/local/lib:/usr/local/lib64:/usr/lib64

EXPOSE 8080

CMD ["/app/ub_demo_server", "--enable_urma", "--port=8080"]
