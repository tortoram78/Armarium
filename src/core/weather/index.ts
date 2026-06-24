// Weather auto-conditions (pure core). The server's Open-Meteo client adapts raw provider JSON into the
// `ForecastData` domain type defined here; `forecastToConditions` then maps that onto the existing
// TripConditions envelope the recommender already reasons over. No networking lives here.

export {
  type ForecastData,
  type ForecastDay,
  type ForecastLocation,
  ForecastDataSchema,
  ForecastDaySchema,
  ForecastLocationSchema,
} from "./forecast";

export { forecastToConditions } from "./forecast-to-conditions";
