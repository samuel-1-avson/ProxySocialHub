import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODE_MEANINGS,
  checkDoctorDraft,
  failedChecks,
  meaningFor,
  parseDoctorChecks,
} from "../src/lib/provider-doctor.ts";

const CHECKS = [
  { id: "config_file", ok: true, severity: "info" },
  { id: "gateway", ok: false, severity: "error", code: "gateway_tcp_unreachable" },
  { id: "auth_model", ok: false, severity: "warn", code: "jwt_token_only" },
  { id: "daemon", ok: true, severity: "info" },
];

test("the parser keeps only ids, outcomes, severities and codes", () => {
  const parsed = parseDoctorChecks([
    {
      id: "gateway",
      ok: false,
      severity: "error",
      code: "gateway_tcp_unreachable",
      message: "dial C:\\Users\\you\\secret.toml failed",
      remediation: "set api_key = \"pnode_secret\"",
      config_path: "C:\\Users\\you\\provider.toml",
    },
  ]);
  assert.deepEqual(parsed, [{ id: "gateway", ok: false, severity: "error", code: "gateway_tcp_unreachable" }]);
  assert.doesNotMatch(JSON.stringify(parsed), /secret|Users/);
});

test("the parser refuses a wrong shape, and drops an unusable code", () => {
  assert.equal(parseDoctorChecks("nope"), null);
  assert.equal(parseDoctorChecks([{ id: "Bad Id!", ok: true, severity: "info" }]), null);
  assert.equal(parseDoctorChecks([{ id: "daemon", ok: "yes", severity: "info" }]), null);
  assert.equal(parseDoctorChecks([{ id: "daemon", ok: true, severity: "fatal" }]), null);
  assert.equal(parseDoctorChecks(Array(65).fill({ id: "daemon", ok: true, severity: "info" })), null);
  const parsed = parseDoctorChecks([{ id: "daemon", ok: false, severity: "warn", code: "NOT A CODE" }]);
  assert.deepEqual(parsed, [{ id: "daemon", ok: false, severity: "warn" }]);
});

test("failed info checks are not findings; passed checks are counted", () => {
  const checks = parseDoctorChecks([...CHECKS, { id: "credentials", ok: false, severity: "info" }]);
  assert.deepEqual(failedChecks(checks).map((c) => c.id), ["gateway", "auth_model"]);
  const plan = checkDoctorDraft({ summary: "s", steps: [], assumptions: [], cannot_do: [] }, checks);
  assert.equal(plan.passed, 2);
  assert.equal(plan.healthy, false);
  assert.deepEqual(plan.failed.map((f) => f.id), ["gateway", "auth_model"]);
});

test("steps may cite only failed checks, at most two may be general, errors come first", () => {
  const plan = checkDoctorDraft(
    {
      summary: "The gateway is unreachable.",
      steps: [
        { check_id: "auth_model", title: "Note the token", detail: "Nothing to do now." },
        { check_id: "daemon", title: "Invented", detail: "This check passed." },
        { check_id: "", title: "Check your router", detail: "Restart it and try again." },
        { check_id: "gateway", title: "Check the firewall", detail: "Allow the app through." },
        { check_id: "gateway", title: "Check the firewall", detail: "Duplicate, dropped." },
        { check_id: "", title: "Second general", detail: "Wait a few minutes." },
        { check_id: "", title: "Third general", detail: "Over the limit." },
        { check_id: "missing_check", title: "Invented id", detail: "Dropped." },
      ],
      assumptions: ["The home router may filter outbound ports."],
      cannot_do: ["The checks cannot see inside the router."],
    },
    parseDoctorChecks(CHECKS),
  );
  assert.deepEqual(
    plan.steps.map((s) => [s.checkId, s.title]),
    [
      ["gateway", "Check the firewall"],
      ["auth_model", "Note the token"],
      [null, "Check your router"],
      [null, "Second general"],
    ],
  );
  assert.match(plan.notes.map((n) => n.message).join(" "), /did not match the checks/);
  assert.equal(plan.refused, false);
});

test("text is capped and an unreadable draft is refused without losing the findings", () => {
  const checks = parseDoctorChecks(CHECKS);
  const plan = checkDoctorDraft(
    {
      summary: "x".repeat(400),
      steps: [{ check_id: "gateway", title: "t".repeat(120), detail: "d".repeat(400) }],
      assumptions: Array(20).fill("a"),
      cannot_do: [],
    },
    checks,
  );
  assert.equal(plan.summary.length, 280);
  assert.equal(plan.steps[0].title.length, 80);
  assert.equal(plan.steps[0].detail.length, 300);
  assert.equal(plan.assumptions.length, 8);

  const refused = checkDoctorDraft("not an object", checks);
  assert.equal(refused.refused, true);
  assert.deepEqual(refused.steps, []);
  assert.equal(refused.failed.length, 2);
  assert.match(refused.summary, /checks found 1 problem and 1 thing worth knowing/);
});

test("a healthy report needs no model words; codes have plain meanings", () => {
  const checks = parseDoctorChecks([
    { id: "config_file", ok: true, severity: "info" },
    { id: "daemon", ok: true, severity: "info" },
  ]);
  const plan = checkDoctorDraft({ summary: "", steps: [], assumptions: [], cannot_do: [] }, checks);
  assert.equal(plan.healthy, true);
  assert.match(plan.summary, /All 2 checks passed/);
  assert.match(meaningFor({ id: "x", ok: false, severity: "error", code: "config_missing" }), /not connected to an account/);
  assert.match(meaningFor({ id: "x", ok: false, severity: "error", code: "something_new" }), /checks found/);
  // Every meaning is provider-facing: no file names, no config keys, no commands.
  for (const meaning of Object.values(CODE_MEANINGS)) {
    assert.doesNotMatch(meaning, /provider\.toml|api_key|provider-node|remediation/);
  }
});
