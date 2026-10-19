import { describe, expect, it, vi } from "vitest";
import { MockHass } from "./mocks/hass";
import {
  ExtendedHomeAssistant,
  ForecastMode,
  WeatherForecastCardConfig,
} from "../src/types";
import {
  ForecastAttribute,
  formatPrecipitationProbability,
} from "../src/data/weather";
import { WfcForecastChart } from "../src/components/wfc-forecast-chart";
import { Chart } from "chart.js";
import { merge } from "lodash-es";
import { createWeatherForecastCardTestFixture } from "./test-utils";

import "../src/index";

const DAY_MS = 86400000;

const forecastDay = (
  index: number,
  precipitation: number,
  precipitation_probability?: number
): ForecastAttribute => ({
  datetime: new Date(Date.now() + index * DAY_MS).toISOString(),
  temperature: 10,
  templow: 5,
  condition: "rainy",
  humidity: 80,
  precipitation,
  precipitation_probability,
});

const FORECAST: ForecastAttribute[] = [
  forecastDay(0, 5.6, 85),
  forecastDay(1, 0, 25),
  forecastDay(2, 2, 4),
  forecastDay(3, 0, 0),
  forecastDay(4, 1, undefined),
];

type DataLabelOptions = {
  offset?: number;
  color?: string;
  formatter?: (value: unknown, context: { dataIndex: number }) => string;
  labels?: Record<string, DataLabelOptions>;
};

describe("formatPrecipitationProbability", () => {
  it("formats probabilities like the extra attribute", () => {
    expect(formatPrecipitationProbability(undefined)).toBe("");
    expect(formatPrecipitationProbability(0)).toBe("");
    expect(formatPrecipitationProbability(0.4)).toBe("");
    expect(formatPrecipitationProbability(4)).toBe("<10%");
    expect(formatPrecipitationProbability(9.4)).toBe("<10%");
    expect(formatPrecipitationProbability(10)).toBe("10%");
    expect(formatPrecipitationProbability(84.6)).toBe("85%");
  });
});

describe("chart precipitation probability", () => {
  const mockHassInstance = new MockHass();
  mockHassInstance.dailyForecast = FORECAST;
  const hass = mockHassInstance.getHass() as ExtendedHomeAssistant;

  const createChart = async (
    forecastConfig: WeatherForecastCardConfig["forecast"] = {}
  ): Promise<{ chartElement: WfcForecastChart; chart: Chart }> => {
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

    return { chartElement, chart: chart! };
  };

  const getChartHeight = (chartElement: WfcForecastChart): number =>
    parseInt(
      (chartElement.querySelector(".wfc-forecast-chart") as HTMLElement).style
        .height
    );

  const getPrecipitationDatalabels = (chart: Chart): DataLabelOptions =>
    // Dataset 2 is precipitation (bar chart)
    chart.data.datasets[2].datalabels as DataLabelOptions;

  it("does not show the probability by default", async () => {
    const { chartElement, chart } = await createChart();

    expect(getPrecipitationDatalabels(chart).labels).toBeUndefined();
    expect(chart.data.datasets[2].data).toEqual([5.6, null, 2, null, 1]);
    expect(getChartHeight(chartElement)).toBe(130);
  });

  it("shows the probability below the precipitation amount", async () => {
    const { chartElement, chart } = await createChart({
      show_precipitation_probability: true,
    });

    const datalabels = getPrecipitationDatalabels(chart);
    const probability = datalabels.labels!.probability;

    expect(datalabels.labels!.amount).toEqual({});
    expect(probability.offset).toBe(datalabels.offset! - 14);
    expect(
      FORECAST.map((_, dataIndex) =>
        probability.formatter!(null, { dataIndex })
      )
    ).toEqual(["85%", "25%", "<10%", "", ""]);

    // A dry slot with a probability gets a zero height bar so its label renders.
    expect(chart.data.datasets[2].data).toEqual([5.6, 0, 2, null, 1]);

    // The chart grows by one label line to fit the probability.
    expect(getChartHeight(chartElement)).toBe(144);
  });

  it("does not reserve space when another chart attribute is shown", async () => {
    const { chartElement } = await createChart({
      show_precipitation_probability: true,
      default_chart_attribute: "humidity",
    });

    expect(getChartHeight(chartElement)).toBe(130);
  });
});
