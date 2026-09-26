// Service / cache / quota / RailRadar-mapping tests — port of backend/tests/services + api.
// Offline: fakes only, and fetch is stubbed. Nothing here can reach the network.
import { beforeEach, describe, expect, it } from "vitest";
import { Catalogue } from "./catalogue";
import type { BoardEntry, LiveRun, StationBoard } from "./domain";
import { newLiveRun } from "./domain";
import { ApiError, ProviderError, QuotaExceeded, UpstreamDegraded } from "./errors";
import { LiveCache } from "./livecache";
import { QuotaLedger } from "./quota";
import { mapBoard, mapLive, RailRadarClient, type LiveProvider } from "./railradar";
import { alignLive, QueryService } from "./service";
import { at, DAY, schedules, testCatalogueRaw } from "./testkit";
import { MIN } from "./time";

class FakeLive implements LiveProvider {
  name = "fake-live";
  calls = 0;
  boardCalls = 0;
  boardEntries: BoardEntry[] | null = null;
  constructor(public fail: Error | null = null) {}
  async getLiveRun(n: string, d: string): Promise<LiveRun> {
    this.calls++;
    if (this.fail) throw this.fail;
    const base = at(5, 30);
    return newLiveRun(n, d, {
      is_live: true, last_updated_at: base + 13 * MIN,
      route: [{ seq: 0, station_code: "MSB", scheduled_departure: base, actual_departure: base + 12 * MIN, delay_minutes: 12 }],
    });
  }
  async getStationBoard(code: string): Promise<StationBoard> {
    this.boardCalls++;
    if (this.fail) throw this.fail;
    const entries = this.boardEntries ?? [
      { train_number: "40001", train_name: null, live_type: "upcoming", expected_departure_time: null, delay_minutes: 7, platform: 3 },
    ];
    return { code, entries };
  }
}

// Ledger backed by an explicit budget; localStorage is per-test cleared.
const ledger = (budget = 10) => new QuotaLedger(() => budget);
const make = (live: LiveProvider | null = null, budget = 10) =>
  new QueryService(Catalogue.from(testCatalogueRaw()), live, ledger(budget));
const nums = (r: { journeys: { number: string }[] }) => r.journeys.map((j) => j.number);

beforeEach(() => localStorage.clear());

describe("journeys (schedule-only)", () => {
  it("filters by direction and halts", async () => {
    const svc = make();
    const r = await svc.journeys("MSB", "TBM", at(5, 0));
    expect(nums(r)).toEqual(["40001"]); // 40002 wrong way, 40003 skips TBM
    expect(r.data_mode).toBe("scheduled");
    expect(r.journeys[0].source_at_a).toBe("scheduled");
    expect(nums(await svc.journeys("TBM", "MSB", at(5, 0)))).toEqual(["40002"]);
  });

  it("a midnight-crossing run belongs to the previous day", async () => {
    const svc = make();
    const j = (await svc.journeys("MAS", "TRT", at(23, 35))).journeys[0];
    expect(j.number).toBe("43501");
    expect(j.start_date).toBe("2026-09-21");
    expect(j.eta_at_b.startsWith("2026-09-22T00:25")).toBe(true);
    const t = await svc.trainLive("43501", at(0, 10, 22));
    expect(t.start_date).toBe("2026-09-21");
    expect(t.position.kind).toBe("between");
    expect(t.position.estimated).toBe(true);
  });

  it("hides departed trains unless toggled", async () => {
    const svc = make();
    expect((await svc.journeys("MSB", "TBM", at(7, 0))).journeys).toEqual([]);
    const shown = await svc.journeys("MSB", "TBM", at(6, 0), { showDeparted: true });
    expect(shown.journeys.map((j) => j.state_relative_to_a)).toEqual(["departed"]);
  });

  it("response carries freshness fields and +05:30 times", async () => {
    const r = await make().journeys("MSB", "TBM", at(5, 0));
    for (const k of ["data_mode", "fetched_at", "source", "stale_seconds", "journeys"]) expect(r).toHaveProperty(k);
    expect(r.journeys[0].eta_at_a.endsWith("+05:30")).toBe(true);
  });
});

describe("live overlay and degradation", () => {
  it("is board-first and labels sources honestly", async () => {
    const live = new FakeLive();
    const svc = make(live);
    const r = await svc.journeys("TBM", "CGL", at(6, 10));
    const j = r.journeys[0];
    expect(j.delay_at_a).toBe(7);
    expect(j.eta_at_a.startsWith("2026-09-21T06:27")).toBe(true);
    expect(j.source_at_a).toBe("live_reported");
    expect(j.source_at_b).toBe("propagated"); // carried delay is never labelled reported
    expect(j.eta_at_b.startsWith("2026-09-21T07:17")).toBe(true);
    expect([live.boardCalls, live.calls]).toEqual([1, 0]); // no per-train calls
    expect(r.source).toContain("railradar live");
    expect(r.data_mode).not.toBe("scheduled");

    live.boardEntries = [];
    svc.cache.clear();
    const r2 = await svc.journeys("TBM", "CGL", at(6, 10));
    expect(r2.journeys[0].source_at_a).toBe("scheduled");
    expect(r2.data_mode).toBe("scheduled");
  });

  it("does not apply a board row that belongs to the other run", async () => {
    const live = new FakeLive();
    live.boardEntries = [{ train_number: "40001", train_name: null, live_type: "upcoming", expected_departure_time: at(20, 0), delay_minutes: 5, platform: null }];
    const r = await make(live).journeys("TBM", "CGL", at(6, 10));
    expect(r.journeys[0].source_at_a).toBe("scheduled");
  });

  it("single-flights concurrent requests and honours the TTL", async () => {
    const live = new FakeLive();
    const svc = make(live);
    await Promise.all(Array.from({ length: 5 }, () => svc.journeys("MSB", "TBM", at(5, 25))));
    expect(live.boardCalls).toBe(1);
    await svc.journeys("MSB", "TBM", at(5, 26));
    expect(live.boardCalls).toBe(1);
  });

  it("uses per-train live only when a train is opened", async () => {
    const live = new FakeLive();
    const t = await make(live).trainLive("40001", at(5, 50));
    expect(live.calls).toBe(1);
    expect(t.stops[0].eta_source).toBe("actual");
    expect(t.stops[0].delay_min).toBe(12);
  });

  it.each([new QuotaExceeded(60), new UpstreamDegraded()])("degrades to scheduled on %s, never errors", async (err) => {
    const svc = make(new FakeLive(err));
    const r = await svc.journeys("MSB", "TBM", at(5, 25));
    expect(r.data_mode).toBe("scheduled");
    expect(r.journeys[0].source_at_a).toBe("scheduled");
    expect(svc.cache.breakerOpen).toBe(true);
  });

  it("an exhausted budget disables live", async () => {
    const live = new FakeLive();
    const svc = make(live, 1);
    svc.ledger.record("/x", 200, 5);
    expect(svc.ledger.state()).toBe("exhausted");
    const r = await svc.journeys("MSB", "TBM", at(5, 25));
    expect(live.boardCalls).toBe(0);
    expect(r.data_mode).toBe("scheduled");
    expect(r.live_configured).toBe(false);
  });

  it("station board marks live-reported rows", async () => {
    const b = await make(new FakeLive()).board("TBM", at(6, 15));
    const row = b.trains.find((t) => t.number === "40001")!;
    expect([row.eta_source, row.delay_min, row.platform]).toEqual(["live_reported", 7, 3]);
    expect(b.data_mode).toBe("partial");
  });

  it("alignLive re-keys by station and drops unknown stations", () => {
    const live = newLiveRun("40001", DAY, { route: [{ seq: 0, station_code: "ZZZ" }, { seq: 1, station_code: "TBM" }] });
    expect(alignLive(live, schedules()[0]).route.map((r) => [r.station_code, r.seq])).toEqual([["TBM", 1]]);
  });
});

describe("edge validation (single error shape)", () => {
  it.each([
    ["abc", 422, "bad_train_number"],
    ["99999", 404, "train_not_found"],
  ])("train %s", async (n, status, code) => {
    await expect(make().trainLive(n, at(6, 0))).rejects.toMatchObject({ status, code });
  });
  it("station and hours", async () => {
    const svc = make();
    await expect(svc.board("NOPE", at(6, 0))).rejects.toMatchObject({ status: 404, code: "station_not_found" });
    await expect(svc.board("TBM", at(6, 0), 3)).rejects.toMatchObject({ status: 422, code: "bad_hours" });
    expect(() => svc.checkStation("bad code!")).toThrow(ApiError);
  });
  it("search, schedule, route and coordinates for the map", () => {
    const svc = make();
    expect(svc.searchStations("tb").stations[0].code).toBe("TBM");
    expect(svc.searchTrains("40001").trains[0].number).toBe("40001");
    expect(svc.trainSchedule("40001", at(6, 0)).stops.map((s) => s.station_code)).toEqual(["MSB", "TBM", "CGL"]);
    expect(svc.routeGeometry("40001").type).toBe("LineString");
    expect(svc.trainSchedule("40001", at(6, 0)).stops[0]).toMatchObject({ lat: 13, lng: 80 });
  });
});

describe("live cache", () => {
  it("serves stale only within max-stale", async () => {
    const c = new LiveCache(1000);
    expect((await c.get("k", 0, async () => 1))!.value).toBe(1);
    const boom = async (): Promise<number> => { throw new UpstreamDegraded(); };
    expect((await c.get("k", 0, boom))!.value).toBe(1);
    c.backdate("k", 2_000_000);
    expect(await c.get("k", 0, boom)).toBeNull();
  });
  it("honours Retry-After when opening the breaker", async () => {
    let t = 0;
    const c = new LiveCache(1000, () => t, () => 0.5);
    await c.get("k", 0, async () => { throw new QuotaExceeded(30); });
    expect(c.breakerOpen).toBe(true);
    t = 31_000;
    expect(c.breakerOpen).toBe(false);
  });
});

describe("quota ledger", () => {
  it("counts per month and moves ok -> stretch -> exhausted", () => {
    const led = new QuotaLedger(() => 10);
    expect(led.state()).toBe("ok");
    for (let i = 0; i < 9; i++) led.record("/e", 200, 1);
    expect(led.state()).toBe("stretch");
    expect(led.usedThisMonth()).toBe(9);
    led.record("/e", 429, 1);
    expect(led.state()).toBe("exhausted");
  });
});

describe("RailRadar mapping and client (synthetic payloads; shape UNVERIFIED)", () => {
  it("mapLive tolerates missing and extra fields", () => {
    const run = mapLive("43501", DAY, {
      isLive: true, lastUpdatedAt: "2026-09-21T06:05:00+05:30", surprise: 1,
      currentLocation: { stationCode: "TBM", isActualPosition: false },
      route: [{ stationCode: "TBM", actualArrival: "2026-09-21T06:04:00+05:30", delayMinutes: 4 }, "garbage"],
      exceptions: [{ type: "DIVERTED" }],
    });
    expect(run.is_live).toBe(true);
    expect(run.route).toHaveLength(1);
    expect(run.route[0].delay_minutes).toBe(4);
    expect(run.exceptions[0].type).toBe("DIVERTED");
    expect(mapLive("1", DAY, {}).route).toEqual([]);
  });

  it("mapBoard skips rows without a train number", () => {
    const b = mapBoard("TBM", { trains: [{ trainNumber: 40001, live: { delayMinutes: 3, platform: 2 } }, { live: {} }, "x"] });
    expect(b.entries).toHaveLength(1);
    expect(b.entries[0]).toMatchObject({ train_number: "40001", delay_minutes: 3, platform: 2 });
  });

  const client = (res: () => Response | Promise<Response>, seen: [string, number][] = []) =>
    new RailRadarClient("https://x.test/v1", "k", (e, s) => seen.push([e, s]), (async () => res()) as typeof fetch);

  it("maps 429 (Retry-After) and 503, and logs every call", async () => {
    const seen: [string, number][] = [];
    const r429 = client(() => new Response("", { status: 429, headers: { "retry-after": "30" } }), seen);
    await expect(r429.getLiveRun("43501", DAY)).rejects.toMatchObject({ code: "quota_exceeded", retryAfterS: 30 });
    await expect(client(() => new Response("", { status: 503 }), seen).getLiveRun("43501", DAY)).rejects.toBeInstanceOf(UpstreamDegraded);
    expect(seen).toEqual([["/trains/43501/live", 429], ["/trains/43501/live", 503]]);
  });

  it("treats a blocked / failed browser request as a degraded upstream, and rejects bad keys", async () => {
    const netFail = new RailRadarClient("https://x.test", "k", undefined, (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch);
    await expect(netFail.getStationBoard("TBM", 2)).rejects.toBeInstanceOf(UpstreamDegraded);
    await expect(client(() => new Response("", { status: 401 })).getStationBoard("TBM", 2)).rejects.toMatchObject({ code: "auth_error" });
    await expect(client(() => new Response("nope", { status: 200 })).getStationBoard("TBM", 2)).rejects.toBeInstanceOf(ProviderError);
  });

  it("sends the key only as a Bearer header to the configured base URL", async () => {
    let url = "", auth = "";
    const c = new RailRadarClient("https://x.test/v1", "sekret", undefined, (async (u: string, init?: RequestInit) => {
      url = u; auth = (init?.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify({ success: true, data: { trains: [] } }), { status: 200 });
    }) as unknown as typeof fetch);
    await c.getStationBoard("TBM", 3);
    expect(url).toBe("https://x.test/v1/stations/TBM/live?hours=4"); // 3 h rounds up to the 4 h window
    expect(auth).toBe("Bearer sekret");
  });
});
