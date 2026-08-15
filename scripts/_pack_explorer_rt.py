from pathlib import Path
import tarfile
import shutil

root = Path(r"F:/project/proxyhubb")
staging = root / "_tmp_explorer_rt"
if staging.exists():
    shutil.rmtree(staging)
src = root / "apps/web/src/app/explorer/layout.tsx"
dest = staging / "web/src/app/explorer/layout.tsx"
dest.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(src, dest)
tar_path = root / "explorer-rt-fix.tar.gz"
with tarfile.open(tar_path, "w:gz") as tar:
    tar.add(staging / "web", arcname="web")

lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "cd /opt/proxyhubb",
    "export ALLOW_EMERGENCY_WEB_BUILD=1",
    "export WEB_TAR=/tmp/explorer-rt-fix.tar.gz",
    "bash scripts/gcp-deploy-web-emergency-build.sh",
    "echo EXPLORER_RT_FIX_DONE",
]
(root / "_tmp_ops_explorer_rt.sh").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
print("packed", tar_path.stat().st_size)
