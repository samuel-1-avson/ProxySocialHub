-- Firefox add-on ids (extension@proxyhubb.com, {uuid}) are longer than Chrome's
-- 32-char ids, so pairing a Firefox browser needs a wider column.
ALTER TABLE public.extension_devices
    ALTER COLUMN extension_id TYPE VARCHAR(128);
