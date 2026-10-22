import { describe, expect, it, vi } from "vitest";
import { MockHass } from "./mocks/hass";
import {
  ExtendedHomeAssistant,
  ForecastMode,
  WeatherForecastCardConfig,
} from "../src/types";
import { ForecastAttribute } from "../src/data/weather";
import {
  ASSUMED_HIGH_HOUR,
  ASSUMED_LOW_HOUR,
  buildTemperatureLine,
} from "../src/data/temperature-line";
import { WfcForecastChart } from "../src/components/wfc-forecast-chart";
import { Chart } from "chart.js";
import { merge } from "lodash-es";
import { createWeatherForecastCardTestFixture } from "./test-utils";

import "../src/index";

// All times are local, like the day names on the chart.
const BASE_DAY = new Date(2026, 9, 22);

const at = (dayOffset: number, hour: number): Date =>
  new Date(
    BASE_DAY.getFullYear(),
    BASE_DAY.getMonth(),
    BASE_DAY.getDate() + dayOffset,
    hour
  );

const dailyEntry = (
  dayOffset: number,
  temperature: number,
  templow: number
): ForecastAttribute => ({
  datetime: at(dayOffset, 12).toISOString(),
  temperature,
  templow,
});

/** Hourly entries from `fromHour` on day 0, for `hours` hours. */
const hourlyEntries = (
  fromHour: number,
  hours: number,
  temperatureAt: (date: Date) => number
): ForecastAttribute[] =>
  Array.from({ length: hours }, (_, i) => {
    const datetime = at(0, fromHour + i);
    return {
      datetime: datetime.toISOString(),
      temperature: temperatureAt(datetime),
    };
  });

const DAILY = [
  dailyEntry(0, 12, 6),
  dailyEntry(1, 13, 7),
  dailyEntry(2, 11, 4),
];

describe("buildTemperatureLine", () => {
  it("uses a point every 3 hours plus each day's warmest and coldest hour", () => {
    // Day 0 and day 1, coldest at 04:00 and warmest at 14:00.
    const hourly = hourlyEntries(0, 48, (date) => {
      const hour = date.getHours();
      return hour === 4 ? 2 : hour === 14 ? 15 : 8;
    });

    const points = buildTemperatureLine(DAILY.slice(0, 2), hourly);
    const day0 = points.filter((p) => p.datetime < at(1, 0));

    expect(day0.map((p) => p.datetime.getHours())).toEqual([
      0, 3, 4, 6, 9, 12, 14, 15, 18, 21,
    ]);
    expect(points.every((p) => !p.assumed)).toBe(true);

    const low = day0.find((p) => p.label === "low")!;
    const high = day0.find((p) => p.label === "high")!;
    expect([low.datetime.getHours(), low.y]).toEqual([4, 2]);
    expect([high.datetime.getHours(), high.y]).toEqual([14, 15]);
  });

  it("places points by time of day within the day's slot", () => {
    const hourly = hourlyEntries(0, 48, () => 10);

    const points = buildTemperatureLine(DAILY.slice(0, 2), hourly);
    const x = (day: number, hour: number) =>
      points.find((p) => p.datetime.getTime() === at(day, hour).getTime())!.x;

    expect(x(0, 0)).toBeCloseTo(-0.5);
    expect(x(0, 12)).toBeCloseTo(0);
    expect(x(1, 6)).toBeCloseTo(0.75);
  });

  it("continues with the daily high and low at assumed times after the hourly data", () => {
    // Hourly data only until day 1 at 02:00.
    const hourly = hourlyEntries(12, 15, () => 10);

    const points = buildTemperatureLine(DAILY, hourly);
    const assumed = points.filter((p) => p.assumed);

    expect(assumed.map((p) => [p.datetime.getTime(), p.y])).toEqual([
      [at(1, ASSUMED_LOW_HOUR).getTime(), 7],
      [at(1, ASSUMED_HIGH_HOUR).getTime(), 13],
      [at(2, ASSUMED_LOW_HOUR).getTime(), 4],
      [at(2, ASSUMED_HIGH_HOUR).getTime(), 11],
    ]);
    expect(assumed.map((p) => p.label)).toEqual(["low", "high", "low", "high"]);

    // No assumed points within the hourly data, including today's past low.
    expect(
      points.filter((p) => p.datetime < at(1, 2)).every((p) => !p.assumed)
    ).toBe(true);
  });

  it("uses only the daily highs and lows without hourly data", () => {
    const points = buildTemperatureLine(DAILY, undefined);

    expect(points).toHaveLength(6);
    expect(points.every((p) => p.assumed)).toBe(true);
    expect(points.map((p) => p.y)).toEqual([6, 12, 7, 13, 4, 11]);
  });
});

describe("chart continuous temperature line", () => {
  const mockHassInstance = new MockHass();
  const hass = mockHassInstance.getHass() as ExtendedHomeAssistant;
  hass.states["weather.open_meteo"] = {
    ...hass.states["weather.demo"]!,
    entity_id: "weather.open_meteo",
  };

  const createCard = async (
    forecastConfig: WeatherForecastCardConfig["forecast"] = {}
  ) => {
    const config: WeatherForecastCardConfig = merge(
      {},
      {
        type: "custom:weather-forecast-card-details",
        entity: "weather.demo",
        forecast: { mode: ForecastMode.Chart, show_sun_times: false },
      },
      { forecast: forecastConfig }
    );

    const { card, chart } = await createWeatherForecastCardTestFixture(
      hass,
      config
    );
    chart!.resize = vi.fn();
    chart!.update = vi.fn();

    const chartElement = card.shadowRoot!.querySelector(
      "wfc-forecast-chart"
    ) as WfcForecastChart;

    return { chartElement, chart: chart as Chart };
  };

  it("keeps the high and low lines by default", async () => {
    const { chart } = await createCard();

    expect(chart.data.datasets).toHaveLength(3);
    expect(chart.options.scales?.xTime).toBeUndefined();
  });

  it("replaces the high and low lines with one line on a time axis", async () => {
    const { chart } = await createCard({ continuous_temperature_line: true });

    const [line, precipitation] = chart.data.datasets;

    expect(chart.data.datasets).toHaveLength(2);
    expect(line!.xAxisID).toBe("xTime");
    expect(line!.data.length).toBeGreaterThan(
      mockHassInstance.dailyForecast.length
    );
    expect(precipitation!.type).toBe("bar");

    const xTime = chart.options.scales?.xTime;
    expect(xTime?.min).toBe(-0.5);
    expect(xTime?.max).toBe(chart.data.labels!.length - 0.5);
  });

  it("subscribes to the hourly forecast of the temperature line entity", async () => {
    const subscribeMessage = vi.spyOn(hass.connection, "subscribeMessage");

    const { chartElement } = await createCard({
      continuous_temperature_line: true,
      temperature_line_entity: "weather.open_meteo",
    });

    expect(subscribeMessage).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        entity_id: "weather.open_meteo",
        forecast_type: "hourly",
      }),
      expect.anything()
    );
    expect(chartElement.temperatureLineForecast?.length).toBeGreaterThan(0);

    subscribeMessage.mockRestore();
  });

  it("does not subscribe to the temperature line entity when the line is off", async () => {
    const subscribeMessage = vi.spyOn(hass.connection, "subscribeMessage");

    await createCard({ temperature_line_entity: "weather.open_meteo" });

    expect(subscribeMessage).not.toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ entity_id: "weather.open_meteo" }),
      expect.anything()
    );

    subscribeMessage.mockRestore();
  });
});
