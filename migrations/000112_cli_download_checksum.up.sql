-- Widen CLI download checksum column so full SHA-256 hex (64 chars) is never truncated.
ALTER TABLE cli_downloads
    ALTER COLUMN checksum TYPE varchar(128);
