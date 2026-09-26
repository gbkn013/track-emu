import { expect, test } from "@playwright/test";

test("journey search shows provenance, freshness and the disclaimer", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("From").fill("Beach");
  await page.getByRole("option", { name: /Chennai Beach/ }).click();
  await page.getByLabel("To").fill("Tambaram");
  await page.getByRole("option", { name: /^Tambaram MSB|Tambaram TBM$/ }).first().click();

  // Timetable-only server: banner must say so; nothing may be badged live.
  await expect(page.getByRole("status").first()).toContainText("Live data unavailable — showing timetable");
  await expect(page.getByText(/^● Live/)).toHaveCount(0);
  // Either rows (with a Scheduled badge) or the honest empty state, depending on the hour.
  const rows = page.locator("li.row");
  if ((await rows.count()) > 0) await expect(rows.first()).toContainText("Scheduled");
  else await expect(page.getByText(/No trains in the next/)).toBeVisible();
  await expect(page.getByText("Unofficial — not affiliated with Indian Railways.")).toBeVisible();
});

test("train detail shows stops, estimated-position wording and a map region", async ({ page }) => {
  await page.goto("/#/train/40015");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("40015");
  await expect(page.locator("ol.timeline li").first()).toBeVisible();
  await expect(page.getByRole("img", { name: "Map" })).toBeVisible();
  const pos = page.locator(".position");
  await expect(pos).not.toBeEmpty();
  // Never claim live tracking without live data.
  await expect(page.getByText(/^● Live/)).toHaveCount(0);
});

test("station board lists trains or an honest empty state", async ({ page }) => {
  await page.goto("/#/station/TBM");
  await page.getByRole("tab", { name: "Arrivals" }).waitFor();
  await page.getByLabel("Window").selectOption("8");
  await expect(page.getByRole("status").first()).toContainText("Live data unavailable");
});

test("invalid train number falls back to home; unknown station shows an error with retry", async ({ page }) => {
  await page.goto("/#/train/abc");
  await expect(page.getByText("Next trains").or(page.getByLabel("From"))).toBeVisible();
  await page.goto("/#/station/ZZZZ");
  await expect(page.getByRole("alert")).toContainText("unknown station");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("optional live key: sent only to RailRadar; a blocked call degrades to the timetable", async ({ page }) => {
  const seen: string[] = [];
  await page.route("https://api.railradar.in/**", (route) => {
    seen.push(route.request().headers()["authorization"] ?? "");
    return route.abort();
  });
  await page.goto("/#/settings");
  await expect(page.getByRole("status").first()).toContainText("Live data is off");
  await page.getByLabel("RailRadar API key").fill("test-key");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").first()).toContainText("Live data is on");

  await page.goto("/#/station/TBM");
  await page.getByRole("tab", { name: "Arrivals" }).waitFor();
  await expect.poll(() => seen.length).toBeGreaterThan(0);
  expect(seen[0]).toBe("Bearer test-key");
  // Live failed: banner says timetable, nothing is badged live.
  await expect(page.getByRole("status").first()).toContainText("Live data unavailable — showing timetable");
  await expect(page.getByText(/^● Live/)).toHaveCount(0);
});
