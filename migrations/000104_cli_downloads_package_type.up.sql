-- CLI package types: daemon (provider-node), wrapper (proxyhubb-cli / provider-cli), bundle (zip/tar).
-- Required by control-api SeedCLIDownloads + /v1/cli/download filters.

ALTER TABLE cli_downloads
    ADD COLUMN IF NOT EXISTS package_type VARCHAR(20) NOT NULL DEFAULT 'daemon';

-- Infer package_type from existing filenames where possible
UPDATE cli_downloads
SET package_type = CASE
    WHEN filename ILIKE 'provider-cli-%' THEN 'wrapper'
    WHEN filename ILIKE 'provider-bundle-%' THEN 'bundle'
    ELSE 'daemon'
END
WHERE package_type = 'daemon'
  AND (filename ILIKE 'provider-cli-%' OR filename ILIKE 'provider-bundle-%');

CREATE INDEX IF NOT EXISTS idx_cli_downloads_platform_arch_pkg
    ON cli_downloads (platform, arch, package_type);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cli_downloads_plat_arch_ver_pkg
    ON cli_downloads (platform, arch, version, package_type);
