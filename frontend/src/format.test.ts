import { badgeKind, delayText, delayTone, hhmm } from "./format";

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
