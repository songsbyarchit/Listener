#!/bin/bash
# Sign a built app bundle with the stable local identity when it exists,
# otherwise fall back to ad-hoc signing.
set -euo pipefail

APP="${1:?usage: sign.sh /path/to/App.app}"
BUNDLE_ID="${BUNDLE_ID:-com.archit.listnr}"
IDENTITY="Speekr Local Signing"
KEYCHAIN="$HOME/Library/Keychains/speakr-signing.keychain-db"
PW_FILE="$HOME/.speakr/signing/keychain-password"

if [[ -f "$KEYCHAIN" && -f "$PW_FILE" ]]; then
  security unlock-keychain -p "$(cat "$PW_FILE")" "$KEYCHAIN" >/dev/null 2>&1 || true
  if codesign --force --sign "$IDENTITY" --keychain "$KEYCHAIN" \
      --identifier "$BUNDLE_ID" "$APP" 2>/dev/null; then
    exit 0
  fi
  echo "Stable signing failed; falling back to ad-hoc." >&2
fi

codesign --force --sign - --identifier "$BUNDLE_ID" "$APP"
