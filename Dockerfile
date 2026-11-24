# Alpine 3.24. Pinned by digest; Dependabot proposes new digests and Node 22
# patch releases. A Node major moves CI's node-version with it, by hand.
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914

# apk upgrade takes Alpine fixes published after the base image was built, so
# the weekly rebuild in auto-release.yml ships them without a new digest.
# tini runs as PID 1 so SIGTERM from docker stop reaches Node and the app can
# finish its shutdown instead of being killed after the stop timeout.
# Version from the Alpine 3.24 repository of the pinned base; bump with it.
RUN apk upgrade --no-cache \
 && apk add --no-cache tini=0.19.0-r3

WORKDIR /app

# .npmrc sets ignore-scripts, so no dependency runs code at install time.
# The app runs on node alone, so the package managers the base image ships
# (npm, npx, corepack, yarn) go once the install is done; that also keeps
# the advisories filed against npm's bundled packages out of the image.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev \
 && rm -rf /root/.npm \
           /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg \
           /opt/yarn-v*

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
