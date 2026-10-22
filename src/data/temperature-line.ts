import { ForecastAttribute } from "./weather";

/**
 * Local hour at which a daily low is placed when no hourly data covers that day.
 * Lows usually happen around sunrise.
 */
export const ASSUMED_LOW_HOUR = 5;

/**
 * Local hour at which a daily high is placed when no hourly data covers that day.
 * Highs usually happen in the early afternoon.
 */
export const ASSUMED_HIGH_HOUR = 14;

/** Interval in hours between the plotted points taken from hourly data. */
export const TEMPERATURE_LINE_INTERVAL_HOURS = 3;

export type TemperatureLinePoint = {
  /**
   * Position on the daily chart: the index of the day's forecast slot, where
   * `index - 0.5` is the start of that day and `index + 0.5` its end.
   */
  x: number;
  /** Temperature. */
  y: number;
  datetime: Date;
  /** True for a daily high or low placed at an assumed time of day. */
  assumed: boolean;
  /** Set on the points that carry the day's high or low label. */
  label?: "high" | "low";
};

type TimedTemperature = {
  datetime: Date;
  temperature: number;
};

const startOfLocalDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const startOfNextLocalDay = (day: Date): Date =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);

const atLocalHour = (day: Date, hour: number): Date =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour);

const isValidTemperature = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const toTimedTemperatures = (
  forecast: ForecastAttribute[] | undefined
): TimedTemperature[] =>
  (forecast ?? [])
    .filter((f) => isValidTemperature(f.temperature))
    .map((f) => ({
      datetime: new Date(f.datetime),
      temperature: f.temperature,
    }))
    .filter((t) => !isNaN(t.datetime.getTime()))
    .sort((a, b) => a.datetime.getTime() - b.datetime.getTime());

/**
 * Builds one continuous temperature line for the daily forecast chart.
 *
 * Where hourly data is available, the line uses a point every
 * {@link TEMPERATURE_LINE_INTERVAL_HOURS} hours plus each day's warmest and
 * coldest hour. Beyond the end of the hourly data (for example after the 48
 * hours Met.no provides), the line continues through each day's high and low
 * from the daily forecast, placed at {@link ASSUMED_LOW_HOUR} and
 * {@link ASSUMED_HIGH_HOUR} local time and marked as `assumed`.
 *
 * Days are local calendar days, matching the day names shown on the chart.
 *
 * @param daily The daily forecast entries, one per chart slot.
 * @param hourly The hourly forecast used for the line, if any.
 * @returns The line points in time order.
 */
export const buildTemperatureLine = (
  daily: ForecastAttribute[],
  hourly: ForecastAttribute[] | undefined
): TemperatureLinePoint[] => {
  const hourlyTemperatures = toTimedTemperatures(hourly);
  const lastHourlyTime =
    hourlyTemperatures[hourlyTemperatures.length - 1]?.datetime;

  const points: TemperatureLinePoint[] = [];

  daily.forEach((dayForecast, index) => {
    const dayStart = startOfLocalDay(new Date(dayForecast.datetime));
    if (isNaN(dayStart.getTime())) {
      return;
    }

    const dayEnd = startOfNextLocalDay(dayStart);
    const dayLength = dayEnd.getTime() - dayStart.getTime();
    const toPoint = (
      { datetime, temperature }: TimedTemperature,
      assumed: boolean
    ): TemperatureLinePoint => ({
      x: index - 0.5 + (datetime.getTime() - dayStart.getTime()) / dayLength,
      y: temperature,
      datetime,
      assumed,
    });

    const dayHourly = hourlyTemperatures.filter(
      (t) => t.datetime >= dayStart && t.datetime < dayEnd
    );

    const warmest = dayHourly.reduce<TimedTemperature | undefined>(
      (max, t) => (!max || t.temperature > max.temperature ? t : max),
      undefined
    );
    const coldest = dayHourly.reduce<TimedTemperature | undefined>(
      (min, t) => (!min || t.temperature < min.temperature ? t : min),
      undefined
    );

    const dayPoints = dayHourly
      .filter(
        (t) =>
          t === warmest ||
          t === coldest ||
          (t.datetime.getMinutes() === 0 &&
            t.datetime.getHours() % TEMPERATURE_LINE_INTERVAL_HOURS === 0)
      )
      .map((t) => toPoint(t, false));

    const assumedTemperatures = [
      { hour: ASSUMED_LOW_HOUR, temperature: dayForecast.templow },
      { hour: ASSUMED_HIGH_HOUR, temperature: dayForecast.temperature },
    ];

    for (const { hour, temperature } of assumedTemperatures) {
      const datetime = atLocalHour(dayStart, hour);
      if (
        isValidTemperature(temperature) &&
        (!lastHourlyTime || datetime > lastHourlyTime)
      ) {
        dayPoints.push(toPoint({ datetime, temperature }, true));
      }
    }

    dayPoints.sort((a, b) => a.datetime.getTime() - b.datetime.getTime());

    if (dayPoints.length) {
      const high = dayPoints.reduce((max, p) => (p.y > max.y ? p : max));
      const low = dayPoints.reduce((min, p) => (p.y < min.y ? p : min));
      high.label = "high";
      if (low !== high) {
        low.label = "low";
      }
    }

    points.push(...dayPoints);
  });

  return points;
};
