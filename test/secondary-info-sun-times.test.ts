import { describe, expect, it } from "vitest";
import { fixture } from "@open-wc/testing";
import { html } from "lit";
import * as SunCalc from "suncalc";
import { MockHass } from "./mocks/hass";
import { ExtendedHomeAssistant } from "../src/types";
import { WeatherEntity } from "../src/data/weather";
import { formatTimeParts } from "../src/helpers";
import { WfcCurrentWeather } from "../src/components/wfc-current-weather";

import "../src/components/wfc-current-weather";

const config = {
  type: "custom:weather-forecast-card-details",
  entity: "weather.demo",
  current: { secondary_info_attribute: "sun_times" },
};

const renderCurrentWeather = async (
  hass: ExtendedHomeAssistant
): Promise<WfcCurrentWeather> => {
  const el = await fixture<WfcCurrentWeather>(
    html`<wfc-current-weather
      .hass=${hass}
      .weatherEntity=${hass.states["weather.demo"] as WeatherEntity}
      .config=${config}
    ></wfc-current-weather>`
  );
  await el.updateComplete;
  return el;
};

describe("secondary_info_attribute: sun_times", () => {
  it("shows today's sunrise and sunset times with sunrise and sunset icons", async () => {
    const hass = new MockHass().getHass() as ExtendedHomeAssistant;
    const el = await renderCurrentWeather(hass);

    const { latitude, longitude } = hass.config;
    const times = SunCalc.getTimes(new Date(), latitude, longitude);
    const expected = [times.sunrise, times.sunset].map((date) => {
      const { time, suffix } = formatTimeParts(hass, date);
      return suffix ? `${time} ${suffix}` : time;
    });

    const secondaryInfo = el.querySelector(".wfc-current-secondary-info")!;
    const icons = [
      ...secondaryInfo.querySelectorAll("ha-attribute-icon"),
    ] as (HTMLElement & { icon: string })[];
    const values = [
      ...secondaryInfo.querySelectorAll(".wfc-current-secondary-value"),
    ].map((value) => value.textContent?.trim());

    expect(icons.map((icon) => icon.icon)).toEqual([
      "mdi:weather-sunset-up",
      "mdi:weather-sunset-down",
    ]);
    expect(values).toEqual(expected);
  });

  it("falls back to the default secondary info when the location is unknown", async () => {
    const hass = new MockHass().getHass() as ExtendedHomeAssistant;
    hass.config = { ...hass.config, latitude: 0, longitude: 0 };

    const el = await renderCurrentWeather(hass);

    expect(el.querySelector(".wfc-current-secondary-sunset-icon")).toBeNull();
  });
});
