FROM node:22.23.5-alpine3.23

# Provenance. A published image must be traceable to a commit; pass these at
# build time (docs/PACKAGING.md shows the command). Defaults say "unknown"
# instead of pretending.
ARG GIT_REVISION=unknown
ARG TOWNMOUSE_VERSION=dev
LABEL org.opencontainers.image.title="Townmouse" \
      org.opencontainers.image.description="Local terminal and agent browser workspace" \
      org.opencontainers.image.source="https://github.com/CaptainPhantasy/townmouse" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${TOWNMOUSE_VERSION}" \
      org.opencontainers.image.revision="${GIT_REVISION}"

ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    TERMINALONE_CHROME=/usr/bin/chromium \
    TOWNMOUSE_CHROMIUM_NO_SANDBOX=1 \
    HOST=0.0.0.0 \
    NODE_ENV=production \
    PORT=11002

RUN apk add --no-cache \
       ca-certificates chromium python3 make g++ linux-headers

WORKDIR /app
COPY package.json package-lock.json npm-shrinkwrap.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY assets ./assets
COPY docs/panes.md docs/browser-workspace.md docs/PACKAGING.md ./docs/
COPY bin ./bin
COPY README.md TOWNMOUSE.md DESIGN.md LICENSE SECURITY.md CHANGELOG.md ./
RUN chmod +x scripts/panes bin/townmouse \
  && mkdir -p /home/node/.townmouse /home/node/.config/terminalone \
  && chown -R node:node /home/node/.townmouse /home/node/.config/terminalone \
  && chmod 700 /home/node/.townmouse /home/node/.config/terminalone

USER node
EXPOSE 11002
VOLUME ["/home/node/.townmouse", "/home/node/.config/terminalone"]
# curl is not in the base image; Node's fetch answers the same question.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:11002/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/server.js"]
