# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24-alpine AS web-builder
WORKDIR /web
COPY synctv-web/package.json synctv-web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY synctv-web/ ./
ENV VITE_BASEURL=/web/
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS server-builder
WORKDIR /src
COPY go.mod go.sum ./
COPY vendors/ ./vendors/
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . ./
COPY --from=web-builder /web/dist/ ./public/dist/
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=v0.9.15-enhanced.17
ARG GIT_COMMIT=unknown
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH GOMAXPROCS=4 \
    go build -p 4 -trimpath -ldflags="-s -w -X github.com/synctv-org/synctv/internal/version.Version=$VERSION -X github.com/synctv-org/synctv/internal/version.GitCommit=$GIT_COMMIT" -o /synctv .

FROM alpine:3.23 AS core
RUN apk add --no-cache bash ca-certificates su-exec tzdata && mkdir -p /root/.synctv
COPY --from=server-builder /synctv /usr/local/bin/synctv
COPY --chmod=755 script/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh
ENV PUID=0 PGID=0 UMASK=022 TZ=Asia/Shanghai
WORKDIR /root/.synctv
VOLUME ["/root/.synctv"]
EXPOSE 8080/tcp 8080/udp
ENTRYPOINT ["/entrypoint.sh"]
CMD ["server"]

FROM node:24-alpine AS gateway
RUN apk add --no-cache ffmpeg tzdata
WORKDIR /app
COPY subtitle-gateway/server.mjs subtitle-gateway/media.mjs subtitle-gateway/video-info.mjs ./
COPY --from=web-builder /web/dist/ ./web/
ENV NODE_ENV=production PORT=8080 SYNCTV_UPSTREAM=http://synctv:8080 CACHE_DIR=/cache TZ=Asia/Shanghai
VOLUME ["/cache"]
EXPOSE 8080/tcp
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -q -O /dev/null http://127.0.0.1:8080/_synctv/health || exit 1
CMD ["node", "server.mjs"]
