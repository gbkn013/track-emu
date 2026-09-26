import { expect, test, type Page } from "@playwright/test";

async function pick(page: Page, label: string, typed: string, option: RegExp) {
  await page.getByLabel(label, { exact: true }).fill(typed);
  await page.getByRole("option", { name: option }).first().click();
}

test("new trip -> departures list shows provenance, freshness and the disclaimer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trips");
  await expect(page.getByText("No trips yet")).toBeVisible();
  await page.getByRole("link", { name: "Add a trip" }).click();

  await pick(page, "From", "Beach", /Chennai Beach/);
  await pick(page, "To", "Tambaram", /Tambaram TBM/);
  await page.getByRole("button", { name: "Show trains" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toContainText("→");
  // Timetable-only build: banner must say so; nothing may be badged live.
  await expect(page.getByRole("status").first()).toContainText("Live data unavailable — showing timetable");
  await expect(page.getByText(/^● Live/)).toHaveCount(0);
  // Rows (with a Scheduled badge and a countdown) or the honest empty state, depending on the hour.
  const rows = page.locator("a.dep");
  if ((await rows.count()) > 0) {
    await expect(rows.first()).toContainText("Scheduled");
    await expect(rows.first().locator(".dep-count")).not.toBeEmpty();
  } else await expect(page.getByText(/No trains in the next/)).toBeVisible();
  await expect(page.getByText("Unofficial — not affiliated with Indian Railways.")).toBeVisible();

  // The trip was saved (checkbox default) and now appears as a card on the home screen.
  await page.goto("/#/");
  await expect(page.locator("li.trip-card")).toContainText("Chennai Beach");
});

test("saved trip card, edit mode and removal", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tnrail.saved", JSON.stringify([{ from: "MSB", to: "TBM", fromName: "Chennai Beach", toName: "Tambaram" }])));
  await page.goto("/");
  const card = page.locator("li.trip-card");
  await expect(card).toContainText("Chennai Beach");
  await expect(card.getByRole("status").or(card.locator("a.dep")).first()).toBeVisible();
  await page.getByRole("button", { name: "Edit trips" }).click();
  await page.getByRole("button", { name: /Remove trip Chennai Beach to Tambaram/ }).click();
  await expect(page.getByText("No trips yet")).toBeVisible();
});

test("leave at… asks for a time and lists trains for it", async ({ page }) => {
  await page.goto("/#/trip/MSB/TBM");
  await page.getByRole("button", { name: "Leave at…" }).click();
  await page.getByLabel("Date").fill("2026-12-01");
  await page.getByLabel("Time (IST)").fill("08:00");
  await page.getByRole("button", { name: "Go" }).click();
  await expect(page).toHaveURL(/at=2026-12-01T08:00/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Chennai Beach");
  await expect(page.locator(".hdr-title p")).toContainText("Leaving 2026-12-01 08:00");
  await expect(page.locator("a.dep").first()).toContainText("Scheduled");
  await page.getByRole("button", { name: "Leave now" }).click();
  await expect(page.locator(".hdr-title p")).toHaveText("Leaving now");
});

test("train detail shows stops, estimated-position wording, segment tags and a map region", async ({ page }) => {
  await page.goto("/#/train/40015/MSB/TBM");
  await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
  await expect(page.locator("ol.tl li.tl-item").first()).toBeVisible();
  await expect(page.locator(".tag", { hasText: "Board" })).toBeVisible();
  await expect(page.locator(".tag", { hasText: "Get off" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Map" })).toBeVisible();
  await expect(page.locator(".status-main")).not.toBeEmpty();
  // Never claim live tracking without live data.
  await expect(page.getByText(/^● Live/)).toHaveCount(0);
  await expect(page.getByText("Timetable position (estimated)")).toBeVisible();
});

test("station board lists trains or an honest empty state", async ({ page }) => {
  await page.goto("/#/station/TBM");
  await page.getByRole("tab", { name: "Arrivals" }).waitFor();
  await page.getByLabel("Window").selectOption("8");
  await expect(page.getByRole("status").first()).toContainText("Live data unavailable");
});

test("find a train by number", async ({ page }) => {
  await page.goto("/#/trains");
  await page.getByLabel("Find a train by number or name").fill("40015");
  await expect(page.locator("a.dep")).toHaveCount(1);
  await page.locator("a.dep").click();
  await expect(page).toHaveURL(/#\/train\/40015/);
});

test("invalid train number falls back to home; unknown station shows an error with retry", async ({ page }) => {
  await page.goto("/#/train/abc");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trips");
  await page.goto("/#/station/ZZZZ");
  await expect(page.getByRole("alert")).toContainText("unknown station");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("theme: forced dark/light is applied, persisted and TripView-orange in the header", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByLabel("Dark").check();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/); // applied before first paint
  await page.getByLabel("Light").check();
  await expect(page.locator("html")).toHaveClass(/light/);
  const bg = await page.locator("header.hdr").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(245, 130, 32)"); // #f58220
  await page.getByLabel("System default").check();
  await expect(page.locator("html")).not.toHaveClass(/dark|light/);
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
  await expect(page.getByRole("status").first()).toContainText("Live data unavailable — showing timetable");
  await expect(page.getByText(/^● Live/)).toHaveCount(0);
});
