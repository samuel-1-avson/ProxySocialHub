"""Download and run ProxyHubb provider-cli / provider-node binaries."""

from __future__ import annotations

import os
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

DEFAULT_API_URL = "https://api.proxyhubb.com"

__version__ = "0.1.0"


def api_base() -> str:
    return os.environ.get("PROXYHUBB_API_URL", DEFAULT_API_URL).rstrip("/")


def resolve_platform() -> str:
    system = platform.system().lower()
    if system == "windows":
        return "windows"
    if system == "darwin":
        return "macos"
    return "linux"


def resolve_arch() -> str:
    machine = platform.machine().lower()
    if machine in ("x86_64", "amd64"):
        return "amd64"
    if machine in ("arm64", "aarch64"):
        return "arm64"
    raise RuntimeError(f"Unsupported architecture: {machine}")


def cache_dir() -> Path:
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(
            Path.home() / "AppData" / "Local"
        )
        return Path(base) / "proxyhubb" / "cli"
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "proxyhubb" / "cli"


def binary_name(package_type: str, plat: str) -> str:
    base = "provider-node" if package_type == "daemon" else "provider-cli"
    return f"{base}.exe" if plat == "windows" else base


def cached_binary_path(package_type: str, version: Optional[str] = None) -> Path:
    plat = resolve_platform()
    arch = resolve_arch()
    ver = version or os.environ.get("PROXYHUBB_CLI_VERSION") or "latest"
    return (
        cache_dir()
        / ver
        / plat
        / arch
        / package_type
        / binary_name(package_type, plat)
    )


def download_binary(
    *, package_type: str = "wrapper", force: bool = False
) -> Path:
    version = (os.environ.get("PROXYHUBB_CLI_VERSION") or "").strip()
    dest = cached_binary_path(package_type, version or "latest")
    if dest.exists() and not force:
        return dest

    params = {
        "platform": resolve_platform(),
        "arch": resolve_arch(),
        "package_type": package_type,
    }
    if version:
        params["version"] = version
    url = f"{api_base()}/v1/cli/download?{urlencode(params)}"

    try:
        with urlopen(url) as resp:
            data = resp.read()
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Failed to download {package_type}: HTTP {exc.code} {body}"
        ) from exc
    except URLError as exc:
        raise RuntimeError(f"Failed to download {package_type}: {exc}") from exc

    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix="proxyhubb-cli-", dir=str(dest.parent))
    try:
        with os.fdopen(fd, "wb") as tmp:
            tmp.write(data)
        if sys.platform != "win32":
            os.chmod(tmp_name, os.stat(tmp_name).st_mode | stat.S_IEXEC | 0o755)
        shutil.move(tmp_name, dest)
    finally:
        if os.path.exists(tmp_name):
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
    return dest


def parse_args(argv: list[str]) -> tuple[str, list[str]]:
    package_type = "wrapper"
    args = list(argv)
    passthrough: list[str] = []
    while args:
        a = args.pop(0)
        if a == "--daemon":
            package_type = "daemon"
            continue
        if a in ("--cli", "--wrapper"):
            package_type = "wrapper"
            continue
        passthrough = [a, *args]
        break
    return package_type, passthrough


def run(argv: Optional[list[str]] = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    package_type, passthrough = parse_args(argv)
    cmd = passthrough[0] if passthrough else None

    if cmd == "install":
        path = download_binary(package_type=package_type, force=True)
        print(path)
        return 0

    if cmd == "path":
        path = download_binary(package_type=package_type, force=False)
        print(path)
        return 0

    path = download_binary(package_type=package_type, force=False)
    completed = subprocess.run([str(path), *passthrough])
    return completed.returncode


def main() -> None:
    try:
        raise SystemExit(run())
    except Exception as exc:  # noqa: BLE001 — CLI top-level
        print(exc, file=sys.stderr)
        raise SystemExit(1) from exc
