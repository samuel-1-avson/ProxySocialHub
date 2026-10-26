DROP INDEX IF EXISTS uq_cli_downloads_plat_arch_ver_pkg;
DROP INDEX IF EXISTS idx_cli_downloads_platform_arch_pkg;
ALTER TABLE cli_downloads DROP COLUMN IF EXISTS package_type;
