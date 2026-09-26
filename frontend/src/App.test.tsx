import { render, screen } from "@testing-library/react";
import { parseHash } from "./App";
import { DelayChip, Freshness, SourceBadge } from "./components/Common";
import { DepartureRow } from "./components/DepartureRow";
import { positionSentence } from "./components/TrainDetail";
import { markerPoint } from "./components/TrainMap";
import type { Journey, Meta, Position, StopRow } from "./api";

const meta = (o: Partial<Meta>): Meta => ({
  data_mode: "scheduled", fetched_at: "2026-09-21T06:00:00+05:30", source: "datameet timetable",
  stale_seconds: null, timetable_note: "NOTE-2016", live_configured: false, ...o,
});

describe("routing", () => {
  it("parses hashes and rejects bad train numbers", () => {
    expect(parseHash("#/train/40005")).toEqual({ page: "train", number: "40005" });
    expect(parseHash("#/train/abc")).toEqual({ page: "home" });
    expect(parseHash("#/station/tbm")).toEqual({ page: "board", code: "TBM" });
  });
  it("parses the trip, train-segment, new and settings screens", () => {
    expect(parseHash("#/trip/msb/tbm")).toEqual({ page: "trip", from: "MSB", to: "TBM", at: null });
    expect(parseHash("#/trip/MSB/TBM?at=2026-09-21T08:00")).toEqual({ page: "trip", from: "MSB", to: "TBM", at: "2026-09-21T08:00" });
    expect(parseHash("#/trip/MSB/MSB")).toEqual({ page: "home" });
    expect(parseHash("#/train/40015/MSB/TBM")).toEqual({ page: "train", number: "40015", from: "MSB", to: "TBM" });
    expect(parseHash("#/new")).toEqual({ page: "new" });
    expect(parseHash("#/settings")).toEqual({ page: "settings" });
  });
});

describe("freshness banner", () => {
  it("says live data is unavailable in scheduled mode and shows the timetable caveat", () => {
    render(<Freshness meta={meta({ live_configured: true })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Live data unavailable — showing timetable");
    expect(screen.getByText("NOTE-2016")).toBeInTheDocument();
  });
  it("turns to the stale style past 300 s", () => {
    render(<Freshness meta={meta({ data_mode: "partial", stale_seconds: 400, source: "x" })} />);
    expect(screen.getByRole("status")).toHaveClass("fresh-stale");
  });
  it("shows fresh age with provider", () => {
    render(<Freshness meta={meta({ data_mode: "live", stale_seconds: 40, source: "railradar live" })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Updated 40 s ago · via railradar live");
  });
});

describe("chips and badges", () => {
  it("gives screen readers text, not just colour", () => {
    render(<><DelayChip delay={6} /><SourceBadge source="propagated" /></>);
    expect(screen.getByLabelText("Delay: +6 min")).toBeInTheDocument();
    expect(screen.getByText(/Estimated/)).toBeInTheDocument();
  });
  it("shows no delay chip at all when the delay is unknown (never a fake 'On time')", () => {
    const { container } = render(<DelayChip delay={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("On time")).not.toBeInTheDocument();
  });
});

const journey: Journey = {
  number: "40015", name: "Beach Tambaram EMU", kind: "EMU", start_date: "2026-09-21",
  eta_at_a: "2026-09-21T07:57:00+05:30", eta_at_b: "2026-09-21T08:52:00+05:30", expected_ride_min: 55,
  delay_at_a: null, state_relative_to_a: "upcoming", platform_at_a: null,
  source_at_a: "scheduled", source_at_b: "scheduled", data_mode: "scheduled", to_name: "Tambaram",
};

it("timetable-only row says 'Due now (timetable)', not a live 'At station' or 'On time'", () => {
  render(<ul><DepartureRow j={{ ...journey, state_relative_to_a: "at_station", delay_at_a: 0 }} now={Date.parse("2026-09-21T07:56:30+05:30")} /></ul>);
  expect(screen.getByText("Due now (timetable)")).toBeInTheDocument();
  expect(screen.queryByText("On time")).not.toBeInTheDocument();
  expect(screen.queryByText("At station")).not.toBeInTheDocument();
});

it("journey row shows big departure time, arrival, source badge and links to the train", () => {
  render(<ul><DepartureRow j={journey} now={Date.parse("2026-09-21T07:40:00+05:30")} /></ul>);
  expect(screen.getByText("17 min").className).toContain("dep-later");
  expect(screen.getByText("07:57")).toBeInTheDocument();
  expect(screen.getByText("08:52")).toBeInTheDocument();
  expect(screen.getByText(/Scheduled/)).toBeInTheDocument();
  expect(screen.getByRole("link")).toHaveAttribute("href", "#/train/40015");
});

const stop = (code: string, name: string, lat: number, lng: number): StopRow => ({
  seq: 0, station_code: code, station_name: name, scheduled: null, eta: "2026-09-21T08:42:00+05:30",
  eta_source: "propagated", delay_min: 4, confidence: "medium", state: "upcoming", stale: false,
  estimated: true, platform: null, lat, lng,
});
const stops = [stop("GDY", "Guindy", 13, 80), stop("SDP", "Saidapet", 13.2, 80.2)];
const between: Position = { kind: "between", station_code: null, prev_station: "GDY", next_station: "SDP", progress: 0.5, estimated: true };

describe("position", () => {
  it("builds the spec sentence with next stop, ETA and delay", () => {
    expect(positionSentence(between, stops)).toBe("Between Guindy and Saidapet — next: Saidapet, ETA 08:42, +4 min");
  });
  it("places the marker by interpolation only when progress is known", () => {
    expect(markerPoint(between, stops)).toEqual([80.1, 13.1]);
    expect(markerPoint({ ...between, progress: null }, stops)).toBeNull();
    expect(markerPoint({ ...between, prev_station: "ZZZ" }, stops)).toBeNull();
  });
});

it("a train that already left shows 'ago', never a due-now chip; a 'leave at' query hides state chips", () => {
  const past = Date.parse("2026-09-21T08:00:00+05:30");
  const { rerender } = render(<ul><DepartureRow j={{ ...journey, state_relative_to_a: "at_station" }} now={past} /></ul>);
  expect(screen.getByText("3 min ago")).toBeInTheDocument();
  expect(screen.queryByText("Due now (timetable)")).not.toBeInTheDocument();
  rerender(<ul><DepartureRow j={{ ...journey, state_relative_to_a: "departed" }} now={past} hideState /></ul>);
  expect(screen.queryByText("Due earlier (timetable)")).not.toBeInTheDocument();
});
