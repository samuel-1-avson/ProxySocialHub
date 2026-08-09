from proxyhubb_provider.cli import (
    ensure_binaries,
    parse_args,
    resolve_arch,
    resolve_platform,
    resolve_version,
)


def test_parse_daemon():
    package_type, passthrough = parse_args(["--daemon", "doctor", "--json"])
    assert package_type == "daemon"
    assert passthrough == ["doctor", "--json"]


def test_parse_wrapper_default():
    package_type, passthrough = parse_args(["join", "--key", "x"])
    assert package_type == "wrapper"
    assert passthrough == ["join", "--key", "x"]


def test_resolve_platform_arch():
    assert resolve_platform() in ("windows", "macos", "linux")
    assert resolve_arch() in ("amd64", "arm64")


def test_resolve_version_pinned(monkeypatch):
    monkeypatch.setenv("PROXYHUBB_CLI_VERSION", "1.0.5")
    assert resolve_version("daemon") == "1.0.5"


def test_ensure_binaries_sets_daemon_env(monkeypatch, tmp_path):
    cli = tmp_path / "provider-cli.exe"
    daemon = tmp_path / "provider-node.exe"
    cli.write_bytes(b"cli")
    daemon.write_bytes(b"node")

    def fake_download(*, package_type="wrapper", force=False):
        return daemon if package_type == "daemon" else cli

    monkeypatch.setattr("proxyhubb_provider.cli.download_binary", fake_download)
    program, env = ensure_binaries(package_type="wrapper")
    assert program == cli
    assert env["PROXYHUB_PROVIDER_NODE"] == str(daemon)
