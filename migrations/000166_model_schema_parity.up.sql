-- Model/schema parity. The API's GORM models use these tables and columns, but no
-- migration created them: they existed only while the API ran GORM AutoMigrate (removed
-- in P3-14), and the test harness kept AutoMigrating them, so tests passed while a
-- database built from migrations (every deploy, including gcp-testnet) lacked them and
-- the code paths that touch them failed (audit logging, provider scores, uptime checks,
-- session metrics, reviews, circles, teams, ...).
--
-- DDL is what GORM generates for the current models (CreateTable / AddColumn), made
-- idempotent so a database that still has AutoMigrate-era tables is left as is.
-- Columns that already exist under another name are mapped in the models instead
-- (enable_https, price_multiplier_https, changelog_cid, rollback_plan_cid,
-- rotation_interval_seconds).

CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" uuid,
    "event_type" varchar(50) NOT NULL,
    "severity" varchar(20) DEFAULT 'info',
    "actor_id" uuid,
    "actor_type" varchar(20),
    "actor_email" varchar(255),
    "target_type" varchar(50),
    "target_id" varchar(64),
    "ip_address" varchar(45),
    "user_agent" text,
    "country" varchar(2),
    "session_id" uuid,
    "description" text,
    "metadata" jsonb,
    "success" boolean DEFAULT true,
    "error_code" varchar(50),
    "created_at" timestamptz,
    PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_audit_created" ON "audit_logs" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_audit_ip" ON "audit_logs" ("ip_address");
CREATE INDEX IF NOT EXISTS "idx_audit_actor" ON "audit_logs" ("actor_id");
CREATE INDEX IF NOT EXISTS "idx_audit_type" ON "audit_logs" ("event_type");

CREATE TABLE IF NOT EXISTS "blocks" (
    "blocker_id" uuid,
    "blocked_id" uuid,
    "reason" varchar(255),
    "created_at" timestamptz,
    PRIMARY KEY ("blocker_id","blocked_id")
);

CREATE TABLE IF NOT EXISTS "circle_invites" (
    "id" uuid DEFAULT uuid_generate_v4(),
    "circle_id" uuid NOT NULL,
    "inviter_id" uuid NOT NULL,
    "invitee_id" uuid NOT NULL,
    "status" varchar(20) DEFAULT 'pending',
    "expires_at" timestamptz,
    "created_at" timestamptz,
    PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_circle_invites_invitee_id" ON "circle_invites" ("invitee_id");
CREATE INDEX IF NOT EXISTS "idx_circle_invites_circle_id" ON "circle_invites" ("circle_id");

CREATE TABLE IF NOT EXISTS "circle_leases" (
    "id" uuid DEFAULT uuid_generate_v4(),
    "circle_id" uuid NOT NULL,
    "lessee_user_id" uuid NOT NULL,
    "status" varchar(20) DEFAULT 'active',
    "bandwidth_gb" decimal NOT NULL,
    "price_per_gb" decimal NOT NULL,
    "total_price" decimal NOT NULL,
    "bandwidth_used_gb" decimal DEFAULT 0,
    "starts_at" timestamptz,
    "expires_at" timestamptz,
    "created_at" timestamptz,
    PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_circle_leases_lessee_user_id" ON "circle_leases" ("lessee_user_id");
CREATE INDEX IF NOT EXISTS "idx_circle_leases_circle_id" ON "circle_leases" ("circle_id");

CREATE TABLE IF NOT EXISTS "circle_posts" (
    "id" uuid DEFAULT uuid_generate_v4(),
    "circle_id" uuid NOT NULL,
    "author_id" uuid NOT NULL,
    "content" text NOT NULL,
    "pinned" boolean DEFAULT false,
    "created_at" timestamptz,
    "updated_at" timestamptz,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_circle_posts_author" FOREIGN KEY ("author_id") REFERENCES "profiles"("id")
);
CREATE INDEX IF NOT EXISTS "idx_circle_posts_circle_id" ON "circle_posts" ("circle_id");

CREATE TABLE IF NOT EXISTS "circle_slas" (
    "id" uuid DEFAULT uuid_generate_v4(),
    "circle_id" uuid NOT NULL,
    "uptime_guarantee" decimal DEFAULT 99,
    "max_latency_ms" bigint DEFAULT 100,
    "min_success_rate" decimal DEFAULT 0.95,
    "support_tier" text DEFAULT 'standard',
    "max_concurrency" bigint DEFAULT 100,
    "incident_response" bigint DEFAULT 60,
    "created_at" timestamptz,
    "updated_at" timestamptz,
    PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_circle_slas_circle_id" ON "circle_slas" ("circle_id");

CREATE TABLE IF NOT EXISTS "circle_stats" (
    "id" uuid DEFAULT uuid_generate_v4(),
    "circle_id" uuid NOT NULL,
    "date" timestamptz NOT NULL,
    "total_bytes" bigint DEFAULT 0,
    "total_revenue" decimal DEFAULT 0,
    "active_nodes" bigint DEFAULT 0,
    "uptime" decimal DEFAULT 0,
    "created_at" timestamptz,
    PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_circle_stats_date" ON "circle_stats" ("date");
CREATE INDEX IF NOT EXISTS "idx_circle_stats_circle_id" ON "circle_stats" ("circle_id");

CREATE TABLE IF NOT EXISTS "dispute_juries" (
    "id" uuid,
    "dispute_id" uuid NOT NULL,
    "escrow_id" uuid,
    "buyer_id" uuid NOT NULL,
    "seller_id" uuid NOT NULL,
    "juror1_id" uuid NOT NULL,
    "juror2_id" uuid NOT NULL,
    "juror3_id" uuid NOT NULL,
    "juror4_id" uuid,
    "juror5_id" uuid,
    "vote1" bigint DEFAULT 0,
    "vote2" bigint DEFAULT 0,
    "vote3" bigint DEFAULT 0,
    "vote4" bigint DEFAULT 0,
    "vote5" bigint DEFAULT 0,
    "vote1_at" timestamptz,
    "vote2_at" timestamptz,
    "vote3_at" timestamptz,
    "vote4_at" timestamptz,
    "vote5_at" timestamptz,
    "dispute_reason" text NOT NULL,
    "buyer_evidence" text,
    "seller_evidence" text,
    "disputed_amount" decimal NOT NULL,
    "status" varchar(20) DEFAULT 'voting',
    "decision" bigint DEFAULT 0,
    "buyer_payout" decimal DEFAULT 0,
    "seller_payout" decimal DEFAULT 0,
    "resolution_notes" text,
    "on_chain_tx_hash" varchar(128),
    "on_chain_slot" bigint,
    "voting_deadline" timestamptz,
    "created_at" timestamptz,
    "resolved_at" timestamptz,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_dispute_juries_juror3" FOREIGN KEY ("juror3_id") REFERENCES "profiles"("id"),
    CONSTRAINT "fk_dispute_juries_buyer" FOREIGN KEY ("buyer_id") REFERENCES "profiles"("id"),
    CONSTRAINT "fk_dispute_juries_seller" FOREIGN KEY ("seller_id") REFERENCES "profiles"("id"),
    CONSTRAINT "fk_dispute_juries_juror1" FOREIGN KEY ("juror1_id") REFERENCES "profiles"("id"),
    CONSTRAINT "fk_dispute_juries_juror2" FOREIGN KEY ("juror2_id") REFERENCES "profiles"("id")
);
CREATE INDEX IF NOT EXISTS "idx_dispute_juries_escrow_id" ON "dispute_juries" ("escrow_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_jury_dispute" ON "dispute_juries" ("dispute_id");

CREATE TABLE IF NOT EXISTS "favorites" (
    "id" uuid DEFAULT uuid_generate_v4(),
    "user_id" uuid NOT NULL,
    "listing_id" uuid NOT NULL,
    "created_at" timestamptz,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_favorites_listing" FOREIGN KEY ("listing_id") REFERENCES "proxy_listings"("id")
);

CREATE TABLE IF NOT EXISTS "ip_allowlists" (
    "id" uuid DEFAULT uuid_generate_v4(),
    "user_id" uuid NOT NULL,
    "ip_address" inet NOT NULL,
    "label" varchar(100),
    "is_active" boolean DEFAULT true,
    "created_at" timestamptz,
    PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "provider_scores" (
    "id" uuid,
    "provider_id" uuid NOT NULL,
    "uptime_score" numeric(5,2) DEFAULT 100,
    "latency_score" numeric(5,2) DEFAULT 100,
    "reliability_score" numeric(5,2) DEFAULT 100,
    "dispute_score" numeric(5,2) DEFAULT 100,
    "overall_score" numeric(5,2) DEFAULT 100,
    "total_sessions" bigint DEFAULT 0,
    "successful_sessions" bigint DEFAULT 0,
    "failed_sessions" bigint DEFAULT 0,
    "total_bytes_served" bigint DEFAULT 0,
    "total_disputes" bigint DEFAULT 0,
    "disputes_won" bigint DEFAULT 0,
    "disputes_lost" bigint DEFAULT 0,
    "average_latency_ms" numeric(10,2) DEFAULT 0,
    "uptime_percentage" numeric(5,2) DEFAULT 100,
    "first_session_at" timestamptz,
    "last_session_at" timestamptz,
    "last_updated_at" timestamptz,
    "created_at" timestamptz,
    "updated_at" timestamptz,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_provider_scores_provider" FOREIGN KEY ("provider_id") REFERENCES "profiles"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_provider_scores_provider_id" ON "provider_scores" ("provider_id");

CREATE TABLE IF NOT EXISTS "saved_searches" (
    "id" uuid DEFAULT uuid_generate_v4(),
    "user_id" uuid NOT NULL,
    "name" varchar(100) NOT NULL,
    "filters" jsonb,
    "notify_on_match" boolean DEFAULT true,
    "last_notified_at" timestamptz,
    "created_at" timestamptz,
    PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "service_config_history" (
    "id" uuid DEFAULT uuid_generate_v4(),
    "service_config_id" uuid NOT NULL,
    "changed_by" uuid NOT NULL,
    "change_reason" varchar(255),
    "config_snapshot" text,
    "created_at" timestamptz,
    PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_service_config_history_service_config_id" ON "service_config_history" ("service_config_id");

CREATE TABLE IF NOT EXISTS "session_metrics" (
    "id" uuid,
    "session_id" uuid NOT NULL,
    "avg_latency_ms" decimal DEFAULT 0,
    "success_rate" decimal DEFAULT 100,
    "bytes_up" bigint DEFAULT 0,
    "bytes_down" bigint DEFAULT 0,
    "created_at" timestamptz,
    "updated_at" timestamptz,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_session_metrics_session" FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_session_metrics_session" ON "session_metrics" ("session_id");

CREATE TABLE IF NOT EXISTS "shared_service_templates" (
    "id" uuid DEFAULT uuid_generate_v4(),
    "user_id" uuid NOT NULL,
    "name" varchar(100) NOT NULL,
    "description" text,
    "price" decimal DEFAULT 0,
    "downloads" bigint DEFAULT 0,
    "rating" decimal DEFAULT 0,
    "config_snapshot" text,
    "created_at" timestamptz,
    "updated_at" timestamptz,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_shared_service_templates_author" FOREIGN KEY ("user_id") REFERENCES "profiles"("id")
);

CREATE TABLE IF NOT EXISTS "staking_positions" (
    "id" uuid,
    "user_id" uuid NOT NULL,
    "wallet_id" uuid NOT NULL,
    "amount" numeric(20,4) NOT NULL,
    "currency" varchar(10) DEFAULT 'SOL',
    "apy" numeric(5,2) DEFAULT 15,
    "start_time" timestamptz,
    "end_time" timestamptz,
    "status" varchar(20) DEFAULT 'active',
    "accrued_yield" numeric(20,4) DEFAULT 0,
    "created_at" timestamptz,
    "updated_at" timestamptz,
    PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_staking_positions_wallet_id" ON "staking_positions" ("wallet_id");
CREATE INDEX IF NOT EXISTS "idx_staking_positions_user_id" ON "staking_positions" ("user_id");

CREATE TABLE IF NOT EXISTS "teams" (
    "id" uuid DEFAULT uuid_generate_v4(),
    "name" varchar(100) NOT NULL,
    "owner_id" uuid NOT NULL,
    "max_members" bigint DEFAULT 5,
    "created_at" timestamptz,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_teams_owner" FOREIGN KEY ("owner_id") REFERENCES "profiles"("id")
);

CREATE TABLE IF NOT EXISTS "team_members" (
    "id" uuid DEFAULT uuid_generate_v4(),
    "team_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "role" varchar(50) DEFAULT 'member',
    "joined_at" timestamptz,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_team_members_user" FOREIGN KEY ("user_id") REFERENCES "profiles"("id"),
    CONSTRAINT "fk_teams_members" FOREIGN KEY ("team_id") REFERENCES "teams"("id")
);

CREATE TABLE IF NOT EXISTS "uptime_checks" (
    "id" uuid DEFAULT uuid_generate_v4(),
    "node_id" uuid NOT NULL,
    "is_up" boolean NOT NULL,
    "latency_ms" bigint,
    "checked_at" timestamptz,
    PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "proof_of_services" (
    "id" uuid,
    "provider_id" uuid NOT NULL,
    "node_id" uuid NOT NULL,
    "uptime_percentage" decimal NOT NULL,
    "avg_latency_ms" bigint NOT NULL,
    "total_bytes_served" bigint NOT NULL,
    "total_requests" bigint NOT NULL,
    "success_rate" decimal NOT NULL,
    "unique_ips_served" bigint DEFAULT 0,
    "geo_diversity" decimal DEFAULT 0,
    "period_start" timestamptz NOT NULL,
    "period_end" timestamptz NOT NULL,
    "verified" boolean DEFAULT false,
    "verified_at" timestamptz,
    "verified_by" uuid,
    "quality_score" decimal DEFAULT 0,
    "created_at" timestamptz,
    "updated_at" timestamptz,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_proof_of_services_provider" FOREIGN KEY ("provider_id") REFERENCES "profiles"("id"),
    CONSTRAINT "fk_proof_of_services_node" FOREIGN KEY ("node_id") REFERENCES "provider_nodes"("id")
);
CREATE INDEX IF NOT EXISTS "idx_proof_of_services_period_start" ON "proof_of_services" ("period_start");
CREATE INDEX IF NOT EXISTS "idx_proof_of_services_node_id" ON "proof_of_services" ("node_id");
CREATE INDEX IF NOT EXISTS "idx_proof_of_services_provider_id" ON "proof_of_services" ("provider_id");

CREATE TABLE IF NOT EXISTS "proxy_pools" (
    "id" uuid,
    "user_id" uuid NOT NULL,
    "name" varchar(100) NOT NULL,
    "description" varchar(500),
    "size" bigint DEFAULT 10,
    "session_type" varchar(20) DEFAULT 'rotating',
    "status" varchar(20) DEFAULT 'active',
    "bytes_used" bigint DEFAULT 0,
    "bytes_limit" bigint DEFAULT 0,
    "created_at" timestamptz,
    "updated_at" timestamptz,
    PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_proxy_pools_user_id" ON "proxy_pools" ("user_id");

-- Columns the models write that the tables lack.
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "session_id" uuid;
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "usage_context" JSONB DEFAULT '{}';
ALTER TABLE "security_anomalies" ADD COLUMN IF NOT EXISTS "action_taken" varchar(50);
ALTER TABLE "security_anomalies" ADD COLUMN IF NOT EXISTS "details" jsonb;
ALTER TABLE "security_anomalies" ADD COLUMN IF NOT EXISTS "detected_city" varchar(100);
ALTER TABLE "security_anomalies" ADD COLUMN IF NOT EXISTS "detected_country" varchar(2);
ALTER TABLE "security_anomalies" ADD COLUMN IF NOT EXISTS "detected_ip" varchar(45);
ALTER TABLE "security_anomalies" ADD COLUMN IF NOT EXISTS "detected_ua" text;
ALTER TABLE "security_anomalies" ADD COLUMN IF NOT EXISTS "expected_country" varchar(2);
ALTER TABLE "security_anomalies" ADD COLUMN IF NOT EXISTS "expected_ip" varchar(45);
ALTER TABLE "security_anomalies" ADD COLUMN IF NOT EXISTS "resolution" text;
ALTER TABLE "security_anomalies" ADD COLUMN IF NOT EXISTS "risk_score" decimal DEFAULT 0;
ALTER TABLE "security_anomalies" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz;
ALTER TABLE "service_configurations" ADD COLUMN IF NOT EXISTS "adjustment_step" decimal DEFAULT 0.05;
ALTER TABLE "service_configurations" ADD COLUMN IF NOT EXISTS "dynamic_pricing_enabled" boolean DEFAULT false;
ALTER TABLE "service_configurations" ADD COLUMN IF NOT EXISTS "max_price_multiplier" decimal DEFAULT 2;
ALTER TABLE "service_configurations" ADD COLUMN IF NOT EXISTS "min_price_multiplier" decimal DEFAULT 0.8;
ALTER TABLE "service_configurations" ADD COLUMN IF NOT EXISTS "target_utilization" decimal DEFAULT 0.7;
