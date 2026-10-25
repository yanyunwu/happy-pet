FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/happy-pet-api ./cmd/api

FROM debian:bookworm-slim
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl tzdata && \
    rm -rf /var/lib/apt/lists/* && groupadd --gid 10001 happy-pet && useradd --uid 10001 --gid 10001 --create-home happy-pet
COPY --from=build /out/ /usr/local/bin/
WORKDIR /app
ENV API_ADDR=0.0.0.0:8080 GIN_MODE=release TZ=Asia/Shanghai
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=5m --retries=6 \
    CMD curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8080/health > /dev/null || exit 1
CMD ["/usr/local/bin/happy-pet-api"]
