-- Firefox pairings do not fit a Chrome-sized column; drop them before narrowing.
DELETE FROM public.extension_devices WHERE length(extension_id) > 32;

ALTER TABLE public.extension_devices
    ALTER COLUMN extension_id TYPE VARCHAR(32);
