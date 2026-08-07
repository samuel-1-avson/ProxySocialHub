"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_API_URL = "https://api.proxyhubb.com";

function apiBase() {
  return (process.env.PROXYHUBB_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
}

function resolvePlatform() {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    default:
      return "linux";
  }
}

function resolveArch() {
  const a = process.arch;
  if (a === "x64" || a === "amd64") return "amd64";
  if (a === "arm64") return "arm64";
  throw new Error(`Unsupported architecture: ${a}`);
}

function cacheDir() {
  if (process.platform === "win32") {
    const base =
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "proxyhubb", "cli");
  }
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(base, "proxyhubb", "cli");
}

function binaryName(packageType, platform) {
  const base = packageType === "daemon" ? "provider-node" : "provider-cli";
  return platform === "windows" ? `${base}.exe` : base;
}

function cachedBinaryPath(packageType, version) {
  const platform = resolvePlatform();
  const arch = resolveArch();
  const ver = version || process.env.PROXYHUBB_CLI_VERSION || "latest";
  return path.join(
    cacheDir(),
    ver,
    platform,
    arch,
    packageType,
    binaryName(packageType, platform)
  );
}

async function downloadBinary({ packageType = "wrapper", force = false } = {}) {
  const platform = resolvePlatform();
  const arch = resolveArch();
  const version = (process.env.PROXYHUBB_CLI_VERSION || "").trim();
  const dest = cachedBinaryPath(packageType, version || "latest");

  if (!force && fs.existsSync(dest)) {
    return dest;
  }

  const params = new URLSearchParams({
    platform,
    arch,
    package_type: packageType,
  });
  if (version) params.set("version", version);

  const url = `${apiBase()}/v1/cli/download?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = JSON.parse(text).error || text;
    } catch {
      /* keep text */
    }
    throw new Error(
      `Failed to download ${packageType} for ${platform}/${arch}: ${res.status} ${message}`
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, buf);
  if (process.platform !== "win32") {
    fs.chmodSync(tmp, 0o755);
  }
  fs.renameSync(tmp, dest);
  return dest;
}

function parseArgs(argv) {
  const args = [...argv];
  let packageType = "wrapper";
  const passthrough = [];

  while (args.length) {
    const a = args.shift();
    if (a === "--daemon") {
      packageType = "daemon";
      continue;
    }
    if (a === "--cli" || a === "--wrapper") {
      packageType = "wrapper";
      continue;
    }
    passthrough.push(a);
    passthrough.push(...args);
    break;
  }

  return { packageType, passthrough };
}

async function main(argv = process.argv.slice(2)) {
  const { packageType, passthrough } = parseArgs(argv);
  const cmd = passthrough[0];

  if (cmd === "install") {
    const dest = await downloadBinary({ packageType, force: true });
    console.log(dest);
    return 0;
  }

  if (cmd === "path") {
    const dest = await downloadBinary({ packageType, force: false });
    console.log(dest);
    return 0;
  }

  const dest = await downloadBinary({ packageType, force: false });
  const result = spawnSync(dest, passthrough, {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status == null ? 1 : result.status;
}

module.exports = {
  apiBase,
  resolvePlatform,
  resolveArch,
  cacheDir,
  cachedBinaryPath,
  downloadBinary,
  parseArgs,
  main,
};
