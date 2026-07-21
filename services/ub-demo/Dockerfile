FROM linquickrec/base-urma:latest

ARG PROTO_DIR=proto/
ARG DEMO_DIR=services/ub-demo/

WORKDIR /app

COPY ${PROTO_DIR} /app/proto/
COPY ${DEMO_DIR} /app/services/ub-demo/

RUN mkdir -p /app/build && cd /app/build && \
    cmake ../services/ub-demo \
        -DCMAKE_BUILD_TYPE=Release \
        -DENABLE_URMA=ON && \
    make -j$(nproc) ub_demo_server ub_demo_client

ENV LD_LIBRARY_PATH=/usr/local/lib:/usr/local/lib64:/usr/lib64:${LD_LIBRARY_PATH:-}

EXPOSE 8080

CMD ["/app/build/bin/ub_demo_server", "--enable_urma", "--port=8080"]
