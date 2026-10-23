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

const isValidNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const toTimedTemperatures = (
  forecast: ForecastAttribute[] | undefined
): TimedTemperature[] =>
  (forecast ?? [])
    .filter((f) => isValidNumber(f.temperature))
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
        isValidNumber(temperature) &&
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

/** Length in hours of the intervals hourly precipitation is summed over. */
export const PRECIPITATION_INTERVAL_HOURS = 3;

const HOUR_MS = 60 * 60 * 1000;

export type PrecipitationInterval = {
  /** Position of the interval's middle on the daily chart, like {@link TemperatureLinePoint.x}. */
  x: number;
  /** Start of the interval. */
  datetime: Date;
  /** Precipitation summed over the interval. */
  precipitation: number;
};

export type HourlyPrecipitation = {
  intervals: PrecipitationInterval[];
  /** Indexes of the daily slots drawn from hourly data. Other days keep their daily bar. */
  hourlyDays: Set<number>;
};

/**
 * Sums the hourly precipitation into {@link PRECIPITATION_INTERVAL_HOURS} hour
 * intervals for the daily forecast chart.
 *
 * Only days the hourly data covers to their end are included, so the day the
 * hourly data ends in (for example after the 48 hours Met.no provides), and the
 * days after it, keep their daily precipitation bar.
 *
 * @param daily The daily forecast entries, one per chart slot.
 * @param hourly The hourly forecast to take the precipitation from, if any.
 */
export const buildHourlyPrecipitation = (
  daily: ForecastAttribute[],
  hourly: ForecastAttribute[] | undefined
): HourlyPrecipitation => {
  const entries = (hourly ?? [])
    .filter((f) => isValidNumber(f.precipitation))
    .map((f) => ({
      datetime: new Date(f.datetime),
      precipitation: f.precipitation as number,
    }))
    .filter((e) => !isNaN(e.datetime.getTime()))
    .sort((a, b) => a.datetime.getTime() - b.datetime.getTime());

  const intervals: PrecipitationInterval[] = [];
  const hourlyDays = new Set<number>();
  const lastEntryTime = entries[entries.length - 1]?.datetime.getTime();

  if (lastEntryTime === undefined) {
    return { intervals, hourlyDays };
  }

  daily.forEach((dayForecast, index) => {
    const dayStart = startOfLocalDay(new Date(dayForecast.datetime));
    if (isNaN(dayStart.getTime())) {
      return;
    }

    const dayEnd = startOfNextLocalDay(dayStart);
    const dayLength = dayEnd.getTime() - dayStart.getTime();
    const dayEntries = entries.filter(
      (e) => e.datetime >= dayStart && e.datetime < dayEnd
    );

    if (!dayEntries.length || lastEntryTime < dayEnd.getTime() - HOUR_MS) {
      return;
    }

    hourlyDays.add(index);

    for (let hour = 0; hour < 24; hour += PRECIPITATION_INTERVAL_HOURS) {
      const start = atLocalHour(dayStart, hour);
      const end = atLocalHour(dayStart, hour + PRECIPITATION_INTERVAL_HOURS);
      const intervalEntries = dayEntries.filter(
        (e) => e.datetime >= start && e.datetime < end
      );

      // Skip intervals without data, such as the hours that have already passed today.
      if (!intervalEntries.length) {
        continue;
      }

      const middle = (start.getTime() + end.getTime()) / 2;

      intervals.push({
        x: index - 0.5 + (middle - dayStart.getTime()) / dayLength,
        datetime: start,
        precipitation: intervalEntries.reduce(
          (sum, e) => sum + e.precipitation,
          0
        ),
      });
    }
  });

  return { intervals, hourlyDays };
};

/**
 * Removes the label (and so the dot) from the less extreme of two highs, or two
 * lows, that are closer than `minGap` and whose labels would overlap. This is
 * typically one day's low just before midnight and the next day's low just after,
 * which together describe the same night.
 *
 * @param points The temperature line points, in time order. Labels are removed in place.
 * @param minGap The smallest distance between two labels of the same kind, in chart
 * slots (the same unit as {@link TemperatureLinePoint.x}).
 */
export const removeOverlappingLabels = (
  points: TemperatureLinePoint[],
  minGap: number
): void => {
  for (const label of ["high", "low"] as const) {
    let previous: TemperatureLinePoint | undefined;

    for (const point of points) {
      if (point.label !== label) {
        continue;
      }

      if (!previous || point.x - previous.x >= minGap) {
        previous = point;
        continue;
      }

      const pointIsMoreExtreme =
        label === "high" ? point.y > previous.y : point.y < previous.y;

      if (pointIsMoreExtreme) {
        previous.label = undefined;
        previous = point;
      } else {
        point.label = undefined;
      }
    }
  }
};
