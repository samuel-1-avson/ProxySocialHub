from proxyhubb_provider.cli import parse_args, resolve_arch, resolve_platform


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
