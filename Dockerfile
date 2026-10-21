# Alpine 3.24. Pinned by digest so a rebuild uses the
# same base; bump it deliberately.
FROM node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

# tini runs as PID 1 so SIGTERM from docker stop reaches Node and the app can
# finish its shutdown instead of being killed after the stop timeout.
# Version from the Alpine 3.24 repository of the pinned base; bump with it.
RUN apk add --no-cache tini=0.19.0-r3

WORKDIR /app

# .npmrc sets ignore-scripts, so no dependency runs code at install time.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/giftdraw.db \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

USER node
VOLUME /data
EXPOSE 3000

# busybox wget, since the alpine image has no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
