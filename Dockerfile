# One build, two images:
#
#   docker build --target web .         nginx: the static site, and the proxy
#                                       in front of the licensing service
#   docker build --target licensing .   Node: accounts, license issue and
#                                       management (/account, /admin,
#                                       /api/licensing, /api/audit)
#
# The web image works on its own; without a licensing service behind it the
# account pages show a "licensing unavailable" page. docker-compose.yml runs
# both.

# ---- Build -----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, so editing a page doesn't reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY astro.config.mjs tsconfig.json vitest.config.ts ./
COPY public/ public/
COPY src/ src/
COPY licensing/fixtures/ licensing/fixtures/

# Pricing and licensing are tested before anything is built from them.
RUN npm test && npm run build

# ---- Licensing service ------------------------------------------------------
FROM node:22-alpine AS licensing
WORKDIR /app
# Recorded in every audit event's "version"; e.g. --build-arg ENS_VERSION=$(git describe).
ARG ENS_VERSION=dev
ENV NODE_ENV=production \
    ENS_VERSION=${ENS_VERSION} \
    HOST=0.0.0.0 \
    PORT=4321 \
    DATA_DIR=/data \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

COPY package.json package-lock.json ./
# Optional dependencies are native build tools (image processing, the bundler);
# the built server never loads them.
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist/ dist/
COPY scripts/license.mjs scripts/license.mjs

# The database and (if none is passed in) the signing key live here.
RUN mkdir -p /data && chown node:node /data
# The audit file, if ENS_AUDIT_FILE is set (e.g. /var/log/ens/licensing-portal/audit.jsonl).
# Group 0 with rwx too, for OpenShift's arbitrary user ids.
RUN mkdir -p /var/log/ens/licensing-portal \
    && chown -R node:0 /var/log/ens \
    && chmod -R 2775 /var/log/ens
VOLUME /data
USER node

EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD wget -qO- http://127.0.0.1:4321/api/licensing/health || exit 1
CMD ["node", "dist/server/entry.mjs"]

# ---- Web -------------------------------------------------------------------
FROM nginx:1.27-alpine AS web

# The stock config listens on 80 and is replaced wholesale. The site's config
# is a template: the nginx entrypoint fills in ${LICENSING_UPSTREAM} and
# ${DNS_RESOLVER} at start (20-envsubst-on-templates.sh).
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

# Templates, not the served root. The entrypoint script renders these into
# /usr/share/nginx/html on every start.
COPY --from=build /app/dist/client/ /usr/share/nginx/template/

COPY docker/docker-entrypoint.d/30-render-site.sh /docker-entrypoint.d/30-render-site.sh
RUN chmod +x /docker-entrypoint.d/30-render-site.sh

# Demo targets. Empty means "no demo yet" and the page renders a coming-soon
# state instead of a broken link. DOCS_URL points the documentation links at a
# mirror; empty keeps the published documentation site.
ENV READYROOM_DEMO_URL="" \
    CERTALERT_DEMO_URL="" \
    MFA_PORTAL_DEMO_URL="" \
    DIRECTORY_PORTAL_DEMO_URL="" \
    DOCS_URL="" \
    LICENSING_UPSTREAM="licensing:4321" \
    DNS_RESOLVER="127.0.0.11"

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
