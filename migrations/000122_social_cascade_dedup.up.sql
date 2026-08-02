-- P2 MIG-02: notification dedup index + CASCADE FKs for social graphs.

-- follows
ALTER TABLE public.follows
    DROP CONSTRAINT IF EXISTS follows_follower_id_fkey,
    DROP CONSTRAINT IF EXISTS follows_following_id_fkey;

ALTER TABLE public.follows
    ADD CONSTRAINT follows_follower_id_fkey
        FOREIGN KEY (follower_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    ADD CONSTRAINT follows_following_id_fkey
        FOREIGN KEY (following_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- friendships (000090: user_id / friend_id)
DO $$
BEGIN
    IF to_regclass('public.friendships') IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='friendships' AND column_name='user_id'
       )
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='friendships' AND column_name='friend_id'
       ) THEN
        ALTER TABLE public.friendships
            DROP CONSTRAINT IF EXISTS friendships_user_id_fkey,
            DROP CONSTRAINT IF EXISTS friendships_friend_id_fkey;
        ALTER TABLE public.friendships
            ADD CONSTRAINT friendships_user_id_fkey
                FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
            ADD CONSTRAINT friendships_friend_id_fkey
                FOREIGN KEY (friend_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
    END IF;
END $$;

-- friend_requests
DO $$
BEGIN
    IF to_regclass('public.friend_requests') IS NOT NULL THEN
        ALTER TABLE public.friend_requests
            DROP CONSTRAINT IF EXISTS friend_requests_sender_id_fkey,
            DROP CONSTRAINT IF EXISTS friend_requests_receiver_id_fkey;
        ALTER TABLE public.friend_requests
            ADD CONSTRAINT friend_requests_sender_id_fkey
                FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
            ADD CONSTRAINT friend_requests_receiver_id_fkey
                FOREIGN KEY (receiver_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
    END IF;
END $$;

-- notifications (user_id already FK; harden actor_id to CASCADE)
ALTER TABLE public.notifications
    DROP CONSTRAINT IF EXISTS notifications_actor_id_fkey;

ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_actor_id_fkey
        FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- feed_events: schema has actor_id only (no user_id column in 000054)
ALTER TABLE public.feed_events
    DROP CONSTRAINT IF EXISTS feed_events_actor_id_fkey,
    DROP CONSTRAINT IF EXISTS feed_events_user_id_fkey;

ALTER TABLE public.feed_events
    ADD CONSTRAINT feed_events_actor_id_fkey
        FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notifications_dedup
    ON public.notifications (user_id, type, actor_id, created_at)
    WHERE is_read = false;
