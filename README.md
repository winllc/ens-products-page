# ens-products-page

Product site for **ENS Solutions, LLC** — a homepage overview linking to a page
for each product, served as static HTML from an nginx container — and the
licensing service behind it, where customers sign up, download free
evaluation licenses and manage the licenses they buy.

| Product | Page | Status |
|---|---|---|
| ReadyRoom | `/products/readyroom.html` | Available |
| CertAlert | `/products/certalert.html` | Available |
| RSA Operations Portal | `/products/mfa-portal.html` | Available |
| Directory Services Portal | `/products/directory-portal.html` | Available |

Plus `/pricing.html` (the price list, support tiers, services, buying terms
and a quote estimator), `/licensing.html` (how licensing works),
`/contact.html`, and the licensing pages: `/account` for customers and
`/admin` for ENS staff.

The site is built with [Astro](https://astro.build) and TypeScript. The
marketing pages are prerendered to plain static files and served by nginx,
with no CDN and no third-party script. The licensing pages are rendered on
demand by a small Node service (Astro's Node adapter, with SQLite through
Node's built-in `node:sqlite`), which nginx proxies `/account`, `/admin` and
`/api/licensing` to. One codebase, two containers: see
[Licensing service](#licensing-service).

The header, footer and page shell are shared components; the product line,
the price list and the license feature catalog are typed data every page
reads; interactive features are TypeScript modules bundled per page; and the
pricing and licensing logic is unit tested.

---

## Developing

Needs Node.js 22.12 or newer.

```bash
npm install
npm run dev        # http://localhost:4321, reloads on save
npm test           # pricing, licensing, accounts (Vitest)
npm run check      # TypeScript and Astro type check
npm run build      # static pages into dist/client/, the licensing server into dist/server/
npm run verify     # all three
npm start          # run the built licensing server (it serves the static pages too)
npm run test:releases  # release downloads end to end against MinIO (needs Docker)
```

`npm run dev` runs the licensing pages as well, with a database and a
generated signing key in `./data/` and confirmation emails printed to the
terminal instead of sent. Set `COOKIE_SECURE=false` only if you test through
an `http://` address other than localhost, and `ADMIN_EMAILS=you@example.com`
to make your account an administrator.

`npm run dev` shows both states of every demo button, because the demo
markers are only resolved by the container (see [Demo links](#demo-links)).
`npm run render` runs that step locally against `dist/client/`, into
`dist-rendered/`; it needs `envsubst` (GNU gettext) on `PATH`.

The Java license verifier has its own build: `cd licensing/java && mvn test`.

CI (`.github/workflows/ci.yml`) runs the type check, the tests, the build, the
container's render step, a start-up check of the licensing service, the
release downloads test against MinIO, both Docker images and the Java
verifier's tests on every pull request.

---

## Running it

```bash
cp .env.example .env      # then fill in whichever demo URLs exist
docker compose up --build
```

Then open <http://localhost:8080>.

Compose runs two containers from one Dockerfile:

| Service | Target | Image | |
|---|---|---|---|
| `site` | `web` | `nginx:1.27-alpine` | Static pages; proxies the licensing paths to `licensing` |
| `licensing` | `licensing` | `node:22-alpine` | Accounts and licenses; data in the `licensing-data` volume; no published port |

A shared `node:22-alpine` stage installs dependencies, runs the tests and
builds both.

Without Compose, the static site on its own (the account pages then show a
"licensing unavailable" page; everything else works):

```bash
docker build --target web -t ens-products-page .
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

Its licensing service, `ens-products-demo-licensing`, sits on the same network
for the site container to proxy to; point the reverse proxy only at
`ens-products-demo`. Set `PUBLIC_URL` in `.env.demo` to the demo's public
address so confirmation links work.

`GET /healthz` returns `200 ok` for orchestrator health checks, and the image
carries a `HEALTHCHECK` that uses it. The licensing image's equivalent is
`GET /api/licensing/health`, which also checks the database and signing key.

---

## Licensing service

Customers create an account, confirm their email, and download a free 30-day
evaluation license for any product, one per product per account. An
evaluation covers the product's second size band (10,000 directory users
for CertAlert and Directory Services Portal, 10,000 SecurID users for the
RSA Operations Portal, 2,500 tracked people for ReadyRoom), ends with a
7-day grace period, and can be extended once, by 30 days, from its license
page; after that it's the paid pilot. Licenses they buy (subscriptions,
perpetual licenses, pilots) are issued into the same account by ENS staff at
`/admin` against the order, and renewals re-issue them there. Everything that
creates or changes a license goes through this service, and every change is
in an audit log customers and staff can read.

| Customers (`/account`) | ENS staff (`/admin`) |
|---|---|
| Sign up, confirm email, reset password | Find accounts and licenses; renewals due in 60 days |
| Download evaluation licenses; extend one once by 30 days | Issue subscription, perpetual, pilot or evaluation licenses with order reference |
| Download any license they hold | Renew (new expiry, or new end of maintenance) |
| Download releases of the products they're licensed for | Download releases of every product |
| Bind a license to an installation id | Revoke and reinstate |
| Name licenses; check a license file | Make administrators; disable accounts |
| Their own activity history | Full audit log: search, export, verify, SIEM delivery |

How a license file unlocks features in the applications, the file format,
and the Java library the applications use are in
[`licensing/README.md`](licensing/README.md).

### Configuration

All in the `licensing` service's environment (see `.env.example`):

| Variable | |
|---|---|
| `PUBLIC_URL` | The address customers use, e.g. `https://products.ens-solutions.com`. Links in emails start with it; `https:` also makes session cookies Secure. **Set it.** |
| `ADMIN_EMAILS` | Comma-separated. These accounts become administrators once they confirm their email. This is how the first administrator is made; others can then be promoted at `/admin/accounts`. |
| `LICENSE_SIGNING_KEY` | The Ed25519 private key, from `npm run license -- keygen` (PEM, or the one-line form it prints). **A secret.** Unset, a key is generated in the data volume on first start, with a warning in the log. |
| `LICENSE_SIGNING_KEY_FILE` | Or a path to it, e.g. a Docker secret. |
| `LICENSE_SIGNING_KEY_P256` | Optional ECDSA P-256 private key, from `npm run license -- keygen --alg p256`. **A secret.** Set, every license is also signed with it, so it verifies on Java in FIPS mode, which has no Ed25519 (`licensing/README.md`, "FIPS 140-3"). Never generated. |
| `LICENSE_SIGNING_KEY_P256_FILE` | Or a path to it. |
| `LICENSE_TRUSTED_KEYS` | Retired public keys (Ed25519 or ECDSA P-256) still accepted by *Check a file*, after a key rotation. |
| `SMTP_URL`, `MAIL_FROM` | Outgoing mail for confirmations and password resets. Unset, messages are written to the service's log. |
| `DATA_DIR` | `/data` in the image: `licensing.sqlite` and, if generated, the signing key. |
| `RELEASES_S3_BUCKET` | The private bucket the applications' CI publishes releases to. Unset, downloads are off and the downloads page says they aren't available yet. See [Release downloads](#release-downloads). |
| `RELEASES_S3_REGION` | Default `us-east-1`; `auto` for Cloudflare R2. |
| `RELEASES_S3_ENDPOINT` | Only for S3-compatible stores: R2 (`https://<account-id>.r2.cloudflarestorage.com`) or MinIO (`http://minio:9000`). |
| `RELEASES_S3_FORCE_PATH_STYLE` | `true` for MinIO. Default `false`. |
| `RELEASES_URL_TTL` | Seconds a download link works. Default `300`. |
| `RELEASES_LISTING_TTL` | Seconds a bucket listing is cached in memory. Default `300`: a new release shows within five minutes. |
| `RELEASES_GPG_PUBLIC_KEY_URL` | Where customers get the key `SHA256SUMS.asc` is signed with; linked from the downloads page. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | The bucket's read-only credentials. **A secret.** Leave both empty to use an instance or task role: they come from the AWS SDK's standard chain, never from the database. |

Back up the `licensing-data` volume, and above all the signing keys: if one
is lost, existing files still verify but no new license can be signed for
applications that only trust it.

### Security notes

- Passwords: scrypt; at least 12 characters. Session, confirmation and reset
  tokens are random and stored only as SHA-256 hashes.
- Sign-up, sign-in and reset answer the same way whether or not an address
  has an account, and are rate limited per client address and address tried.
- Form posts are checked for same origin (Astro's `security.checkOrigin`);
  cookies are HttpOnly, SameSite=Lax, and Secure on `https:`.
- Account pages are `no-store`, framed by nobody, and carry a strict CSP.
- nginx overwrites `X-Forwarded-For` with the real client address; the
  service trusts forwarded headers because only nginx can reach it. Don't
  publish its port.
- Release files never pass through the service. A download is a `302` to a
  presigned S3 URL that works for `RELEASES_URL_TTL` seconds; entitlement is
  checked again on every download.
- The signing key never leaves the service. `GET /api/licensing/keys` serves
  the public keys; `GET /api/licensing/licenses/<id>/status` tells an
  application with a network route whether a license is revoked, and nothing
  about the customer.

### Release downloads

Customers download releases at **`/account/downloads`**: every version of
each product they hold a license for, with each file's size and SHA-256.
Any license that isn't revoked counts, evaluations and expired ones
included (the applications enforce expiry and maintenance themselves), so
an evaluation is enough. Administrators can download every product.
Products an account has no license for show the free evaluation button,
which comes back to the page.

The releases are in a private bucket that each application's CI writes;
the portal only reads it:

```
s3://<bucket>/<prefix>/<version>/<file>       X.Y.Z, or X.Y.Z-suffix for a pre-release
s3://<bucket>/<prefix>/latest.txt             the newest final version
```

| Product | Prefix | Package |
|---|---|---|
| CertAlert | `cert-alert` | `cert-alert-<v>.tar.gz` |
| Directory Services Portal | `directory-services-portal` | `directory-services-portal-<v>.tar.gz`, `…-<v>-native.tar.gz` |
| ReadyRoom | `readyroom` | `readyroom-<v>.tar.gz` |
| RSA Operations Portal | `rsa-operations-portal` | `rsa-operations-portal-<v>.tar.gz` |

Each version also holds its Helm chart (`*.tgz`), SBOMs
(`sbom-*.spdx.json`), `SHA256SUMS` and, when signed, `SHA256SUMS.asc`. The
page lists them in that order, the package first; the latest version is
open at the top, and the others follow newest first, pre-releases marked.
The prefixes are in `src/lib/releases.ts`.

`GET /account/downloads/<product>/<version>/<file>` answers a `302` to a
presigned GET (with `response-content-disposition=attachment`), so
packages of a gigabyte or more come straight from S3. Anything but a known
product, a version name and a plain file name in that version's listing is
a `404`; no license for the product is a `403`, recorded as
`access.denied`. Each download is recorded as `release.downloaded`, which
customers see in their own history. More than 120 links in an hour from
one account is a `429`.

**Setting it up**

1. Give the portal its own read-only credentials, separate from the
   write credentials CI publishes with. This is all it needs (replace
   `RELEASE-BUCKET`):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::RELEASE-BUCKET" },
       { "Effect": "Allow", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::RELEASE-BUCKET/*/*" }
     ]
   }
   ```

   On R2, an API token with *Object Read* on the bucket.
2. Set `RELEASES_S3_BUCKET` and `RELEASES_S3_REGION`, and either
   `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` or an instance or task
   role. For R2 also `RELEASES_S3_ENDPOINT` and region `auto`; for MinIO,
   the endpoint and `RELEASES_S3_FORCE_PATH_STYLE=true`.
3. Optionally, `RELEASES_GPG_PUBLIC_KEY_URL`.
4. Restart the licensing service. The bucket needs no CORS rule and the
   page's CSP no change: a download is a plain navigation.

**Testing against MinIO.** `npm run test:releases` (needs Docker) starts a
MinIO container, uploads a fake release tree for two products, builds and
starts the portal, then signs up, takes an evaluation, and checks the
page, the download (byte for byte) and the refusals. It removes only its
own container and volume afterwards; CI runs it too. MinIO's own images
are no longer public (the community edition is archived), so it uses
Chainguard's MinIO build, pinned by digest; set `MINIO_IMAGE` to use
another.

### Audit logging

Everything that matters is recorded in one tamper-evident audit trail, in the
common ENS event format (`ens-audit/1`, the same as CertAlert, ReadyRoom, the
RSA Operations Portal and the Directory Services Portal). The full format,
and how to bring it into a SIEM, is on the docs site:
[Audit logging](https://github.com/winllc/ens-apps-documentation/blob/master/docs/audit-logging.md)
(`audit-logging.md`).

**What is recorded**

| Category | Actions |
|---|---|
| authentication | `auth.login` (success and failure; on failure the address tried is the actor and `reason` says why), `auth.logout`, `auth.lockout` (rate limit hit on sign-in, sign-up, reset, resend or release downloads), `account.password-changed`, `account.password-reset`, `account.password-reset-requested` |
| authorization | `access.denied`: every 403 from the service (a non-administrator on `/admin`, a release download without a license for the product), with method, path and reason; repeats within 60 seconds are collapsed into one event with `details.count` |
| account | `account.created`, `account.verified` (and failed confirmation links), `account.updated` (old and new values), `account.role-changed`, `account.disabled`, `account.enabled` |
| data | `license.issued`, `license.downloaded`, `license.bound`, `license.renamed`, `license.renewed`, `license.revoked`, `license.reinstated`, `license.resigned`, `release.downloaded` (product, version and file) |
| audit | `audit.exported`, `audit.verified`, `audit.token-created`, `audit.token-revoked`, `audit.pruned`, `audit.delivery-failed`, `audit.delivery-recovered` |
| system | `system.started`, `system.stopped`, `job.failed` (retention) |

Passwords, session and email tokens, API tokens and license files are never
recorded. Customers see their own sign-ins and the changes to their account
and licenses on their account page; administrators see everything at
**`/admin/audit`**: filters, paging, each event in full, CSV and NDJSON
export, *Verify integrity*, delivery status per output, and API tokens.

**Where it goes.** The SQLite database is the record (table `audit_events`,
each event hash-chained to the one before; appends are serialized by
SQLite's write lock). The outputs copy it:

| Variable | Default | |
|---|---|---|
| `ENS_AUDIT_STDOUT` | `true` | One raw JSON line per event on stdout, with no prefix. The service's own diagnostics go to stderr, so every stdout line starting `{"schema":"ens-audit/1"` is an event. |
| `ENS_AUDIT_FILE` | empty (off) | Also append the lines to this file, e.g. `/var/log/ens/licensing-portal/audit.jsonl` (the `ens-audit` volume). Rotated daily or at 100 MB to `audit-YYYY-MM-DD.jsonl`. |
| `ENS_AUDIT_FILE_KEEP` | `30` | Rotated files to keep. |
| `ENS_AUDIT_SPLUNK_URL` | empty (off) | Splunk HEC base URL, e.g. `https://splunk.example.com:8088`. Events are posted to `/services/collector/event` in batches of up to 100. |
| `ENS_AUDIT_SPLUNK_TOKEN`, `ENS_AUDIT_SPLUNK_TOKEN_FILE` | | The HEC token, or a file holding it. Never logged. |
| `ENS_AUDIT_SPLUNK_INDEX` | empty | Optional index. |
| `ENS_AUDIT_SPLUNK_SOURCETYPE` | `ens:audit` | |
| `ENS_AUDIT_SPLUNK_INSECURE` | `false` | `true` skips certificate checks (test setups only; a warning is logged). For a private CA set `NODE_EXTRA_CA_CERTS`. |
| `ENS_AUDIT_SYSLOG_HOST` | empty (off) | Syslog receiver. RFC 5424, APP-NAME `licensing-portal`, MSGID the action, the JSON line as the message. |
| `ENS_AUDIT_SYSLOG_PORT` | `514`, or `6514` for tls | |
| `ENS_AUDIT_SYSLOG_PROTOCOL` | `tcp` | `udp`, `tcp` or `tls` (octet-counted framing on tcp and tls). |
| `ENS_AUDIT_SYSLOG_FACILITY` | `local0` | |
| `ENS_AUDIT_RETENTION_DAYS` | `0` (keep forever) | Above 0, a daily job deletes older events once every enabled forwarder has delivered them, never the newest, and records `audit.pruned`. |

HEC and syslog are delivered in the background from a cursor kept in the
database: at-least-once (de-duplicate on `id`), retried with backoff up to
five minutes, and never in the way of a request. After 15 minutes of failure
the service records `audit.delivery-failed`. Startup logs one line per
output to stderr saying whether it is on.

**Getting it into Splunk.** Any one of:

- **HEC**: create a HEC token (sourcetype `ens:audit`), set
  `ENS_AUDIT_SPLUNK_URL` and `ENS_AUDIT_SPLUNK_TOKEN`.
- **Universal Forwarder**: set `ENS_AUDIT_FILE` and monitor it with
  `sourcetype = ens:audit` (the lines are JSON, so `KV_MODE = json` or
  `INDEXED_EXTRACTIONS = json`), or collect the container's stdout from the
  Docker logging driver and keep the lines that start `{"schema":"ens-audit/1"`.
- **Pull API**: create a token at `/admin/audit` (shown once; only its hash
  is kept) and poll
  `GET /api/audit/events?after=<last seq>&limit=500` with
  `Authorization: Bearer <token>`. It returns NDJSON in seq order, or
  `{"events":[...],"next":<seq>}` with `Accept: application/json`; pass
  `next` as `after` on the next call. nginx proxies `/api/audit` to the
  licensing service.

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
list in the render script and to the Dockerfile and Compose files, then build
its page on `ProductLayout` (see [Product pages](#product-pages)), which places
the demo buttons.

## Documentation links

The header, the footer, every product card and every product page link to the
[documentation site](https://winllc.github.io/ens-apps-documentation/): each
product's overview, install, configuration, admin and user guides, plus
releases and audit logging. Set `DOCS_URL` to send those links to a mirror
instead, for a network that cannot reach the published site. Like the demo
URLs it is read at container start: the render script swaps the published
address for it in the static pages, and the licensing service reads it when it
renders its own. Empty (the default) keeps the published site.

## Product pages

Every product page is built on `src/layouts/ProductLayout.astro`, which gives
them the same frame:

- **the hero:** a breadcrumb, the eyebrow and status badge from
  `products.ts`, the page's headline and lede, and the demo (or "Request a
  demo"), Documentation and tour buttons;
- **a menu of the page's sections**, kept under the header as you scroll;
- **after the page's own sections:** its documentation guides and buying
  links, then the other products as cards.

A page supplies only what is its own: `headline`, `description`, its
`sections` (heading ids and short labels, for the menu), and slots for the
`lede`, an optional `logo`, an optional `aside` beside the hero text (a
screenshot or illustration), and its sections.

The homepage cards and the "more products" strip are `ProductCard`, fed from
`products.ts` (summary, status, card screenshot, docs section). The header lists
the products in one menu, so adding a product changes no navigation code.

### Cache busting

The pages themselves are never cached. Everything else is, and two mechanisms
make sure a returning visitor never gets new pages with old assets:

- **The stylesheet and scripts** are bundled by Astro into `/_astro/` with a
  content hash in the file name (`/_astro/BaseLayout.CkhJsfDJ.css`). A changed
  file is a new URL, so nginx lets browsers keep `/_astro/` for a year. Pages the licensing service
  renders use the same bundles.
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
  pages/                    One file per URL
    index.astro             Homepage: company intro, product cards, pricing teaser
    pricing.astro           Price list, support, services, buying terms, estimator
    licensing.astro         How licensing works, for buyers and installers
    contact.astro           Contact form (opens the visitor's email app)
    404.astro, licensing-unavailable.astro
    products/               One page per product, each ending in its pricing
    account/                Customer licensing pages (rendered on demand)
    admin/                  ENS staff licensing pages (rendered on demand)
    api/licensing/          Public keys, license status, health
    api/audit/              Audit pull API for SIEMs (bearer token)
  layouts/
    BaseLayout.astro        The page shell: <head>, header, footer
    ProductLayout.astro     A product page's hero, section menu, docs and other products
    AccountLayout.astro     Licensing page shell: heading, account nav, notices
  components/
    SiteHeader.astro        Header, with the products menu
    SiteFooter.astro
    ProductCard.astro       A product as a card: screenshot, summary, price, docs link
    DemoSwitch.astro        Demo / no-demo blocks for the render script
    DemoLink.astro          The "Open the demo" button
    PriceTable.astro        A product's size bands and prices
    ProductPricing.astro    The "Pricing" section of a product page
    SavingsCalculator.astro RSA Operations Portal help-desk savings
    Estimator.astro         The quote estimator's form
    licensing/              License table, details, status pill, audit list, release files
  data/
    products.ts             The product line: names, paths, demo keys, cards, docs sections
    site.ts                 The documentation site's address (DOCS_URL)
    pricing.ts              Every price and pricing rule
    licensing.ts            Features per product (and which are still planned), editions, evaluation size
    examples.ts             Worked examples quoted on the site
  lib/
    pricing.ts              Pricing arithmetic (pure functions)
    licensing/license.ts    The license file: format, signing, verification, state
    licensing/issue.ts      Building a license from what was sold
    releases.ts             Release versions, SHA256SUMS, file names (pure functions)
  server/                   The licensing service: config, database and migrations,
                            accounts, sessions, licenses, audit trail (audit*.ts:
                            format and chain, store, outputs, pull API), mail, keys,
                            release bucket (releases.ts)
  middleware.ts             Loads the signed-in account on licensing pages
  scripts/                  Browser code: contact form, estimator, savings calculator
  styles/site.css           The whole stylesheet
public/assets/img/          Brand images and product screenshots, served as-is
licensing/                  The applications' side: Java verifier, Spring example,
                            cross-language fixtures (see licensing/README.md)
scripts/license.mjs         keygen, public-key, inspect, verify
scripts/releases-minio-test.sh  Release downloads end to end, against MinIO in Docker
nginx/default.conf.template Server config: port 8080, gzip, caching, licensing proxy
docker/docker-entrypoint.d/
  30-render-site.sh         Resolves demo URLs and DOCS_URL at container start
astro.config.mjs            Build settings: Node adapter, .html file URLs, origin checks
Dockerfile                  Build, then the `web` and `licensing` images
docker-compose.yml          Both services and the licensing data volume
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

`/contact.html` posts to the licensing service at `POST /api/licensing/contact`
(`src/pages/api/licensing/contact.ts`), which nginx already proxies. The
service checks the fields, stores the message as a **lead**, records
`lead.created` in the audit trail, emails it to `CONTACT_TO` (default
`info@ens-solutions.com`, sent from `MAIL_FROM` with the visitor as
Reply-To) and sends the visitor an acknowledgement. ENS staff work the list
at `/admin/leads`: newest first, with a status per lead (new, contacted,
closed) and a detail page. The page itself stays static:

- With JavaScript, `src/scripts/contact.ts` posts the fields as JSON and
  shows the answer in place. If the service answers with a server error or
  can't be reached at all (a network where the licensing service is down),
  it falls back to what the form did before: it composes a `mailto:` link to
  the address in `data-recipient` and opens the visitor's own email app.
- Without JavaScript the browser posts the form and the service answers
  with a redirect to `/contact.html?sent=1#sent`, where the confirmation is
  shown by the `#sent` fragment alone.
- A hidden honeypot field (`website`) catches form-filling bots: a
  submission with it set is accepted and dropped. Each address may send
  five messages an hour (`src/server/rate-limit.ts`); more get a 429.
- Astro's `security.checkOrigin` refuses a form post from another site; a
  JSON post from another site fails the browser's preflight, since the
  endpoint answers no CORS headers.
- Product pages link to `/contact.html?product=readyroom` (or `certalert`,
  `mfa-portal`, `directory-portal`, `pricing`, `pilot`) to pre-select the
  topic; the mapping is `contactTopics` in `src/data/products.ts`, and the
  topic list the form shows and the service accepts is `contactTopicList`
  in `src/data/contact.ts`.
- `?message=...` pre-fills the message, which is how the estimator hands over
  a quote.
- The message is capped at 1,500 characters (`CONTACT_MESSAGE_LIMIT`), which
  also keeps the `mailto:` fallback inside what mail clients accept.
- The page lists the address and phone number directly as well.

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
