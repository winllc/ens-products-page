#!/bin/sh
#
# Renders the site templates into the directory nginx serves, resolving the
# per-product demo URLs from the environment.
#
# The official nginx image runs every executable /docker-entrypoint.d/*.sh
# before starting nginx, so this happens once per container start. That is the
# point: the same image can be pointed at a different demo environment by
# changing an environment variable, with no rebuild.
#
# Each product page carries two mutually exclusive blocks:
#
#     <!--DEMO:READYROOM-->    ... shown when READYROOM_DEMO_URL is set
#     <!--/DEMO:READYROOM-->
#     <!--NODEMO:READYROOM-->  ... shown when it is not
#     <!--/NODEMO:READYROOM-->
#
# Exactly one survives, and the ${..._DEMO_URL} placeholder inside the
# surviving DEMO block is substituted. A product with no configured URL
# therefore renders a real "coming soon" state rather than a dead link.

set -eu

# Overridable so the render can be exercised outside the container.
SRC="${SITE_TEMPLATE_DIR:-/usr/share/nginx/template}"
DST="${SITE_OUTPUT_DIR:-/usr/share/nginx/html}"

READYROOM_DEMO_URL="${READYROOM_DEMO_URL:-}"
CERTALERT_DEMO_URL="${CERTALERT_DEMO_URL:-}"
MFA_PORTAL_DEMO_URL="${MFA_PORTAL_DEMO_URL:-}"
DIRECTORY_PORTAL_DEMO_URL="${DIRECTORY_PORTAL_DEMO_URL:-}"
export READYROOM_DEMO_URL CERTALERT_DEMO_URL MFA_PORTAL_DEMO_URL DIRECTORY_PORTAL_DEMO_URL

# Space-delimited list of the products that have a demo to link to, padded at
# both ends so a match can be tested as " NAME " and READYROOM cannot match
# inside a longer name. Written as if-statements rather than "test && assign":
# under `set -e` a trailing AND-list whose test fails is an ambiguous case
# across shells, and this runs on BusyBox ash.
enabled=" "
if [ -n "$READYROOM_DEMO_URL" ];  then enabled="${enabled}READYROOM ";  fi
if [ -n "$CERTALERT_DEMO_URL" ];  then enabled="${enabled}CERTALERT ";  fi
if [ -n "$MFA_PORTAL_DEMO_URL" ]; then enabled="${enabled}MFA_PORTAL "; fi
if [ -n "$DIRECTORY_PORTAL_DEMO_URL" ]; then enabled="${enabled}DIRECTORY_PORTAL "; fi

if [ "$enabled" = " " ]; then
    echo "30-render-site.sh: no demo URLs configured; all demo links render as coming soon"
else
    echo "30-render-site.sh: demo links enabled for:$enabled"
fi

# Restrict substitution to the demo URLs. Without an explicit list envsubst
# would also eat any other $NAME in the CSS or markup.
vars='${READYROOM_DEMO_URL} ${CERTALERT_DEMO_URL} ${MFA_PORTAL_DEMO_URL} ${DIRECTORY_PORTAL_DEMO_URL}'

rm -rf "$DST"
mkdir -p "$DST"

find "$SRC" -type f | while IFS= read -r src; do
    rel=${src#"$SRC"/}
    dst="$DST/$rel"
    mkdir -p "$(dirname "$dst")"

    case "$rel" in
        *.html)
            awk -v enabled="$enabled" '
                function key(line,   m) {
                    # Pull PRODUCT out of <!--DEMO:PRODUCT--> or <!--NODEMO:PRODUCT-->
                    m = line
                    sub(/^.*(NO)?DEMO:/, "", m)
                    sub(/-->.*$/, "", m)
                    return m
                }
                function on(k) { return index(enabled, " " k " ") > 0 }

                /<!--NODEMO:[A-Z_]+-->/  { skip =  on(key($0)); next }
                /<!--DEMO:[A-Z_]+-->/    { skip = !on(key($0)); next }
                /<!--\/(NO)?DEMO:[A-Z_]+-->/ { skip = 0; next }
                !skip { print }
            ' "$src" | envsubst "$vars" > "$dst"
            ;;
        *)
            cp "$src" "$dst"
            ;;
    esac
done

# Cache busting. nginx lets browsers keep /assets/ for a week, but the pages
# themselves are never cached. So every asset reference in a page gets the
# file's content hash as a query string: when a stylesheet, script or image
# changes, its URL changes, and a browser holding last week's copy fetches the
# new one. Without this, a returning visitor gets new pages styled by an old
# stylesheet.
busting="$(mktemp)"
find "$DST/assets" -type f | while IFS= read -r f; do
    url="/${f#"$DST"/}"
    hash="$(md5sum "$f" | cut -c1-10)"
    # Escape the URL for use as a sed pattern ('#' is the delimiter).
    re="$(printf '%s' "$url" | sed 's/[].[*^$\\#]/\\&/g')"
    # Only a complete reference: the URL directly followed by its closing quote.
    printf 's#"%s"#"%s?v=%s"#g\n' "$re" "$url" "$hash"
done > "$busting"

find "$DST" -type f -name '*.html' | while IFS= read -r page; do
    sed -i -f "$busting" "$page"
done
rm -f "$busting"
echo "30-render-site.sh: asset URLs versioned by content hash"
