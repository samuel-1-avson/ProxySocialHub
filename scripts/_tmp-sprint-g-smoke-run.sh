#!/usr/bin/env bash
set -euo pipefail
rm -f /tmp/sprint-g-smoke.log
bash /tmp/sprint-g-smoke.sh > /tmp/sprint-g-smoke.log 2>&1
ec=$?
echo "EXIT=$ec"
tail -80 /tmp/sprint-g-smoke.log
exit $ec
