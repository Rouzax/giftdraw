# Alpine 3.24. Pinned by digest so a rebuild uses the
# same base; bump it deliberately.
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914

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
# The icons' license has to travel with every copy of them.
COPY THIRD_PARTY_NOTICES.md ./

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
