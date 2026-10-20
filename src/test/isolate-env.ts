/*
 * Runs before every test file (see vitest.config.ts): clears the licensing
 * service's settings from the environment, so the tests see only what they
 * set themselves.
 *
 * Without this, tests inherit whatever the shell or the build has. Coolify
 * passes every "build variable" into `docker build` as an ARG, which `RUN npm
 * test` then sees as an environment variable: with the deployment's SMTP_URL
 * the tests tried to send mail through the real relay, with
 * ENS_AUDIT_SPLUNK_TOKEN_FILE they tried to read a secret that only exists at
 * run time, and with LICENSE_SIGNING_KEY_P256 every license came out
 * dual-signed. Each broke the image build.
 *
 * Prefixes catch settings added later; WRITE_FIXTURES is a test switch and
 * stays.
 */

const PREFIXES = ['LICENSE_', 'ENS_', 'SMTP_', 'MAIL_'];
const NAMES = ['PUBLIC_URL', 'ADMIN_EMAILS', 'REQUIRE_EMAIL_VERIFICATION', 'COOKIE_SECURE', 'DATA_DIR', 'LICENSING_DB', 'DOCS_URL'];

for (const name of Object.keys(process.env)) {
    if (NAMES.includes(name) || PREFIXES.some((p) => name.startsWith(p))) {
        delete process.env[name];
    }
}
