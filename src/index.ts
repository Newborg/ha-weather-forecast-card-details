import { WeatherForecastCard } from "./weather-forecast-card";
import * as pjson from "../package.json";
import "./editor/weather-forecast-card-editor";

declare global {
  interface Window {
    customCards: Array<object>;
  }
}

customElements.define("weather-forecast-card-details", WeatherForecastCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "weather-forecast-card-details",
  name: "Weather Forecast Card Details",
  description:
    "Weather forecast card for Home Assistant, with precipitation details",
});

console.info(
  `%cWEATHER-FORECAST-CARD-DETAILS %c${pjson.version}`,
  "color: orange; font-weight: bold; background: black",
  "color: white; font-weight: bold; background: dimgray"
);
