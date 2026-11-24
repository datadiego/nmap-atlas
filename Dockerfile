FROM golang:1.26-bookworm AS gowitness
ARG GOWITNESS_COMMIT=601c84367aaf26eae7d1b5181b70633cb662cf66
RUN CGO_ENABLED=0 go install github.com/sensepost/gowitness@${GOWITNESS_COMMIT}

FROM debian:bookworm-slim AS ipcalc
ARG IPCALC_COMMIT=e364dbbcfaf604b039649e941a7603615e674d91
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       build-essential ca-certificates git meson ninja-build pkg-config \
    && git clone https://gitlab.com/ipcalc/ipcalc.git /src/ipcalc \
    && cd /src/ipcalc \
    && git fetch --depth 1 origin ${IPCALC_COMMIT} \
    && git checkout ${IPCALC_COMMIT} \
    && meson setup build -Duse_maxminddb=disabled -Duse_runtime_linking=disabled \
    && ninja -C build install

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    NMAP_ATLAS_DB_PATH=/app/data/nmap-atlas.sqlite \
    NMAP_ATLAS_NMAP_PRIVILEGED=1 \
    NMAP_ATLAS_GOWITNESS_COMMAND="/usr/local/bin/gowitness --chrome-path=/usr/bin/chromium"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates chromium fonts-liberation libcap2-bin nmap \
    && rm -rf /var/lib/apt/lists/* \
    && setcap cap_net_raw,cap_net_admin=eip "$(command -v nmap)"

COPY --from=gowitness /go/bin/gowitness /usr/local/bin/gowitness
COPY --from=ipcalc /usr/local/bin/ipcalc /usr/local/bin/ipcalc
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY db ./db
COPY server ./server
COPY bin ./bin
COPY package.json ./
RUN mkdir -p data && chown -R node:node /app

USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD node -e "fetch('http://127.0.0.1:4173/api/status').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "bin/nmap-atlas.mjs", "--host", "0.0.0.0", "--port", "4173"]
