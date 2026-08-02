-- User GORM model includes ISP on profiles; early migrations omitted it.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS isp VARCHAR(100);
