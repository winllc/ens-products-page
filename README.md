# ens-products-page

Product site for **ENS Solutions, LLC** — a homepage overview linking to a page
for each product, served as static HTML from an nginx container.

| Product | Page | Status |
|---|---|---|
| ReadyRoom | `/products/readyroom.html` | Available |
| CertAlert | `/products/certalert.html` | Available |
| MFA Portal | `/products/mfa-portal.html` | Coming soon |
| Directory Services Portal | `/products/directory-portal.html` | Available |

No build step, no CDN, no backend. The pages are plain HTML and one
stylesheet, plus one small script on the contact page; the only per-deployment
values are the demo URLs, and those are resolved when the container starts.

---

## Running it

```bash
cp .env.example .env      # then fill in whichever demo URLs exist
docker compose up --build
```

Then open <http://localhost:8080>.

Without Compose:

```bash
docker build -t ens-products-page .
docker run --rm -p 8080:8080 \
  -e READYROOM_DEMO_URL="https://demo.example.com/readyroom" \
  ens-products-page
```

`GET /healthz` returns `200 ok` for orchestrator health checks, and the image
carries a `HEALTHCHECK` that uses it.

---

## Demo links

Each product page has a demo button driven by one environment variable:

| Variable | Product |
|---|---|
| `READYROOM_DEMO_URL` | ReadyRoom |
| `CERTALERT_DEMO_URL` | CertAlert |
| `MFA_PORTAL_DEMO_URL` | MFA Portal |
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

`site/` holds templates, not the served files. The image copies it to
`/usr/share/nginx/template`, and `docker/docker-entrypoint.d/30-render-site.sh`
renders it into `/usr/share/nginx/html` on every start — the official nginx
entrypoint runs every executable in `/docker-entrypoint.d` before starting
nginx.

Each product page carries two mutually exclusive blocks, and exactly one
survives the render:

```html
<!--DEMO:READYROOM-->
  <a class="btn btn--primary" href="${READYROOM_DEMO_URL}" target="_blank" rel="noopener">Open the demo</a>
<!--/DEMO:READYROOM-->
<!--NODEMO:READYROOM-->
  <span class="btn btn--disabled" aria-disabled="true">Demo unavailable</span>
<!--/NODEMO:READYROOM-->
```

Substitution is restricted to the four `*_DEMO_URL` names, so no other `$NAME`
in the markup or CSS is touched. Non-HTML files are copied through byte for
byte.

To add another product, add its `NAME_DEMO_URL` to the `export` list, the
`enabled` list and the `vars` list in the render script, then use
`<!--DEMO:NAME-->` markers in its page.

### Rendering outside the container

The script takes `SITE_TEMPLATE_DIR` and `SITE_OUTPUT_DIR` overrides, which is
how it is exercised without Docker:

```bash
SITE_TEMPLATE_DIR=site SITE_OUTPUT_DIR=/tmp/out \
READYROOM_DEMO_URL=https://demo.example.com/readyroom \
  sh docker/docker-entrypoint.d/30-render-site.sh
```

Needs `envsubst` (GNU gettext) on `PATH`; the nginx image already ships it.

---

## Layout

```
site/                       Templates — the site itself
  index.html                Homepage: company intro + the four product cards
  contact.html              Contact form (opens the visitor's email app)
  404.html
  products/                 One page per product
  assets/css/site.css       The whole stylesheet
  assets/js/contact.js      Composes the contact form's email; the site's only script
  assets/favicon.svg
  assets/img/screens/       Product screenshots (JPEG, 1440 px wide)
nginx/default.conf          Server config: port 8080, gzip, /healthz, 404
docker/docker-entrypoint.d/
  30-render-site.sh         Resolves demo URLs at container start
Dockerfile
docker-compose.yml
.env.example
```

---

## Editing content

Everything is hand-written HTML — edit the file for the page you want to
change. The header, footer and nav are duplicated across the seven pages rather
than templated; with seven pages that is cheaper than introducing a build step,
but it does mean a nav change is a seven-file change.

Colours, spacing and type are CSS custom properties declared once at the top of
`site/assets/css/site.css`, with a dark-mode block right below. Re-skinning to
match brand colours means editing those tokens and nothing else.

### Contact form

`/contact.html` has no server side. On submit, `assets/js/contact.js` checks the
required fields and builds a `mailto:` link to `info@ens-solutions.com` with a
subject and a body laid out from the fields, which opens a draft in the
visitor's own email app — the message is sent from there, and nothing is stored
or sent by this site. Without JavaScript the form falls back to the browser's
native `mailto:` form submission.

- The recipient is the form's `action` and `data-recipient` attributes.
- Product pages link to `/contact.html?product=readyroom` (or `certalert`,
  `mfa-portal`, `directory-portal`) to pre-select the topic; the mapping is at the top of the script.
- The message is capped at 1,500 characters because some mail clients truncate
  long `mailto:` links.
- Visitors with no email app configured get nothing to happen, so the page
  also lists the address and phone number directly.

### External references

The footer of every page links to [ens-solutions.com](https://ens-solutions.com/)
and to the company
[LinkedIn page](https://www.linkedin.com/company/ens-solutions-llc/). Both are
plain links; nothing is embedded and no third-party script is loaded, so the
site still makes no outbound requests of its own.

### Screenshots

`site/assets/img/screens/` holds screenshots of ReadyRoom, CertAlert and
Directory Services Portal. They're shown on each product page under "See it in
use", and three of them on the homepage under "A look inside". Each was taken
at 1440 px wide from the product running locally against its own demo data:

- **ReadyRoom:** the `test/` Docker Compose stack, with the mock data from
  `seed-mock-data.sh`, signed in as `alice`. `alice` is the mock manager, made
  an administrator for the shots.
- **CertAlert:** the `dev` profile's embedded sample directory, signed in as
  `alice`.
- **Directory Services Portal:** the built-in demo directory, signed in as
  `admin`, after a few edits so the audit log had something to show.

MFA Portal has no screenshots because it has no implementation yet. To replace
a screenshot, keep the file name, or update the `src`, `width` and `height` in
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

The MFA Portal is expected to come from
[`rsa-operations-portal`](https://github.com/winllc/rsa-operations-portal),
which has no commits yet, so its page still describes a product that does not
exist and its feature copy is provisional — worth a read before this goes
public. It is the only product still marked "Coming soon".
