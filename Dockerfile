# Two stages: Node builds the site with Astro, nginx serves the result.
#
# The build produces plain static files. The only per-deployment values (the
# demo URLs) are still resolved at container start by 30-render-site.sh rather
# than baked into the image, so one image serves every environment.

# ---- Build -----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, so editing a page doesn't reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY astro.config.mjs tsconfig.json ./
COPY public/ public/
COPY src/ src/

# The pricing arithmetic is tested before anything is built from it.
RUN npm test && npm run build

# ---- Serve -----------------------------------------------------------------
FROM nginx:1.27-alpine

# Serve on 8080 so the container can run as a non-root user if the platform
# asks it to; the stock config listens on 80 and is replaced wholesale.
RUN rm -f /etc/nginx/conf.d/default.conf

COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Templates, not the served root. The entrypoint script renders these into
# /usr/share/nginx/html on every start.
COPY --from=build /app/dist/ /usr/share/nginx/template/

COPY docker/docker-entrypoint.d/30-render-site.sh /docker-entrypoint.d/30-render-site.sh
RUN chmod +x /docker-entrypoint.d/30-render-site.sh

# Demo targets. Empty means "no demo yet" and the page renders a coming-soon
# state instead of a broken link.
ENV READYROOM_DEMO_URL="" \
    CERTALERT_DEMO_URL="" \
    MFA_PORTAL_DEMO_URL="" \
    DIRECTORY_PORTAL_DEMO_URL=""

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
