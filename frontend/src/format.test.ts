import { badgeKind, dayHeading, delayText, delayTone, formatAgo, formatCountdown, hhmm, istDay, urgency } from "./format";

describe("format", () => {
  it("renders times in IST regardless of device timezone", () => {
    expect(hhmm("2026-09-21T23:40:00+05:30")).toBe("23:40");
    expect(hhmm("2026-09-21T18:10:00Z")).toBe("23:40"); // 18:10Z == 23:40 IST
    expect(hhmm(null)).toBe("—");
  });
  it("describes delays without inventing certainty", () => {
    expect(delayText(0)).toBe("On time");
    expect(delayText(6)).toBe("+6 min");
    expect(delayText(-2)).toBe("2 min early");
    expect(delayText(null)).toBe("Delay unknown");
    expect(delayTone(null)).toBe("none");
  });
  it("never labels a propagated or scheduled ETA as live", () => {
    expect(badgeKind("actual")).toBe("live");
    expect(badgeKind("live_reported")).toBe("live");
    expect(badgeKind("propagated")).toBe("estimated");
    expect(badgeKind("scheduled")).toBe("scheduled");
  });
});

describe("departure countdowns (TripView style)", () => {
  const now = Date.parse("2026-09-21T08:00:00+05:30");
  const at = (m: number) => now + m * 60_000;
  it("rounds down and never overstates the time left", () => {
    expect(formatCountdown(at(0.5), now)).toBe("Now");
    expect(formatCountdown(at(12.9), now)).toBe("12 min");
    expect(formatCountdown(at(125), now)).toBe("2h 05m");
    expect(formatCountdown(at(3 * 24 * 60 + 5), now)).toBe("in 3 d");
    expect(formatAgo(at(-3), now)).toBe("3 min ago");
    expect(formatAgo(at(-125), now)).toBe("2h 05m ago");
  });
  it("colours by urgency", () => {
    expect([urgency(at(0), now), urgency(at(15), now), urgency(at(16), now)]).toEqual(["now", "soon", "later"]);
  });
  it("groups by IST day, across midnight", () => {
    expect(istDay("2026-09-21T18:40:00Z")).toBe("2026-09-22"); // 00:10 IST next day
    expect(dayHeading("2026-09-21T09:00:00+05:30", now)).toMatch(/^Today · /);
    expect(dayHeading("2026-09-22T09:00:00+05:30", now)).toMatch(/^Tomorrow · /);
  });
});
