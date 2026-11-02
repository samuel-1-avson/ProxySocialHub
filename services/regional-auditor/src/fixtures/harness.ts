// Development-only fixture harness: demo website + local regional proxy +
// a static GeoIP table. Everything produced through it is labelled
// "synthetic_fixture" end to end. It must never be enabled in production
// (loadConfig refuses AUDITOR_FIXTURE_ENABLED when NODE_ENV=production).

import { randomBytes } from "node:crypto";
import { StaticGeoIpProvider } from "../geo.ts";
import { startDemoTarget, type DemoTarget } from "./demoTarget.ts";
import { startFixtureProxy, type FixtureProxy, type FixtureRegion, type RouteFault } from "./fixtureProxy.ts";
import { SCENARIOS } from "./scenarios.ts";

/** Documentation-range IPs (RFC 5737). They are fake and mapped by the static table below. */
const FIXTURE_REGIONS: Array<{ country: string; egressIp: string }> = [
  { country: "GH", egressIp: "198.51.100.23" },
  { country: "US", egressIp: "203.0.113.45" },
  { country: "DE", egressIp: "192.0.2.77" },
];
const UNKNOWN_IP = "192.0.2.250";

export interface FixtureHarness {
  targetOrigin: string;
  proxyServer: string;
  regions: string[];
  geoip: StaticGeoIpProvider;
  credentialFor(country: string): { username: string; password: string } | null;
  scenarioId(): string;
  scenarios(): Array<{ id: string; title: string }>;
  setScenario(id: string): void;
  setFault(country: string, fault: RouteFault | null): void;
  stop(): Promise<void>;
}

export async function startFixtureHarness(options: { targetPort?: number; scenario?: string } = {}): Promise<FixtureHarness> {
  const target: DemoTarget = await startDemoTarget({ port: options.targetPort, scenario: options.scenario });
  const regions: FixtureRegion[] = FIXTURE_REGIONS.map((r) => ({
    ...r,
    username: `fixture-${r.country.toLowerCase()}`,
    password: randomBytes(12).toString("hex"),
  }));
  let proxy: FixtureProxy;
  try {
    proxy = await startFixtureProxy({
      regions,
      allowedOrigin: target.origin,
      decoyIps: { otherCountry: FIXTURE_REGIONS[0]!.egressIp, unknown: UNKNOWN_IP },
    });
  } catch (error) {
    await target.close();
    throw error;
  }
  // For wrong_country on GH the decoy must differ from GH's own IP.
  const geoip = new StaticGeoIpProvider(Object.fromEntries(FIXTURE_REGIONS.map((r) => [r.egressIp, r.country])));

  return {
    targetOrigin: target.origin,
    proxyServer: proxy.server,
    regions: FIXTURE_REGIONS.map((r) => r.country),
    geoip,
    credentialFor(country) {
      const r = regions.find((x) => x.country === country);
      return r ? { username: r.username, password: r.password } : null;
    },
    scenarioId: () => target.scenario().id,
    scenarios: () => SCENARIOS.map((s) => ({ id: s.id, title: s.title })),
    setScenario: (id) => target.setScenario(id),
    setFault: (country, fault) => proxy.setFault(country, fault),
    async stop() {
      await Promise.allSettled([proxy.close(), target.close()]);
    },
  };
}
