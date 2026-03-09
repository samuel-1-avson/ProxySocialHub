-- Seed default forum categories
INSERT INTO forum_categories (id, name, slug, description, sort_order, created_at, updated_at) VALUES
(gen_random_uuid(), 'General Discussion', 'general', 'General topics and discussions about proxy services', 1, NOW(), NOW()),
(gen_random_uuid(), 'Technical Support', 'support', 'Get help with technical issues and troubleshooting', 2, NOW(), NOW()),
(gen_random_uuid(), 'Feature Requests', 'features', 'Suggest new features and improvements', 3, NOW(), NOW()),
(gen_random_uuid(), 'Provider Showcase', 'showcase', 'Share your proxy setups and configurations', 4, NOW(), NOW()),
(gen_random_uuid(), 'Buying & Selling', 'marketplace', 'Discuss proxy purchases, deals, and recommendations', 5, NOW(), NOW()),
(gen_random_uuid(), 'Announcements', 'announcements', 'Official announcements and updates from the team', 6, NOW(), NOW());
