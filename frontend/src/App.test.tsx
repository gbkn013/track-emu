import { render, screen } from "@testing-library/react";
import { parseHash } from "./App";
import { DelayChip, Freshness, SourceBadge } from "./components/Common";
import { JourneyRow } from "./components/Home";
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
  render(<ul><JourneyRow j={{ ...journey, state_relative_to_a: "at_station", delay_at_a: 0 }} /></ul>);
  expect(screen.getByText("Due now (timetable)")).toBeInTheDocument();
  expect(screen.queryByText("On time")).not.toBeInTheDocument();
  expect(screen.queryByText("At station")).not.toBeInTheDocument();
});

it("journey row shows big departure time, arrival, source badge and links to the train", () => {
  render(<ul><JourneyRow j={journey} /></ul>);
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
