"""Download and run ProxyHubb provider-cli / provider-node binaries."""

from __future__ import annotations

import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen
import json

DEFAULT_API_URL = "https://api.proxyhubb.com"

__version__ = "0.1.3"


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


def _parse_filename(content_disposition: Optional[str]) -> str:
    if not content_disposition:
        return ""
    star = re.search(r"filename\*=(?:UTF-8''|utf-8'')([^;]+)", content_disposition, re.I)
    if star:
        try:
            from urllib.parse import unquote

            return unquote(star.group(1).strip().strip('"'))
        except Exception:
            pass
    plain = re.search(r'filename="([^"]+)"|filename=([^;]+)', content_disposition, re.I)
    if not plain:
        return ""
    return (plain.group(1) or plain.group(2) or "").strip().strip('"')


def resolve_version(package_type: str) -> str:
    pinned = (os.environ.get("PROXYHUBB_CLI_VERSION") or "").strip()
    if pinned:
        return pinned
    params = {
        "platform": resolve_platform(),
        "arch": resolve_arch(),
        "package_type": package_type,
    }
    url = f"{api_base()}/v1/cli/downloads/latest?{urlencode(params)}"
    try:
        with urlopen(url) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Failed to resolve latest {package_type}: HTTP {exc.code} {body}"
        ) from exc
    except URLError as exc:
        raise RuntimeError(f"Failed to resolve latest {package_type}: {exc}") from exc
    version = str(data.get("version") or "").strip()
    if not version:
        raise RuntimeError(f"Latest {package_type} response missing version")
    return version


def _extract_zip_to_binary(zip_path: Path, dest: Path, package_type: str) -> None:
    want = binary_name(package_type, resolve_platform())
    prefix = "provider-node" if package_type == "daemon" else "provider-cli"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        members = zf.namelist()
        match = next(
            (m for m in members if Path(m).name.lower() == want.lower()),
            None,
        )
        if match is None:
            match = next(
                (
                    m
                    for m in members
                    if Path(m).name.lower().startswith(prefix.lower())
                    and not m.endswith("/")
                ),
                None,
            )
        if match is None:
            raise RuntimeError(
                f"Zip {zip_path.name} did not contain {want} (or {prefix}*)"
            )
        with zf.open(match) as src, open(dest, "wb") as out:
            shutil.copyfileobj(src, out)
    if sys.platform != "win32":
        dest.chmod(dest.stat().st_mode | stat.S_IEXEC | 0o755)


def download_binary(
    *, package_type: str = "wrapper", force: bool = False
) -> Path:
    version = resolve_version(package_type)
    dest = cached_binary_path(package_type, version)
    if dest.exists() and not force:
        return dest

    params = {
        "platform": resolve_platform(),
        "arch": resolve_arch(),
        "package_type": package_type,
        "version": version,
    }
    url = f"{api_base()}/v1/cli/download?{urlencode(params)}"

    try:
        with urlopen(url) as resp:
            data = resp.read()
            filename = _parse_filename(resp.headers.get("Content-Disposition"))
            header_version = (resp.headers.get("X-CLI-Version") or "").strip()
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Failed to download {package_type}: HTTP {exc.code} {body}"
        ) from exc
    except URLError as exc:
        raise RuntimeError(f"Failed to download {package_type}: {exc}") from exc

    final_dest = cached_binary_path(package_type, header_version or version)
    final_dest.parent.mkdir(parents=True, exist_ok=True)

    if filename.lower().endswith(".zip"):
        fd, tmp_name = tempfile.mkstemp(
            prefix="proxyhubb-cli-", suffix=".zip", dir=str(final_dest.parent)
        )
        try:
            with os.fdopen(fd, "wb") as tmp:
                tmp.write(data)
            _extract_zip_to_binary(Path(tmp_name), final_dest, package_type)
        finally:
            if os.path.exists(tmp_name):
                try:
                    os.unlink(tmp_name)
                except OSError:
                    pass
        return final_dest

    fd, tmp_name = tempfile.mkstemp(prefix="proxyhubb-cli-", dir=str(final_dest.parent))
    try:
        with os.fdopen(fd, "wb") as tmp:
            tmp.write(data)
        if sys.platform != "win32":
            os.chmod(tmp_name, os.stat(tmp_name).st_mode | stat.S_IEXEC | 0o755)
        shutil.move(tmp_name, final_dest)
    finally:
        if os.path.exists(tmp_name):
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
    return final_dest


def ensure_binaries(
    *, package_type: str = "wrapper", force: bool = False
) -> tuple[Path, dict[str, str]]:
    """Return (program, extra_env). CLI mode also downloads provider-node."""
    if package_type == "daemon":
        daemon = download_binary(package_type="daemon", force=force)
        return daemon, {}
    cli = download_binary(package_type="wrapper", force=force)
    daemon = download_binary(package_type="daemon", force=force)
    return cli, {"PROXYHUB_PROVIDER_NODE": str(daemon)}


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

    if cmd in ("install", "path"):
        force = cmd == "install"
        program, extra_env = ensure_binaries(package_type=package_type, force=force)
        print(program)
        if "PROXYHUB_PROVIDER_NODE" in extra_env:
            print(extra_env["PROXYHUB_PROVIDER_NODE"])
        return 0

    program, extra_env = ensure_binaries(package_type=package_type, force=False)
    env = os.environ.copy()
    env.update(extra_env)
    completed = subprocess.run([str(program), *passthrough], env=env)
    return completed.returncode


def main() -> None:
    try:
        raise SystemExit(run())
    except Exception as exc:  # noqa: BLE001 — CLI top-level
        print(exc, file=sys.stderr)
        raise SystemExit(1) from exc
