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

function parseFilenameFromDisposition(header) {
  if (!header) return "";
  const star = /filename\*=(?:UTF-8''|utf-8'')([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="([^"]+)"|filename=([^;]+)/i.exec(header);
  if (!plain) return "";
  return (plain[1] || plain[2] || "").trim().replace(/^"|"$/g, "");
}

async function resolveVersion(packageType) {
  const pinned = (process.env.PROXYHUBB_CLI_VERSION || "").trim();
  if (pinned) return pinned;

  const params = new URLSearchParams({
    platform: resolvePlatform(),
    arch: resolveArch(),
    package_type: packageType,
  });
  const url = `${apiBase()}/v1/cli/downloads/latest?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to resolve latest ${packageType}: ${res.status} ${text}`
    );
  }
  const data = await res.json();
  if (!data.version) {
    throw new Error(`Latest ${packageType} response missing version`);
  }
  return String(data.version);
}

function extractZipToBinary(zipPath, dest, packageType) {
  const tmpDir = fs.mkdtempSync(path.join(path.dirname(dest), "extract-"));
  try {
    let result;
    if (process.platform === "win32") {
      result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${tmpDir.replace(/'/g, "''")}' -Force`,
        ],
        { encoding: "utf8" }
      );
    } else {
      result = spawnSync("unzip", ["-o", zipPath, "-d", tmpDir], {
        encoding: "utf8",
      });
    }
    if (result.status !== 0) {
      throw new Error(
        `Failed to extract ${path.basename(zipPath)}: ${result.stderr || result.stdout || "unknown error"}`
      );
    }

    const want = binaryName(packageType, resolvePlatform());
    const prefix = packageType === "daemon" ? "provider-node" : "provider-cli";
    const found = [];
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else found.push(full);
      }
    };
    walk(tmpDir);

    const match =
      found.find((f) => path.basename(f).toLowerCase() === want.toLowerCase()) ||
      found.find((f) =>
        path.basename(f).toLowerCase().startsWith(prefix.toLowerCase())
      );
    if (!match) {
      throw new Error(
        `Zip ${path.basename(zipPath)} did not contain ${want} (or ${prefix}*)`
      );
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(match, dest);
    if (process.platform !== "win32") {
      fs.chmodSync(dest, 0o755);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function downloadBinary({ packageType = "wrapper", force = false } = {}) {
  const platform = resolvePlatform();
  const arch = resolveArch();
  const version = await resolveVersion(packageType);
  const dest = cachedBinaryPath(packageType, version);

  if (!force && fs.existsSync(dest)) {
    return dest;
  }

  const params = new URLSearchParams({
    platform,
    arch,
    package_type: packageType,
    version,
  });

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

  const filename =
    parseFilenameFromDisposition(res.headers.get("content-disposition")) ||
    res.headers.get("x-cli-filename") ||
    "";
  const headerVersion = (res.headers.get("x-cli-version") || "").trim();
  const effectiveVersion = headerVersion || version;
  const finalDest = cachedBinaryPath(packageType, effectiveVersion);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(finalDest), { recursive: true });

  if (/\.zip$/i.test(filename)) {
    const zipPath = `${finalDest}.download.zip`;
    fs.writeFileSync(zipPath, buf);
    try {
      extractZipToBinary(zipPath, finalDest, packageType);
    } finally {
      fs.rmSync(zipPath, { force: true });
    }
  } else {
    const tmp = `${finalDest}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, buf);
    if (process.platform !== "win32") {
      fs.chmodSync(tmp, 0o755);
    }
    fs.renameSync(tmp, finalDest);
  }
  return finalDest;
}

/** provider-cli delegates doctor/start/etc to provider-node via PROXYHUB_PROVIDER_NODE. */
async function ensureBinaries({ packageType = "wrapper", force = false } = {}) {
  if (packageType === "daemon") {
    const daemon = await downloadBinary({ packageType: "daemon", force });
    return { program: daemon, env: {} };
  }
  const [cli, daemon] = await Promise.all([
    downloadBinary({ packageType: "wrapper", force }),
    downloadBinary({ packageType: "daemon", force }),
  ]);
  return {
    program: cli,
    env: { PROXYHUB_PROVIDER_NODE: daemon },
  };
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
    const { program, env } = await ensureBinaries({ packageType, force: true });
    if (env.PROXYHUB_PROVIDER_NODE) {
      console.log(program);
      console.log(env.PROXYHUB_PROVIDER_NODE);
    } else {
      console.log(program);
    }
    return 0;
  }

  if (cmd === "path") {
    const { program, env } = await ensureBinaries({ packageType, force: false });
    if (env.PROXYHUB_PROVIDER_NODE) {
      console.log(program);
      console.log(env.PROXYHUB_PROVIDER_NODE);
    } else {
      console.log(program);
    }
    return 0;
  }

  const { program, env } = await ensureBinaries({ packageType, force: false });
  const result = spawnSync(program, passthrough, {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, ...env },
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
  resolveVersion,
  downloadBinary,
  ensureBinaries,
  parseArgs,
  main,
};
