# ens-products-page

Product site for **ENS Solutions, LLC** — a homepage overview linking to a page
for each product, served as static HTML from an nginx container.

| Product | Page | Status |
|---|---|---|
| ReadyRoom | `/products/readyroom.html` | Available |
| CertAlert | `/products/certalert.html` | Available |
| RSA Operations Portal | `/products/mfa-portal.html` | Available |
| Directory Services Portal | `/products/directory-portal.html` | Available |

Plus `/pricing.html` (the price list, support tiers, services, buying terms
and a quote estimator) and `/contact.html`.

The site is built with [Astro](https://astro.build) and TypeScript into plain
static files, and served by nginx. There is still no CDN, no backend and no
third-party script; the browser gets HTML, one stylesheet, and small scripts on
the pages that have something interactive (the contact form, the RSA help-desk
savings calculator and the quote estimator). The only per-deployment values
are the demo URLs, and those are resolved when the container starts.

The move from hand-written HTML to Astro is what lets the site grow: the
header, footer and page shell are shared components, the product line and
the price list are typed data that every page reads, interactive features are
TypeScript modules bundled per page, and the pricing arithmetic is unit tested.
React, Preact or another UI framework can be added as an Astro integration
when a feature needs one, and an SSR adapter if one ever needs a server.

---

## Developing

Needs Node.js 22.12 or newer.

```bash
npm install
npm run dev        # http://localhost:4321, reloads on save
npm test           # pricing arithmetic (Vitest)
npm run check      # TypeScript and Astro type check
npm run build      # static site into dist/
npm run verify     # all three
```

`npm run dev` shows both states of every demo button, because the demo
markers are only resolved by the container (see [Demo links](#demo-links)).
`npm run render` runs that step locally against `dist/`, into `dist-rendered/`;
it needs `envsubst` (GNU gettext) on `PATH`.

CI (`.github/workflows/ci.yml`) runs the type check, the tests, the build, the
container's render step and the Docker build on every pull request.

---

## Running it

```bash
cp .env.example .env      # then fill in whichever demo URLs exist
docker compose up --build
```

Then open <http://localhost:8080>.

The Dockerfile has two stages: `node:22-alpine` installs dependencies, runs the
tests and builds the site; `nginx:1.27-alpine` serves the result. Nothing from
Node ends up in the served image.

Without Compose:

```bash
docker build -t ens-products-page .
docker run --rm -p 8080:8080 \
  -e READYROOM_DEMO_URL="https://demo.example.com/readyroom" \
  ens-products-page
```

### Demo deployment, behind a reverse proxy

`docker-compose.demo.yml` runs the same site with **no port published on the
host**. The container, `ens-products-demo`, is reachable only on the Docker
network `ens-demo`, so a reverse proxy on that network serves it, at
`http://ens-products-demo:8080`.

```bash
cp .env.example .env.demo   # demo URLs; add DEMO_NETWORK=... to use another network
docker compose -f docker-compose.demo.yml --env-file .env.demo up -d --build
```

It runs as its own Compose project (`ens-products-page-demo`), so it never
collides with the default one. The first `up` creates the network if it doesn't
exist. A proxy started from another Compose project joins it by declaring it
under `networks:` with `external: true` and `name: ens-demo`.

`GET /healthz` returns `200 ok` for orchestrator health checks, and the image
carries a `HEALTHCHECK` that uses it.

---

## Demo links

Each product page has a demo button driven by one environment variable:

| Variable | Product |
|---|---|
| `READYROOM_DEMO_URL` | ReadyRoom |
| `CERTALERT_DEMO_URL` | CertAlert |
| `MFA_PORTAL_DEMO_URL` | RSA Operations Portal |
| `DIRECTORY_PORTAL_DEMO_URL` | Directory Services Portal |

Set one and that product's button becomes a live link to it. **Leave it empty
and the page renders a "coming soon" state instead** — there is no way to get a
button pointing at an empty `href`, which is the whole reason this is done at
render time rather than in the markup.

The variables are read **at container start**, not at build time, so pointing a
deployment at a different demo environment is a restart, not a rebuild:

```bash
docker compose up -d --force-recreate
```

### How that works

Astro's build output, `dist/`, holds templates, not the served files. The image
copies it to `/usr/share/nginx/template`, and
`docker/docker-entrypoint.d/30-render-site.sh` renders it into
`/usr/share/nginx/html` on every start — the official nginx entrypoint runs
every executable in `/docker-entrypoint.d` before starting nginx.

In the source, a product page wraps its demo buttons in `DemoSwitch`:

```astro
<DemoSwitch product="readyroom">
    <Fragment slot="demo">
        <DemoLink product="readyroom" />
    </Fragment>
    <Fragment slot="nodemo">
        <span class="btn btn--disabled" aria-disabled="true">Demo unavailable</span>
    </Fragment>
</DemoSwitch>
```

which builds to two mutually exclusive blocks, of which exactly one survives
the render:

```html
<!--DEMO:READYROOM-->
  <a class="btn btn--primary" href="${READYROOM_DEMO_URL}" target="_blank" rel="noopener">Open the demo</a>
<!--/DEMO:READYROOM-->
<!--NODEMO:READYROOM-->
  <span class="btn btn--disabled" aria-disabled="true">Demo unavailable</span>
<!--/NODEMO:READYROOM-->
```

The render script works line by line, which is why `astro.config.mjs` turns
off `compressHTML`: the markers must stay on lines of their own.

Substitution is restricted to the four `*_DEMO_URL` names, so no other `$NAME`
in the markup or CSS is touched. Non-HTML files are copied through byte for
byte.

To add another product, add it to `src/data/products.ts` with its `demoKey`,
add its `NAME_DEMO_URL` to the `export` list, the `enabled` list and the `vars`
list in the render script and to the Dockerfile and Compose files, then use
`DemoSwitch` in its page.

### Cache busting

The pages themselves are never cached. Everything else is, and two mechanisms
make sure a returning visitor never gets new pages with old assets:

- **The stylesheet and scripts** are bundled by Astro into `/_astro/` with a
  content hash in the file name (`/_astro/BaseLayout.CkhJsfDJ.css`). A changed
  file is a new URL, so nginx lets browsers keep `/_astro/` for a year.
- **Images** under `public/assets/` keep their names, and nginx lets browsers
  keep them for a week. The last step of the render script adds each one's
  content hash to every reference to it in the pages
  (`/assets/img/brand/ens-solutions-logo.jpg?v=f52784c931`).

Without this, a phone that visited before a deploy showed the new pages with
the old stylesheet: oversized logos, a layout wider than the screen, and the
old colours.

Write image references in the markup as plain absolute paths in double quotes
(`src="/assets/..."`). The render script only versions references in that
form.

### Rendering outside the container

The script takes `SITE_TEMPLATE_DIR` and `SITE_OUTPUT_DIR` overrides, which is
how `npm run render` exercises it without Docker:

```bash
npm run build
READYROOM_DEMO_URL=https://demo.example.com/readyroom npm run render
# or by hand:
SITE_TEMPLATE_DIR=dist SITE_OUTPUT_DIR=/tmp/out \
READYROOM_DEMO_URL=https://demo.example.com/readyroom \
  sh docker/docker-entrypoint.d/30-render-site.sh
```

Needs `envsubst` (GNU gettext) on `PATH`; the nginx image already ships it.

---

## Layout

```
src/
  pages/                    One file per URL; built to the same paths as before
    index.astro             Homepage: company intro, product cards, pricing teaser
    pricing.astro           Price list, support, services, buying terms, estimator
    contact.astro           Contact form (opens the visitor's email app)
    404.astro
    products/               One page per product, each ending in its pricing
  layouts/BaseLayout.astro  The page shell: <head>, header, footer
  components/
    SiteHeader.astro        Nav, built from the product list
    SiteFooter.astro
    DemoSwitch.astro        Demo / no-demo blocks for the render script
    DemoLink.astro          The "Open the demo" button
    PriceTable.astro        A product's size bands and prices
    ProductPricing.astro    The "Pricing" section of a product page
    SavingsCalculator.astro RSA Operations Portal help-desk savings
    Estimator.astro         The quote estimator's form
  data/
    products.ts             The product line: names, paths, demo keys, contact topics
    pricing.ts              Every price and pricing rule
    examples.ts             Worked examples quoted on the site
  lib/
    pricing.ts              Pricing arithmetic (pure functions)
    pricing.test.ts         Its tests
  scripts/                  Browser code: contact form, estimator, savings calculator
  styles/site.css           The whole stylesheet
public/assets/img/          Brand images and product screenshots, served as-is
nginx/default.conf          Server config: port 8080, gzip, caching, /healthz, 404
docker/docker-entrypoint.d/
  30-render-site.sh         Resolves demo URLs at container start
astro.config.mjs            Build settings: .html file URLs, uncompressed HTML
Dockerfile                  Build with Node, serve with nginx
docker-compose.yml
docker-compose.demo.yml     Demo deployment: no host port, reverse-proxy network
.env.example
.github/workflows/ci.yml
```

---

## Editing content

Page copy is HTML inside each `.astro` file under `src/pages/` — edit the file
for the page you want to change. The header, footer and `<head>` are in
`BaseLayout.astro` and its components, so a nav change is one edit.

Colours, spacing and type are CSS custom properties declared once at the top of
`src/styles/site.css`, with a dark-mode block right below. Re-skinning to match
brand colours means editing those tokens and nothing else.

### Pricing

Every price on the site lives in `src/data/pricing.ts` and is never typed into
a page: the pricing page, each product page's pricing section, the homepage,
the RSA savings calculator and the estimator all read it, at build time and in
the browser. Change a number there and rebuild. `npm test` checks the
arithmetic, including that the worked example on the pricing page still comes
to roughly $55K a year.

The rules it encodes:

- **Annual subscriptions**, tiered by size, include updates, security patches
  and Standard (business-hours) support. ReadyRoom is sized by tracked people,
  RSA Operations Portal by SecurID users, the others by directory users. The
  largest band of each product is priced on request, except Enterprise or
  multi-forest CertAlert, which is a "from" price.
- **Perpetual licenses** list at `PERPETUAL_MULTIPLE` (2.75x) the annual
  subscription for the same band, with yearly maintenance as a share of the
  license: Standard 20%, Premium 28%, Mission 35%.
- **Support add-ons** on a subscription are the same percentages of the
  subscription after the suite discount (Standard is included). That is the
  reading that makes the plan's example come out at roughly $55K: CertAlert
  plus RSA Operations Portal at 10,000 users is $55,000, less 25% is $41,250,
  plus 35% for Mission is $55,688 a year.
- **Suite discount**: 25% off the sum for two products, 30% for three or more.
  Products priced on request count toward the discount but are left out of
  the estimator's totals.
- **Multi-year prepay**: 10% off three years paid up front (subscription only).
- **Services**: installation $5K–15K per product, STIG-hardened image and ATO
  package $10K–25K, training $2,500 per half-day, custom Directory Services
  Portal schema and form work on time and materials.
- **Evaluation and pilot**: the 30-day evaluation container is free; the
  90-day paid pilot is $5,000, credited toward year one.
- **Acquisition thresholds**: the FAR 2.101 micro-purchase ($15,000) and
  simplified acquisition ($350,000) thresholds in effect from 1 October 2025.
  The estimator says which one an order fits.
- **Reseller margin**: list prices are set to carry a 15–25% reseller margin,
  so the site states one list price whichever way a customer buys. The
  margin itself is not published.

Money is whole dollars. Percentages are applied with integer scaling so that
halves round up, as they would on a hand-written quote.

### Quote estimator

`/pricing.html#estimate` lets a buyer pick products, sizes, the license model,
support tier, prepay, pilot and services, and prices it with the same
`quote()` the tests cover (`src/scripts/estimator.ts`). The configuration is
kept in the query string (`?p=certalert:10000,mfa-portal:10000&support=mission`),
so an estimate can be bookmarked or forwarded, and product pages link to it
with `?product=certalert` to start from that product. "Request this quote"
opens the contact form with the topic set to *Pricing and quotes* and the
estimate written into the message.

Without JavaScript the estimator is hidden behind a note; the price tables on
the same page carry every number it uses.

### Contact form

`/contact.html` has no server side. On submit, `src/scripts/contact.ts` checks the
required fields and builds a `mailto:` link to `info@ens-solutions.com` with a
subject and a body laid out from the fields, which opens a draft in the
visitor's own email app — the message is sent from there, and nothing is stored
or sent by this site. Without JavaScript the form falls back to the browser's
native `mailto:` form submission.

- The recipient is the form's `action` and `data-recipient` attributes.
- Product pages link to `/contact.html?product=readyroom` (or `certalert`,
  `mfa-portal`, `directory-portal`, `pricing`, `pilot`) to pre-select the
  topic; the mapping is `contactTopics` in `src/data/products.ts`, and the
  topic list in the form is built from it.
- `?message=...` pre-fills the message, which is how the estimator hands over
  a quote.
- The message is capped at 1,500 characters (`CONTACT_MESSAGE_LIMIT`) because
  some mail clients truncate long `mailto:` links.
- Visitors with no email app configured get nothing to happen, so the page
  also lists the address and phone number directly.

### External references

The footer of every page links to [ens-solutions.com](https://ens-solutions.com/)
and to the company
[LinkedIn page](https://www.linkedin.com/company/ens-solutions-llc/). Both are
plain links; nothing is embedded and no third-party script is loaded, so the
site still makes no outbound requests of its own.

### Branding

`public/assets/img/brand/` holds:

- `ens-solutions-logo.jpg`: the official ENS Solutions logo, with tagline and
  SDVOSB seal, exactly as ens-solutions.com serves it
  (`/wp-content/uploads/2023/06/ENS-Web-Logo-1_with-SDVOSB.jpg`, 548 x 100). It
  is in every page's header and footer. It's a JPEG on white, so in dark mode
  it sits on a white plate rather than being recoloured.
- `favicon-32.png`, `icon-192.png`, `apple-touch-icon.png`: the logo's dot mark,
  cut from that file. The source is about 90 px tall, so the larger icons are
  slightly soft. Replace them if a vector or larger master exists.
- `readyroom-logo.png`: from `readyroom_logo_1.png` in `in-n-out-work`, trimmed,
  with the white background made transparent. The artwork is one ink colour,
  so dark mode inverts it.
- `certalert-logo.png` and `certalert-logo-white.png`: `cert-alert`'s own logo
  files, unchanged. Dark mode uses the white one.

The site's accent colour is the logo's blue-teal (`--brand`, `#1d5a72`), and the
stripe above the header is its bright teal (`--brand-teal`, `#1aa3b8`). The
bright teal is too light for text on white (2.8:1), so it's used only as
decoration. Dark mode uses a lighter teal (`#4cc3d6`) for links and buttons.

### Screenshots

`public/assets/img/screens/` holds screenshots of all four products. They're
shown on each product page, and one per product on the homepage under "A look
inside". Each was taken at 1440 px wide against demo data:

- **ReadyRoom:** the `test/` Docker Compose stack, with the mock data from
  `seed-mock-data.sh`, signed in as `alice`. `alice` is the mock manager, made
  an administrator for the shots.
- **CertAlert:** the `dev` profile's embedded sample directory, signed in as
  `alice`.
- **Directory Services Portal:** the built-in demo directory, signed in as
  `admin`, after a few edits so the audit log had something to show.
- **RSA Operations Portal (`rsa-portal-*`):** it needs a live RSA
  Authentication Manager to run, so these are the portal's own Thymeleaf
  templates and stylesheets rendered with sample data (fictional names, sites
  and serials) and captured in Chromium at 1.5x, then scaled to 1440 px. The
  portal's classification banners are hidden for the captures. Keep it that
  way if you re-shoot them: no classification or handling markings anywhere on
  this site.

Each screenshot has a `-mobile.jpg` partner: a crop, at full resolution, of
the part that matters. Pages serve it through `<picture>` on screens 640 px wide
or narrower, where a whole 1440 px screenshot would shrink its text to about a
quarter of its size. Replace both files together and keep the crop's `width`
and `height` on its `<source>` in step.

To replace a screenshot, keep the file name, or update the `src`, `width` and `height` in
the pages that use it.

### Where the product copy came from

The ReadyRoom page is written from the `README.md` of the
[`in-n-out-work`](https://github.com/winllc/in-n-out-work) repository, which is
the product's implementation — attendance and presence tracking driven by
workstation logon, lock, unlock and logoff events. Its technical summary
reflects that codebase: Spring Boot 4 on Java 21, PostgreSQL, LDAP, a PowerShell
client, and mutual TLS with an LDAP form-login fallback.

The CertAlert page is written from the `README.md` of
[`cert-alert`](https://github.com/winllc/cert-alert): an index over the
certificates an LDAP directory publishes, built against the IC IdAM Full Service
Directory schema — Spring Boot 4 on Java 21, PostgreSQL with Flyway, a Tabler UI,
certificate sign-in by fingerprint, changelog following, revocation and endpoint
checks, and email round-ups to server points of contact.

The Directory Services Portal page is written from the `README.md` of
[`directory-services-portal`](https://github.com/winllc/directory-services-portal):
a web front end for LDAP directories with custom schemas, with a Spring Boot 4 /
Java 21 API on the UnboundID LDAP SDK, a React client served by nginx, and
password or X.509 sign-in.

The RSA Operations Portal page (formerly listed as "MFA Portal") is written
from the [`rsa-operations-portal`](https://github.com/winllc/rsa-operations-portal)
repository: a Spring Boot and Thymeleaf portal with a MySQL database and a
connector to RSA Authentication Manager's administration API. Its page keeps
the old `mfa-portal.html` path, the `MFA_PORTAL_DEMO_URL` variable and the
`?product=mfa-portal` contact key, so existing links and deployments keep
working.
