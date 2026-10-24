#!/usr/bin/env bash
#
# Release downloads, end to end, against MinIO in Docker:
#
#   1. starts MinIO (its own named container and volume) and uploads a fake
#      release tree for two products: 1.0.0, 1.1.0 and 1.2.0-rc.1, latest.txt
#      and SHA256SUMS;
#   2. builds and starts the licensing service against it;
#   3. signs up and confirms an account (the mail goes to the service's log),
#      takes a CertAlert evaluation from the downloads page, and checks the
#      page lists CertAlert's versions and files and not ReadyRoom's;
#   4. follows a download's redirect and compares the bytes;
#   5. expects refusals for the other product, traversal, an unknown file and,
#      once an administrator revokes it, the revoked license.
#
# Removes only what it created (the container, its volume, a temp folder).
#
#   npm run test:releases               build first
#   SKIP_BUILD=1 npm run test:releases  use the existing dist/
#
# MINIO_IMAGE overrides the image. The default is Chainguard's MinIO build,
# pinned by digest: MinIO's own images (docker.io/minio/minio,
# quay.io/minio/minio) stopped being public when the community edition was
# archived.

set -euo pipefail

MINIO_IMAGE="${MINIO_IMAGE:-cgr.dev/chainguard/minio@sha256:c47b1779bfd12cdf5a4fcd3bd50671b8d66465fdae45271babc2fb467958b712}"
NAME="ens-releases-minio-test-$$"
VOLUME="$NAME-data"
LABEL="org.enssolutions.test=releases-minio"
BUCKET="ens-releases-test"
# Throwaway credentials for the throwaway MinIO.
MINIO_USER="ens-test"
MINIO_PASSWORD="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ens-releases-test.XXXXXX")"
PORTAL_PID=""

cleanup() {
    status=$?
    [ -n "$PORTAL_PID" ] && kill "$PORTAL_PID" 2>/dev/null || true
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker volume rm "$VOLUME" >/dev/null 2>&1 || true
    if [ $status -ne 0 ] && [ -f "$WORK/portal.log" ]; then
        echo "---- portal log (last 40 lines) ----" >&2
        tail -n 40 "$WORK/portal.log" >&2
    fi
    rm -rf "$WORK"
    exit $status
}
trap cleanup EXIT INT TERM

step() { printf '\n== %s\n' "$*"; }
ok() { printf '   ok: %s\n' "$*"; }
fail() { printf '   FAIL: %s\n' "$*" >&2; exit 1; }
expect_status() { # expected actual what
    [ "$2" = "$1" ] && ok "$3 -> $2" || fail "$3: expected $1, got $2"
}
free_port() { node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"; }

step "MinIO ($MINIO_IMAGE)"
docker volume create --label "$LABEL" "$VOLUME" >/dev/null
docker run -d --name "$NAME" --label "$LABEL" \
    --user 0:0 \
    -e MINIO_ROOT_USER="$MINIO_USER" -e MINIO_ROOT_PASSWORD="$MINIO_PASSWORD" \
    -v "$VOLUME:/data" -p 127.0.0.1::9000 \
    "$MINIO_IMAGE" server /data >/dev/null
S3_PORT="$(docker port "$NAME" 9000/tcp | head -n1 | sed 's/.*://')"
S3="http://127.0.0.1:$S3_PORT"
for _ in $(seq 1 30); do curl -fsS "$S3/minio/health/live" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "$S3/minio/health/live" >/dev/null || fail "MinIO did not start"
ok "listening on $S3"

step "Fake release tree"
mkdir -p "$WORK/tree"
(
    cd "$ROOT"
    S3="$S3" BUCKET="$BUCKET" TREE="$WORK/tree" AWS_ACCESS_KEY_ID="$MINIO_USER" AWS_SECRET_ACCESS_KEY="$MINIO_PASSWORD" \
        node --input-type=module -e '
import { CreateBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
const { S3: endpoint, BUCKET: Bucket, TREE } = process.env;
const s3 = new S3Client({ region: "us-east-1", endpoint, forcePathStyle: true });
await s3.send(new CreateBucketCommand({ Bucket }));
const put = async (Key, Body) => {
    await s3.send(new PutObjectCommand({ Bucket, Key, Body }));
    mkdirSync(`${TREE}/${Key}`.replace(/\/[^/]+$/, ""), { recursive: true });
    writeFileSync(`${TREE}/${Key}`, Body);
};
for (const prefix of ["cert-alert", "readyroom"]) {
    for (const v of ["1.0.0", "1.1.0", "1.2.0-rc.1"]) {
        const files = {
            [`${prefix}-${v}.tar.gz`]: randomBytes(3 * 1024 * 1024 + 17),
            [`${prefix}-${v}.tgz`]: randomBytes(4096),
            [`sbom-${prefix}.spdx.json`]: Buffer.from(JSON.stringify({ spdxVersion: "SPDX-2.3", name: `${prefix} ${v}` })),
        };
        let sums = "";
        for (const [name, body] of Object.entries(files)) {
            await put(`${prefix}/${v}/${name}`, body);
            sums += `${createHash("sha256").update(body).digest("hex")}  ${name}\n`;
        }
        await put(`${prefix}/${v}/SHA256SUMS`, Buffer.from(sums));
    }
    await put(`${prefix}/latest.txt`, Buffer.from("1.1.0\n"));
}
'
)
ok "cert-alert and readyroom: 1.0.0, 1.1.0, 1.2.0-rc.1, latest.txt = 1.1.0"

step "Licensing service"
if [ "${SKIP_BUILD:-}" != "1" ]; then
    (cd "$ROOT" && npm run build >"$WORK/build.log" 2>&1) || { tail -n 30 "$WORK/build.log" >&2; fail "build"; }
fi
PORT="$(free_port)"
BASE="http://127.0.0.1:$PORT"
(
    cd "$ROOT"
    exec env -i PATH="$PATH" HOME="$WORK" \
        HOST=127.0.0.1 PORT="$PORT" PUBLIC_URL="$BASE" COOKIE_SECURE=false \
        DATA_DIR="$WORK/data" ADMIN_EMAILS=boss@example.com ENS_AUDIT_STDOUT=false \
        RELEASES_S3_BUCKET="$BUCKET" RELEASES_S3_ENDPOINT="$S3" RELEASES_S3_FORCE_PATH_STYLE=true \
        RELEASES_URL_TTL=120 RELEASES_LISTING_TTL=1 \
        RELEASES_GPG_PUBLIC_KEY_URL=https://products.example.com/release-key.asc \
        AWS_ACCESS_KEY_ID="$MINIO_USER" AWS_SECRET_ACCESS_KEY="$MINIO_PASSWORD" \
        NODE_OPTIONS=--disable-warning=ExperimentalWarning \
        node dist/server/entry.mjs >"$WORK/portal.log" 2>&1
) &
PORTAL_PID=$!
for _ in $(seq 1 30); do curl -fsS "$BASE/api/licensing/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "$BASE/api/licensing/health" >/dev/null || fail "the service did not start"
ok "listening on $BASE"

PASSWORD="correct horse battery staple"
# post <jar> <path> <form fields...>: prints "status location"
post() {
    local jar=$1 path=$2
    shift 2
    local args=()
    for f in "$@"; do args+=(--data-urlencode "$f"); done
    curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' -b "$jar" -c "$jar" -H "Origin: $BASE" "${args[@]}" "$BASE$path"
}
status() { curl -sS -o /dev/null -w '%{http_code}' "$@"; }
signup_and_sign_in() { # jar email
    post "$1" /account/signup "name=Test User" "email=$2" "organization=Example Agency" "password=$PASSWORD" >/dev/null
    local link=""
    for _ in $(seq 1 10); do
        link="$(grep -A12 "email to $2" "$WORK/portal.log" | grep -o "$BASE/account/verify?token=[^[:space:]]*" | tail -n1 || true)"
        [ -n "$link" ] && break
        sleep 0.5
    done
    [ -n "$link" ] || fail "no confirmation link for $2 in the log"
    curl -sS -o /dev/null -b "$1" -c "$1" "$link"
    local r
    r="$(post "$1" /account/login "email=$2" "password=$PASSWORD")"
    [ "${r%% *}" = 303 ] || fail "sign-in for $2: $r"
}

step "Customer: sign up, confirm, evaluation from the downloads page"
JAR="$WORK/customer.jar"
signup_and_sign_in "$JAR" pat@example.com
ok "signed in as pat@example.com"
PAGE="$(curl -fsS -b "$JAR" "$BASE/account/downloads")"
grep -q 'Get a free evaluation' <<<"$PAGE" || fail "no evaluation button before taking one"
grep -q 'cert-alert-1.1.0.tar.gz' <<<"$PAGE" && fail "files listed before any license"
ok "no license yet: evaluation buttons, no files"
r="$(post "$JAR" /account/evaluation product=certalert next=/account/downloads)"
expect_status 303 "${r%% *}" "evaluation"
case "$r" in *"/account/downloads?notice=evaluation-downloads#certalert") ok "back to the downloads page" ;; *) fail "evaluation redirected to ${r#* }" ;; esac

step "Downloads page"
PAGE="$(curl -fsS -b "$JAR" "$BASE/account/downloads")"
for want in 'cert-alert-1.1.0.tar.gz' 'cert-alert-1.0.0.tar.gz' 'cert-alert-1.2.0-rc.1.tar.gz' 'Pre-release' 'Latest' \
    'sbom-cert-alert.spdx.json' 'sha256sum -c SHA256SUMS' 'release-key.asc' '3.1 MB'; do
    grep -q -- "$want" <<<"$PAGE" || fail "page is missing $want"
done
SUM="$(sha256sum "$WORK/tree/cert-alert/1.1.0/cert-alert-1.1.0.tar.gz" | cut -d' ' -f1)"
grep -q "$SUM" <<<"$PAGE" || fail "page is missing the package's SHA-256"
grep -q 'readyroom-1.1.0' <<<"$PAGE" && fail "ReadyRoom files listed without a ReadyRoom license"
# Latest first, then the pre-release, then 1.0.0.
order="$(grep -o 'class="mono">[0-9][^<]*' <<<"$PAGE" | sed 's/.*>//' | tr '\n' ' ')"
[ "$order" = "1.1.0 1.2.0-rc.1 1.0.0 " ] || fail "version order: $order"
ok "CertAlert: 1.1.0 (latest), 1.2.0-rc.1 (pre-release), 1.0.0, files with sizes and SHA-256; no ReadyRoom files"

step "Download"
FILE=/account/downloads/certalert/1.1.0/cert-alert-1.1.0.tar.gz
r="$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' -b "$JAR" "$BASE$FILE")"
expect_status 302 "${r%% *}" "$FILE"
case "${r#* }" in "$S3/$BUCKET/cert-alert/1.1.0/cert-alert-1.1.0.tar.gz?"*X-Amz-Signature=*) ok "presigned URL on MinIO" ;; *) fail "redirect to ${r#* }" ;; esac
curl -fsS -L -D "$WORK/headers" -o "$WORK/download" -b "$JAR" "$BASE$FILE"
[ "$(sha256sum "$WORK/download" | cut -d' ' -f1)" = "$SUM" ] || fail "downloaded bytes differ"
ok "bytes match ($(wc -c <"$WORK/download") bytes)"
grep -qi '^content-disposition: attachment; filename="cert-alert-1.1.0.tar.gz"' "$WORK/headers" || fail "no Content-Disposition from S3"
ok "saved as cert-alert-1.1.0.tar.gz"
(cd "$WORK" && mkdir -p check && cp download check/cert-alert-1.1.0.tar.gz &&
    curl -fsS -L -o check/SHA256SUMS -b "$JAR" "$BASE/account/downloads/certalert/1.1.0/SHA256SUMS" &&
    cd check && sha256sum -c --ignore-missing SHA256SUMS >/dev/null) || fail "sha256sum -c"
ok "sha256sum -c SHA256SUMS"

step "Refusals"
expect_status 403 "$(status -b "$JAR" "$BASE/account/downloads/readyroom/1.1.0/readyroom-1.1.0.tar.gz")" "other product"
expect_status 404 "$(status -b "$JAR" "$BASE/account/downloads/certalert/1.1.0/no-such-file.tar.gz")" "unknown file"
expect_status 404 "$(status -b "$JAR" "$BASE/account/downloads/certalert/1.1.0/cert-alert-1.0.0.tar.gz")" "another version's file"
expect_status 404 "$(status -b "$JAR" "$BASE/account/downloads/certalert/9.9.9/SHA256SUMS")" "unknown version"
expect_status 404 "$(status -b "$JAR" "$BASE/account/downloads/cert-alert/1.1.0/SHA256SUMS")" "S3 prefix as product"
expect_status 404 "$(status -b "$JAR" --path-as-is "$BASE/account/downloads/certalert/1.1.0/..%2F..%2Freadyroom%2F1.1.0%2Freadyroom-1.1.0.tar.gz")" "encoded traversal in file"
expect_status 404 "$(status -b "$JAR" --path-as-is "$BASE/account/downloads/certalert/..%2Flatest.txt/x")" "encoded traversal in version"
# Dot segments are collapsed by the server, with a 301 to the normalized
# path, before any route sees them; follow it, and the answer is still no.
expect_status 404 "$(status -L -b "$JAR" --path-as-is "$BASE/account/downloads/certalert/1.1.0/%2e%2e")" "encoded dot-dot, followed"
expect_status 403 "$(status -L -b "$JAR" --path-as-is "$BASE/account/downloads/certalert/1.1.0/../../readyroom/1.1.0/readyroom-1.1.0.tar.gz")" "raw traversal to another product, followed"
expect_status 303 "$(status "$BASE$FILE")" "signed out (to sign-in)"

step "Revoked license"
ADMIN_JAR="$WORK/admin.jar"
signup_and_sign_in "$ADMIN_JAR" boss@example.com
LICENSE="$(curl -fsS -b "$JAR" "$BASE/account" | grep -o 'lic_[0-9a-f]\{20\}' | head -n1)"
[ -n "$LICENSE" ] || fail "no license id on the account page"
expect_status 200 "$(status -b "$ADMIN_JAR" "$BASE/account/downloads/readyroom/1.1.0/readyroom-1.1.0.tar.gz" -o /dev/null -L)" "administrator downloads any product"
r="$(post "$ADMIN_JAR" "/admin/licenses/$LICENSE" action=revoke "reason=integration test")"
case "${r%% *}" in 2* | 3*) ok "administrator revoked $LICENSE" ;; *) fail "revoke: $r" ;; esac
expect_status 403 "$(status -b "$JAR" "$BASE$FILE")" "after revocation"
PAGE="$(curl -fsS -b "$JAR" "$BASE/account/downloads")"
grep -q 'cert-alert-1.1.0.tar.gz' <<<"$PAGE" && fail "page still lists CertAlert files after revocation"
ok "page no longer lists CertAlert files"

step "Audit trail"
AUDIT="$(curl -fsS -b "$ADMIN_JAR" "$BASE/admin/audit?action=release.downloaded")"
grep -q 'cert-alert-1.1.0.tar.gz' <<<"$AUDIT" || fail "release.downloaded not in the admin audit log"
DENIED="$(curl -fsS -b "$ADMIN_JAR" "$BASE/admin/audit?action=access.denied&q=release_not_entitled")"
grep -q '/account/downloads/readyroom/1.1.0/readyroom-1.1.0.tar.gz' <<<"$DENIED" || fail "access.denied not recorded"
grep -q 'Release downloaded' <<<"$(curl -fsS -b "$JAR" "$BASE/account")" || fail "not in the customer's own activity"
ok "release.downloaded and access.denied recorded; the customer sees their downloads"

printf '\nAll release download checks passed.\n'
