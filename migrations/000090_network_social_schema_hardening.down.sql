DROP INDEX IF EXISTS idx_forum_posts_thread_created;
DROP INDEX IF EXISTS idx_forum_threads_category_latest;
DROP INDEX IF EXISTS idx_notifications_user_unread_created;
DROP INDEX IF EXISTS idx_saved_listings_user_listing;
DROP INDEX IF EXISTS idx_messages_conversation_unread;
DROP INDEX IF EXISTS idx_messages_conversation_created;
DROP INDEX IF EXISTS idx_conversations_participant2_last;
DROP INDEX IF EXISTS idx_conversations_participant1_last;
DROP INDEX IF EXISTS idx_user_badges_badge;
DROP INDEX IF EXISTS idx_forum_votes_thread;
DROP INDEX IF EXISTS idx_forum_votes_post;
DROP INDEX IF EXISTS idx_forum_votes_user_thread;
DROP INDEX IF EXISTS idx_forum_votes_user_post;
DROP INDEX IF EXISTS idx_friendships_friend_id;
DROP INDEX IF EXISTS idx_friendships_user_friend;
DROP INDEX IF EXISTS idx_friend_requests_pending_pair;
DROP INDEX IF EXISTS idx_friend_requests_receiver_status;
DROP INDEX IF EXISTS idx_friend_requests_sender_status;

-- Keep tables created by the up migration in place to avoid destructive
-- rollback surprises on deployments that already stored social data in them.
