# syntax=docker/dockerfile:1

# 1. Web client
FROM node:24-alpine AS web
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app/ ./
RUN npm run build

# 2. Server with the web client embedded
FROM golang:1.26-alpine AS server
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN rm -rf web && mkdir web
COPY --from=web /app/dist ./web
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/buh-server . \
 && mkdir -p /out/data

# 3. Minimal runtime: one static binary, no shell
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /out/buh-server /buh-server
COPY --from=server --chown=65532:65532 /out/data /data
ENV BUH_ADDR=:8080 \
    BUH_DB=/data/buh.db \
    GOMEMLIMIT=40MiB
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s CMD ["/buh-server", "healthcheck"]
ENTRYPOINT ["/buh-server"]
