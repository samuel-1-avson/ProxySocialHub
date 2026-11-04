import { expect as baseExpect, test, type Page } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";

/**
 * Node settings location fields: known-city list, what the public map will
 * show under the owner's map precision, and that saving only the name does
 * not send (and so does not lock in) a location.
 */
const expect = baseExpect.configure({ timeout: 30_000 });
const base = process.env.TEST_BASE_URL || "http://localhost:4011";
const node = {
  id: "loc-node-1",
  name: "Home node",
  country: "GH",
  city: "Kumasi",
  status: "online",
  latest_heartbeat_verified: true,
  quality_score: 90,
  current_tier: "standard",
  base_price_per_gb: 0.99,
  uptime_percent: 99,
  active_connections: 0,
  created_at: "2026-11-04T12:00:00Z",
};

async function setup(page: Page, precision: "country" | "city") {
  const updates: Record<string, unknown>[] = [];
  let current = { ...node };
  await page.routeWebSocket("**/v1/ws**", (socket) => socket.close());
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method();
    const send = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (path === "/v1/provider/nodes" && method === "GET") return send({ nodes: [current] });
    if (path === `/v1/provider/nodes/${node.id}` && method === "PUT") {
      const body = request.postDataJSON() as Record<string, unknown>;
      updates.push(body);
      current = { ...current, ...body } as typeof node;
      return send(current);
    }
    if (path === "/v1/profile/privacy")
      return send({ map_visible: true, map_precision: precision });
    if (path === `/v1/provider/nodes/${node.id}/uptime`)
      return send({
        node_id: node.id,
        uptime_percent: 99,
        avg_latency_ms: 40,
        checks_24h: 10,
        current_status: "online",
        last_seen: "",
      });
    return send({ error: `Not used in this fixture: ${path}` }, 503);
  });
  await seedSignedAuth(page, base, "provider");
  return updates;
}

test.describe("node location settings", () => {
  test.setTimeout(180_000);
  test.use({ actionTimeout: 30_000 });

  test("explains country precision, lists Ghana's cities, and saves only what changed", async ({ page }, info) => {
    const updates = await setup(page, "country");
    await page.goto(`${base}/provider/nodes/${node.id}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("node-map-precision-note")).toContainText(
      "the pin sits in the middle of Ghana, not at Kumasi",
    );
    const city = page.getByRole("combobox", { name: /^City/ });
    await expect(city).toHaveValue("Kumasi");
    const listId = await city.getAttribute("list");
    expect(listId).toBeTruthy();
    const options = page.locator(`datalist[id="${listId}"] option`);
    await expect(options).toHaveCount(16);
    await expect(page.getByRole("button", { name: "Use my location" })).toBeVisible();

    // Name only: no location in the request, so nothing is locked in.
    await page.getByRole("textbox", { name: "Node name", exact: true }).fill("Home node 2");
    await page.getByRole("button", { name: "Save node settings" }).click();
    await expect(page.getByText("Node settings saved.")).toBeVisible();
    expect(updates[0]).toEqual({ name: "Home node 2" });

    // A real city change sends country and city together.
    await city.fill("sunyani");
    await city.blur();
    await expect(city).toHaveValue("Sunyani");
    await page.getByRole("button", { name: "Save node settings" }).click();
    await expect.poll(() => updates.length).toBe(2);
    expect(updates[1]).toEqual({ name: "Home node 2", country: "GH", city: "Sunyani" });

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: info.outputPath("node-location-settings.png"), fullPage: true });
  });

  test("city precision says which city area the map shows; unknown cities are explained", async ({ page }) => {
    await setup(page, "city");
    await page.goto(`${base}/provider/nodes/${node.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("node-map-precision-note")).toContainText("the Kumasi area");
    const city = page.getByRole("combobox", { name: /^City/ });
    await city.fill("Obuasi");
    await expect(page.getByText("Obuasi is not on our city list yet")).toBeVisible();
  });
});
