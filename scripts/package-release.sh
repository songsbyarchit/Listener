#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
OUT="$ROOT/dist"
rm -rf "$OUT"
mkdir -p "$OUT"

echo "Packaging LISTNR $VERSION"

zip -qr "$OUT/listnr-extension-$VERSION.zip" \
  manifest.json ui extension icons README.md INSTALL.md

zip -qr "$OUT/listnr-server-$VERSION.zip" \
  package.json package-lock.json server ui manifest.json extension icons \
  Dockerfile docker-entrypoint.sh docker-compose.yml README.md INSTALL.md docs

zip -qr "$OUT/listnr-source-$VERSION.zip" . \
  -x 'node_modules/*' 'data/*' 'dist/*' '.git/*' '*.DS_Store' '.env' '.env.*'

(
  cd "$OUT"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum ./*.zip > SHA256SUMS
  else
    shasum -a 256 ./*.zip > SHA256SUMS
  fi
)

echo ""
ls -lh "$OUT"
echo ""
cat "$OUT/SHA256SUMS"
