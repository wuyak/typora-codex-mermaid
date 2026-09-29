#!/bin/sh
set -u

SOURCE_ROOT=$(cd -- "$(dirname -- "$0")" && pwd)
STATUS=0
if [ ! -x /usr/bin/perl ]; then
  printf '%s\n' 'Uninstall failed: /usr/bin/perl is required on macOS.' >&2
  STATUS=1
else
  /usr/bin/perl "$SOURCE_ROOT/scripts/manage.pl" uninstall --source-root "$SOURCE_ROOT" "$@"
  STATUS=$?
fi

if [ -t 0 ] && [ -t 1 ]; then
  if [ "$STATUS" -eq 0 ]; then
    printf '%s\n' 'Uninstallation finished. Press Return to close.'
  else
    printf '%s\n' 'Uninstallation failed. Press Return to close.' >&2
  fi
  IFS= read -r _ || true
fi
exit "$STATUS"
