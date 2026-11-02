// Entry point: node src/server.ts

import { createApp } from "./app.ts";
import { MetaClient } from "./ai/meta.ts";
import { describeConfig, loadConfig } from "./config.ts";
import { startFixtureHarness, type FixtureHarness } from "./fixtures/harness.ts";
import { AuditRunner } from "./runner.ts";
import { FileArtifactStore, FileJobStore } from "./store/fileStore.ts";
import { PgJobStore } from "./store/pgStore.ts";
import type { JobStore } from "./store/types.ts";
import { redactDeep } from "./redact.ts";

function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), svc: "regional-auditor", event, ...redactDeep(fields) }));
}

async function main() {
  const config = loadConfig();
  if (!config.serviceSecret) {
    console.error("AUDITOR_SERVICE_SECRET is required (a random string of at least 32 characters shared with the web server).");
    process.exit(1);
  }
  if (config.serviceSecret.length < 32) {
    console.error("AUDITOR_SERVICE_SECRET must be at least 32 characters.");
    process.exit(1);
  }

  const store: JobStore = config.databaseUrl ? new PgJobStore(config.databaseUrl) : new FileJobStore(config.dataDir);
  const artifacts = new FileArtifactStore(config.dataDir);
  const meta = new MetaClient(config.model);
  let fixture: FixtureHarness | null = null;
  if (config.fixtureEnabled) {
    fixture = await startFixtureHarness({ targetPort: Number(process.env.AUDITOR_FIXTURE_TARGET_PORT) || undefined, scenario: process.env.AUDITOR_FIXTURE_SCENARIO || "demo-v1" });
    log("fixture_harness_started", { targetOrigin: fixture.targetOrigin, scenario: fixture.scenarioId(), note: "development only; evidence is synthetic" });
  }

  const runner = new AuditRunner({ config, store, artifacts, meta, fixture, log });
  const recovered = await runner.recoverAbandoned();
  runner.startRetention();
  const server = createApp({ config, runner, store, artifacts, fixture, log });

  server.listen(config.port, config.host, () => {
    log("listening", { host: config.host, port: config.port, store: config.databaseUrl ? "postgres" : "filesystem", config: describeConfig(config), recoveredAbandonedJobs: recovered });
  });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log("shutting_down", { signal });
    server.close();
    await runner.shutdown();
    await fixture?.stop();
    await store.close?.();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
