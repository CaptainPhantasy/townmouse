FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    TERMINALONE_CHROME=/usr/bin/chromium \
    TOWNMOUSE_CHROMIUM_NO_SANDBOX=1 \
    HOST=0.0.0.0 \
    NODE_ENV=production \
    PORT=11001

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates chromium python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

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
  && chown -R node:node /home/node/.townmouse /home/node/.config/terminalone

USER node
EXPOSE 11001
VOLUME ["/home/node/.townmouse", "/home/node/.config/terminalone"]
CMD ["node", "src/server.js"]
