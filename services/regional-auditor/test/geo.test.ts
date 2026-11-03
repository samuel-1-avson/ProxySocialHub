import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StaticGeoIpProvider, describeNetwork, evaluateAssurance, isSatelliteNetwork, parseEchoIp, worseAssurance } from "../src/geo.ts";

const geo = (country: string | null, note: string | null = null) => ({ country, source: "test", lookedUpAt: "2026-11-01T00:00:00.000Z", note });
const base = { requested: "GH", declaredCountry: null as string | null, workerDirectIp: "198.18.5.5" };

describe("evaluateAssurance", () => {
  it("verifies only when the GeoIP estimate matches the request", () => {
    const r = evaluateAssurance({ ...base, samples: [{ ip: "41.0.0.1", geoip: geo("GH") }] });
    assert.equal(r.assurance, "verified");
    assert.match(r.reason, /no provider-declared country/);
  });

  it("rejects a mismatched country and names both", () => {
    const r = evaluateAssurance({ ...base, samples: [{ ip: "8.8.8.8", geoip: geo("US") }] });
    assert.equal(r.assurance, "mismatch");
    assert.match(r.reason, /US.*GH/);
  });

  it("treats an unknown country as unverified, never verified", () => {
    const r = evaluateAssurance({ ...base, samples: [{ ip: "41.0.0.1", geoip: geo(null, "Lookup failed: timeout.") }] });
    assert.equal(r.assurance, "unverified");
    assert.match(r.reason, /could not be estimated/);
  });

  it("does not let a provider claim alone verify a region", () => {
    const r = evaluateAssurance({ ...base, declaredCountry: "GH", samples: [{ ip: "41.0.0.1", geoip: geo(null) }] });
    assert.equal(r.assurance, "unverified");
  });

  it("flags conflicting sources instead of trusting either", () => {
    const r = evaluateAssurance({ ...base, declaredCountry: "NG", samples: [{ ip: "41.0.0.1", geoip: geo("GH") }] });
    assert.equal(r.assurance, "unverified");
    assert.match(r.reason, /conflict/);
  });

  it("detects an exit equal to the worker's own IP (bypass, or a node on the same connection)", () => {
    const r = evaluateAssurance({ ...base, samples: [{ ip: "198.18.5.5", geoip: geo("GH") }] });
    assert.equal(r.assurance, "direct_egress");
    assert.equal(r.matchesWorkerDirectIp, true);
    assert.match(r.reason, /did not leave through a regional exit/);
    assert.match(r.reason, /own internet connection/);
  });

  it("is unavailable when no egress IP was observed", () => {
    const r = evaluateAssurance({ ...base, samples: [{ ip: null, geoip: null }] });
    assert.equal(r.assurance, "unavailable");
    assert.equal(evaluateAssurance({ ...base, samples: [] }).assurance, "unavailable");
  });

  it("takes the worst result when the route changes during capture", () => {
    const r = evaluateAssurance({
      ...base,
      samples: [
        { ip: "41.0.0.1", geoip: geo("GH") },
        { ip: "8.8.8.8", geoip: geo("US") },
      ],
    });
    assert.equal(r.assurance, "mismatch");
    assert.match(r.reason, /changed during capture/);
  });

  it("allows an IP change that stays inside the requested country, and says so", () => {
    const r = evaluateAssurance({
      ...base,
      samples: [
        { ip: "41.0.0.1", geoip: geo("GH") },
        { ip: "41.0.0.2", geoip: geo("GH") },
      ],
    });
    assert.equal(r.assurance, "verified");
    assert.match(r.reason, /changed during capture/);
  });

  it("never verifies a satellite exit, even when GeoIP and the listing agree", () => {
    // The live case: a Ghana Starlink node whose stale listing says US and whose IP geolocates to the US.
    const starlink = { ...geo("US"), network: "Space Exploration Technologies Corporation (AS14593)", satellite: true };
    const r = evaluateAssurance({ ...base, requested: "US", declaredCountry: "US", samples: [{ ip: "98.97.0.1", geoip: starlink }] });
    assert.equal(r.assurance, "unverified");
    assert.match(r.reason, /satellite network \(Space Exploration Technologies Corporation \(AS14593\)\)/);
    assert.ok(r.reason.length <= 400, "fits the stored reason limit");
  });

  it("orders assurance by severity", () => {
    assert.equal(worseAssurance("verified", "unverified"), "unverified");
    assert.equal(worseAssurance("mismatch", "unavailable"), "mismatch");
    assert.equal(worseAssurance("direct_egress", "mismatch"), "direct_egress");
  });
});

describe("parseEchoIp", () => {
  it("parses common echo formats", () => {
    assert.equal(parseEchoIp('{"ip":"41.0.0.1"}'), "41.0.0.1");
    assert.equal(parseEchoIp('{"origin":"41.0.0.1, 10.0.0.1"}'), "41.0.0.1");
    assert.equal(parseEchoIp("2606:4700:4700::1111\n"), "2606:4700:4700::1111");
  });
  it("rejects anything that is not an IP", () => {
    assert.equal(parseEchoIp("<html>blocked</html>"), null);
    assert.equal(parseEchoIp('{"ip":"hello"}'), null);
    assert.equal(parseEchoIp(""), null);
    assert.equal(parseEchoIp("x".repeat(5000)), null);
  });
});

describe("satellite networks", () => {
  it("recognises satellite operators by ASN or name", () => {
    assert.equal(isSatelliteNetwork({ asn: 14593, isp: "SpaceX Services, Inc." }), true);
    assert.equal(isSatelliteNetwork({ asn: 99999, isp: "Space Exploration Technologies Corporation" }), true);
    assert.equal(isSatelliteNetwork({ org: "Starlink" }), true);
    assert.equal(isSatelliteNetwork({ isp: "Viasat, Inc." }), true);
    assert.equal(isSatelliteNetwork({ isp: "Hughes Network Systems" }), true);
  });

  it("does not flag ordinary networks", () => {
    assert.equal(isSatelliteNetwork({ asn: 15169, isp: "Google LLC", org: "Google LLC" }), false);
    assert.equal(isSatelliteNetwork({ asn: 30986, isp: "Scancom [MTNGhana] Mobile Subscribers" }), false);
    assert.equal(isSatelliteNetwork(null), false);
  });

  it("describes a network compactly", () => {
    assert.equal(describeNetwork({ asn: 15169, isp: "Google LLC" }), "Google LLC (AS15169)");
    assert.equal(describeNetwork({ org: "Example" }), "Example");
    assert.equal(describeNetwork({}), null);
  });
});

describe("StaticGeoIpProvider", () => {
  it("labels its source as synthetic", async () => {
    const p = new StaticGeoIpProvider({ "198.51.100.1": "GH" });
    const hit = await p.lookup("198.51.100.1");
    assert.equal(hit.country, "GH");
    assert.match(hit.source, /synthetic/);
    assert.equal((await p.lookup("1.2.3.4")).country, null);
  });
});
