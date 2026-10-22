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
  buildHourlyPrecipitation,
  buildTemperatureLine,
} from "../src/data/hourly-chart";
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
    // Not grouped with the time axis, so the bars stay centered in their slots.
    expect((precipitation as { grouped?: boolean }).grouped).toBe(false);

    // Only the labelled high and low points get a dot.
    const lineOptions = line as unknown as {
      pointRadius: (context: { dataIndex: number }) => number;
      datalabels: {
        formatter: (value: unknown, context: { dataIndex: number }) => unknown;
      };
    };
    const hasDot = line!.data.map(
      (_, dataIndex) => lineOptions.pointRadius({ dataIndex }) > 0
    );
    const hasLabel = line!.data.map(
      (_, dataIndex) =>
        lineOptions.datalabels.formatter(null, { dataIndex }) !== null
    );
    expect(hasDot).toEqual(hasLabel);
    expect(hasDot).toContain(false);

    const xTime = chart.options.scales?.xTime;
    expect(xTime?.min).toBe(-0.5);
    expect(xTime?.max).toBe(chart.data.labels!.length - 0.5);
  });

  const expectHourlySubscription = (
    subscribeMessage: ReturnType<typeof vi.spyOn>,
    entityId: string
  ) =>
    expect(subscribeMessage).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ entity_id: entityId, forecast_type: "hourly" }),
      expect.anything()
    );

  it("subscribes to the hourly forecast of the hourly chart entity", async () => {
    const subscribeMessage = vi.spyOn(hass.connection, "subscribeMessage");

    const { chartElement } = await createCard({
      continuous_temperature_line: true,
      hourly_chart_entity: "weather.open_meteo",
    });

    expectHourlySubscription(subscribeMessage, "weather.open_meteo");
    expect(chartElement.hourlyChartForecast?.length).toBeGreaterThan(0);

    subscribeMessage.mockRestore();
  });

  it("subscribes to the hourly chart entity for hourly precipitation alone", async () => {
    const subscribeMessage = vi.spyOn(hass.connection, "subscribeMessage");

    await createCard({
      hourly_precipitation: "area",
      hourly_chart_entity: "weather.open_meteo",
    });

    expectHourlySubscription(subscribeMessage, "weather.open_meteo");

    subscribeMessage.mockRestore();
  });

  it("still accepts the old temperature_line_entity name", async () => {
    const subscribeMessage = vi.spyOn(hass.connection, "subscribeMessage");

    await createCard({
      continuous_temperature_line: true,
      temperature_line_entity: "weather.open_meteo",
    });

    expectHourlySubscription(subscribeMessage, "weather.open_meteo");

    subscribeMessage.mockRestore();
  });

  it("does not subscribe to the hourly chart entity when no hourly feature is on", async () => {
    const subscribeMessage = vi.spyOn(hass.connection, "subscribeMessage");

    await createCard({ hourly_chart_entity: "weather.open_meteo" });

    expect(subscribeMessage).not.toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ entity_id: "weather.open_meteo" }),
      expect.anything()
    );

    subscribeMessage.mockRestore();
  });
});

describe("buildHourlyPrecipitation", () => {
  it("sums the precipitation per 3 hours, placed at the middle of each interval", () => {
    // Day 0 from 12:00 until day 2 at 01:00, 0.5 mm every hour.
    const hourly = hourlyEntries(12, 38, () => 0).map((f) => ({
      ...f,
      precipitation: 0.5,
    }));

    const { intervals, hourlyDays } = buildHourlyPrecipitation(DAILY, hourly);

    // Day 0 from 12:00 (4 intervals) and all of day 1 (8 intervals).
    expect(intervals).toHaveLength(12);
    expect(intervals.every((i) => i.precipitation === 1.5)).toBe(true);
    expect(intervals[0]!.datetime.getTime()).toBe(at(0, 12).getTime());
    expect(intervals[0]!.x).toBeCloseTo(13.5 / 24 - 0.5);

    // Day 2 is not covered to its end, so it keeps its daily bar.
    expect([...hourlyDays]).toEqual([0, 1]);
  });

  it("returns nothing without hourly precipitation", () => {
    const { intervals, hourlyDays } = buildHourlyPrecipitation(
      DAILY,
      hourlyEntries(0, 72, () => 10)
    );

    expect(intervals).toEqual([]);
    expect(hourlyDays.size).toBe(0);
  });
});

describe("chart hourly precipitation", () => {
  const mockHassInstance = new MockHass();
  // Like Met.no: hourly data only for the next 48 hours.
  mockHassInstance.hourlyForecast = mockHassInstance.hourlyForecast
    .slice(0, 48)
    .map((f) => ({ ...f, precipitation: 1 }));
  const hass = mockHassInstance.getHass() as ExtendedHomeAssistant;

  const createChart = async (
    forecastConfig: WeatherForecastCardConfig["forecast"] = {}
  ): Promise<Chart> => {
    const config: WeatherForecastCardConfig = merge(
      {},
      {
        type: "custom:weather-forecast-card-details",
        entity: "weather.demo",
        forecast: { mode: ForecastMode.Chart, show_sun_times: false },
      },
      { forecast: forecastConfig }
    );

    const { chart } = await createWeatherForecastCardTestFixture(hass, config);
    chart!.resize = vi.fn();
    chart!.update = vi.fn();

    return chart as Chart;
  };

  const findHourlyDataset = (chart: Chart) =>
    chart.data.datasets.find((d) => d.yAxisID === "yPrecipHourly");

  it("keeps only the daily bars by default", async () => {
    const chart = await createChart();

    expect(findHourlyDataset(chart)).toBeUndefined();
  });

  it("adds 3-hour bars on the time axis", async () => {
    const chart = await createChart({ hourly_precipitation: "bars" });
    const hourly = findHourlyDataset(chart);

    expect(hourly?.type).toBe("bar");
    expect(hourly?.xAxisID).toBe("xTime");
    expect(chart.options.scales?.xTime).toBeDefined();
  });

  it("adds a filled area on the time axis", async () => {
    const chart = await createChart({ hourly_precipitation: "area" });
    const hourly = findHourlyDataset(chart) as {
      type?: string;
      fill?: unknown;
      data: { y: number }[];
    };

    expect(hourly.type).toBe("line");
    expect(hourly.fill).toBe("origin");
    // The area starts and ends at zero.
    expect(hourly.data[0]!.y).toBe(0);
    expect(hourly.data[hourly.data.length - 1]!.y).toBe(0);
  });

  it("hides the daily bars of days drawn hourly but keeps the others", async () => {
    const chart = await createChart({ hourly_precipitation: "bars" });
    const daily = chart.data.datasets.find((d) => d.yAxisID === "yPrecip")!;
    const color = daily.backgroundColor as (context: {
      dataIndex: number;
    }) => string;

    // The hourly forecast covers the first day, the daily forecast more days.
    const colors = chart.data.labels!.map((_, dataIndex) =>
      color({ dataIndex })
    );
    expect(colors[0]).toBe("transparent");
    expect(colors[colors.length - 1]).not.toBe("transparent");
  });
});
