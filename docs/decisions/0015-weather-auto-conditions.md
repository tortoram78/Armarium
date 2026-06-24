# ADR-0015 — Weather auto-conditions: Open-Meteo geocoding + forecast, override-always

**Status:** Accepted
**Date:** 2026-06-24
**Phase:** Phase 3 step 3

---

## Context

Phase 3 steps 1 (real auth + multi-user) and 2 (manufacturer URL enrichment) are in delivery.
Step 3 is weather auto-conditions — the capability that completes the conditions half of the
recommendation loop.

### The gap this fills

The Armarium recommendation engine is built around the `conditions → capabilities` contract:
structured `TripConditions` flows into `deriveRequirements`, which queries the closet via
capability predicates. Phase 1 through 3 step 2 hardened the *classification* half of this loop
(evidence shapes, demotion guard, provenance hierarchy, evidence store, LLM claims contract). The
*conditions input* has remained entirely manual since Phase 1: the user types a free-text
description (parsed by the NL parser) or fills in the structured conditions form directly.

Manual entry works and is always available as a fallback. But it imposes friction that makes the
tool harder to use for quick trip planning — the user must know, recall, or guess temperature
ranges, precipitation likelihood, and wind exposure for a destination and date window before the
engine can advise them.

### What the trip form needs

`TripConditions` (`src/core/recommend/conditions.ts`) already contains the envelope the engine
reasons over:

```ts
type TripConditions = {
  temp_min_c: number | null;       // lowest expected temperature
  temp_max_c: number | null;       // highest expected temperature
  precipitation: 'none' | 'possible' | 'likely' | 'certain';
  wind: 'calm' | 'light' | 'moderate' | 'strong' | 'extreme';
  sun_exposure: 'low' | 'moderate' | 'high';
  duration_days: number | null;
  activity: string[];
  exertion: 'low' | 'moderate' | 'high' | 'extreme';
};
```

A weather service can supply `temp_min_c`, `temp_max_c`, `precipitation`, and `wind` from a real
forecast. `sun_exposure`, `duration_days`, `activity`, and `exertion` remain user-entered — the
weather service does not know the trip's activity or effort level.

### Why a provider decision is needed before implementation

Adding any outbound HTTP dependency to `src/server/` requires an explicit decision (CLAUDE.md:
"anything that would add a dependency or introduce new infrastructure: still ask first"). The
roadmap (step 3) notes the user greenlit **Open-Meteo** as the provider.

### The egress and testing constraint

The engineering lesson from ADR-0011 (URL enrichment) and the engineering log applies here:

> The cloud sandbox cannot reach raw Postgres (5432/6543). Use the Supabase Management API for
> migrations in-sandbox; expect the same egress constraint for any raw-TCP service — test outbound
> HTTP calls (e.g., URL enrichment) against fixtures first, then verify on Vercel.

`api.open-meteo.com` is an HTTPS endpoint; it is not raw TCP. But the cloud sandbox's outbound
HTTPS proxy may or may not pass calls to it. The safe engineering posture — established by ADR-0011
and confirmed by the engineering lesson — is: **all unit and integration tests use captured fixture
responses; live end-to-end verification is performed on Vercel after deployment.** This keeps the
gauntlet hermetic and secret-free.

---

## Decision

### A — Provider: Open-Meteo (free, no API key, no new npm dependency)

**Open-Meteo** is the provider for Phase 3 step 3. It offers:

1. **Geocoding API** — converts a place name string to latitude + longitude. No API key required.
   Endpoint: `https://geocoding-api.open-meteo.com/v1/search?name=<place>&count=1&language=en&format=json`
   Returns: `results[0].{ latitude, longitude, name, country }` or an empty `results` array.

2. **Forecast API** — returns a daily forecast for a lat/lon over a date window. No API key
   required. Endpoint: `https://api.open-meteo.com/v1/forecast` with daily variables:
   `temperature_2m_max`, `temperature_2m_min`, `precipitation_sum`, `precipitation_probability_max`,
   `wind_speed_10m_max`, `weathercode`.

**Why Open-Meteo:**
- **No API key.** No new secret to manage alongside `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_ACCESS_TOKEN`. The gauntlet stays secret-free without conditional logic.
- **No new npm dependency.** Both APIs are called with plain HTTPS `fetch` — the same pattern used
  everywhere else in `src/server/`. No library acquisition, no `ask-first` dependency review.
- **Generous limits.** Open-Meteo is a public, openly-licensed service used widely for hobby and
  research applications. Trip planning triggers at most two API calls (one geocoding, one forecast)
  per trip-form submission where the user supplies a location and dates; this is well within
  non-commercial acceptable use.
- **Authoritative for outdoor planning.** The forecast API provides daily temperature max/min,
  precipitation probability and sum, and max wind speed — exactly the signals the conditions
  envelope needs. `weathercode` provides a machine-readable precipitation and condition category if
  additional derivation rules are warranted in future.
- **Forecast horizon.** Open-Meteo's forecast extends approximately 16 days. Trips with a start
  date beyond the horizon receive no auto-fill; the form falls back to manual entry for the weather
  facets. This limit is surfaced in the UI ("weather data unavailable for dates beyond ~16 days;
  enter conditions manually").

**Contrast with rejected alternatives — see §Alternatives below.**

### B — Flow: location + dates → geocode → forecast → pre-fill → user-overridable

The weather auto-fill flow:

```
Trip form: user enters location string + start date + end date
                 ↓
1. Geocode: GET geocoding-api.open-meteo.com/v1/search?name=<location>
   → lat, lon  (or: geocoding failure → skip auto-fill, leave conditions for manual entry)
                 ↓
2. Forecast: GET api.open-meteo.com/v1/forecast
             ?latitude=<lat>&longitude=<lon>
             &start_date=<YYYY-MM-DD>&end_date=<YYYY-MM-DD>
             &daily=temperature_2m_max,temperature_2m_min,
                    precipitation_sum,precipitation_probability_max,
                    wind_speed_10m_max
             &timezone=auto
   → daily arrays for the date window
   (or: beyond forecast horizon, API error → skip auto-fill)
                 ↓
3. forecastToConditions(dailyData) → partial TripConditions
   (pure derivation — see §C below)
                 ↓
4. Pre-fill the trip form's conditions fields with the derived values
   User sees the derived values already populated; can change any field before saving
                 ↓
5. User submits form → existing planTrip pipeline unchanged
```

The trip form already exists (`/plan`); the auto-fill adds a pre-population step when location
and dates are provided. The conditions form fields remain fully editable.

### C — Derivation contract: `forecastToConditions` (pure function, no I/O)

`forecastToConditions` is a pure function in `src/core/weather/` that maps the raw Open-Meteo
daily arrays to the existing `TripConditions` fields. It does **not** invent new facets — weather
auto-conditions is an input convenience, not a model change.

**Temperature band** — from the daily `temperature_2m_min` and `temperature_2m_max` arrays across
the trip's days:
- `temp_min_c` = minimum of all daily `temperature_2m_min` values (coldest night/morning).
- `temp_max_c` = maximum of all daily `temperature_2m_max` values (warmest afternoon).

**Precipitation** — from `precipitation_sum` and `precipitation_probability_max` across the trip's
days:
- If max daily `precipitation_probability_max` ≥ 70%: `'certain'`
- Else if max daily `precipitation_probability_max` ≥ 40% OR total `precipitation_sum` > 5 mm:
  `'likely'`
- Else if max daily `precipitation_probability_max` ≥ 15% OR total `precipitation_sum` > 1 mm:
  `'possible'`
- Else: `'none'`

**Wind** — from max daily `wind_speed_10m_max` across the trip's days (in km/h):
- ≥ 62 km/h (≈ Beaufort 8, gale): `'extreme'`
- ≥ 39 km/h (≈ Beaufort 6, strong breeze): `'strong'`
- ≥ 20 km/h (≈ Beaufort 4, moderate breeze): `'moderate'`
- ≥ 6 km/h (≈ Beaufort 2, light breeze): `'light'`
- < 6 km/h: `'calm'`

**Fields not derived from weather:** `sun_exposure`, `duration_days`, `activity`, `exertion`.
These are trip-intent fields that a weather forecast does not supply. They remain manual.

**Unknown/failed forecast → leave conditions for manual entry.** If geocoding returns no result,
if the date window falls outside the forecast horizon, or if either API call fails (network error,
4xx, 5xx), the form fields are left at their default state. Unknown is first-class: never fabricate
a condition (architecture rule #2, ADR-0004).

**Output type:** `Partial<Pick<TripConditions, 'temp_min_c' | 'temp_max_c' | 'precipitation' | 'wind'>>`
The return type is partial — only the fields the function can derive; absent fields are absent, not
null-filled. Callers merge onto the form's current state.

### D — Architecture split (enforces the purity invariant)

| What | Where | Why |
|------|-------|-----|
| `forecastToConditions(daily) → Partial<TripConditions>` | `src/core/weather/forecast-to-conditions.ts` | Pure function on data; no I/O; fully unit-testable with fixture data |
| Open-Meteo client: geocode + fetch forecast | `src/server/weather-fetcher.ts` | Network I/O; injected into the route handler as a dependency; never called from `src/core/` |
| Zod schemas for Open-Meteo API responses | `src/core/weather/open-meteo-schema.ts` | Pure validation; used by both the server fetcher and fixture-based tests |
| Trip form auto-fill wiring | `src/app/plan/` (route handler or server action) | Calls `weather-fetcher.ts`, passes result to `forecastToConditions`, returns derived conditions to the form |

`src/core/weather/` has no I/O and no `next/*` imports — consistent with the purity invariant
(architecture rule #3, ADR-0011 §C). The weather fetcher is injected as a dependency, not imported
directly into core.

### E — Override-always: auto-fill is convenience, manual entry is always valid

Auto-fill pre-populates the conditions form but never locks it. The user can:
- Change any auto-filled field before submitting.
- Leave conditions blank and use the NL description path (the existing trip description parser).
- Submit without a location or dates — the auto-fill step is simply skipped.

This is not an "AI-asserts-the-conditions" model. The recommendation engine receives a
`TripConditions` value that the user has reviewed and may have edited. The engine's downstream
behavior is unchanged regardless of whether conditions were auto-filled or manually entered.

### F — Short-TTL in-memory cache to avoid duplicate calls within a session

A geocoding call + a forecast call are triggered each time the trip form is submitted with a
location and dates. To avoid duplicate API calls within a single planning session (e.g. the user
adjusts only the activity field and re-submits), a short-TTL in-memory cache keyed on
`(normalized_location_string, start_date, end_date) → GeocodedForecast` is maintained in the
server process. Cache entries expire after a short TTL (suggested: 10 minutes) and the entire
cache is bounded by a small entry cap (suggested: 50 entries) to prevent unbounded memory growth.

No persistence is required. This is a per-process session-level convenience, not a durable store.
If the server restarts or the cache entry expires, the next form submission re-fetches from Open-Meteo.

### G — Testing: fixture-based in-sandbox; live verification on Vercel

Consistent with ADR-0011 §E and the engineering lesson on egress:

- **Unit tests** for `forecastToConditions` use hardcoded input objects (no HTTP). Full coverage of
  the derivation thresholds (temperature band, precipitation tiers, wind tiers), the fallback to
  partial/empty when arrays are empty or missing, and the ≥3-archetype generality requirement (e.g.
  alpine winter, desert summer, coastal rainy).
- **Integration tests** for the Open-Meteo response schemas use **fixture JSON files** (saved
  responses from `geocoding-api.open-meteo.com` and `api.open-meteo.com`), injected as the
  fetch result. The `weather-fetcher.ts` module accepts an injected `fetch` function (or the Zod
  schema validator) to enable offline testing.
- **Live end-to-end verification** (enter a location and dates in the trip form; confirm that
  conditions auto-populate with plausible values; confirm the form is editable) is performed on
  Vercel after deployment, where outbound HTTPS to Open-Meteo is available.

The gauntlet (`typecheck / lint / test / build`) remains completely hermetic — no network, no
API key, no env vars required.

---

## Alternatives rejected

### Paid weather API with an API key (e.g. OpenWeatherMap, Tomorrow.io, WeatherAPI)

Paid services offer additional features (hourly forecasts, historical data, more granular
precipitation types). Rejected because:

- Requires a new secret (`WEATHER_API_KEY`) to manage across dev, sandbox, CI, and Vercel. The
  gauntlet would require conditional logic or the key would need to be present at test time (which
  violates the hermetic-gate engineering lesson: "The hermetic gate requires zero env — no
  exceptions").
- Introduces ongoing cost and a billing relationship that needs monitoring.
- The data quality difference for the 7-day outdoor trip planning use case is marginal compared
  to Open-Meteo, which sources from NOAA, ECMWF, and other authoritative national weather services.
- Open-Meteo is already the user-greenlit choice.

### Hardcoded seasonal/elevation tables (no API)

For any location + month, return a statistical seasonal average (e.g. "Colorado Rockies, July →
temp range 10–24 °C, precipitation: possible, wind: moderate"). Rejected because:

- This is the anti-pattern this project exists to avoid: hardcoded lookup tables instead of
  reasoned derivation. Seasonal averages tell the user nothing about the specific week they are
  planning (a July week in the Rockies can be 5 °C and stormy or 28 °C and clear).
- Maintaining such a table is ongoing, high-effort work, and it still wouldn't cover novel
  destinations.
- Architecture rule #1 explicitly forbids hardcoded outputs where reasoning over data produces a
  better result.

### Making weather auto-fill mandatory (conditions not submittable without a forecast)

Requiring a location and date and a successful forecast before the trip form can be submitted.
Rejected because:

- Breaks offline use and the planned / hypothetical trip use case (user wants to plan "a week in
  the Alps next summer" without specifying dates yet).
- The fallback contract — "unknown forecast → leave conditions for manual entry" — is the
  first-class path, not an edge case. Manual entry must always be valid.
- Forces a live network dependency into the trip-submission critical path. A transient Open-Meteo
  outage would prevent users from saving trips.

### Client-side (browser) fetch of Open-Meteo

Call the Open-Meteo APIs directly from the browser instead of via the server. Open-Meteo's
geocoding and forecast APIs support CORS from browsers. This would avoid any server-side fetch.
Rejected because:

- It breaks the purity invariant: `src/core/weather/` calls no I/O, but a client-side pattern
  would require network calls from the component layer, mixing concerns.
- It exposes the implementation detail (the specific Open-Meteo endpoint URLs) in client-side
  code, making it harder to swap providers later.
- It removes the server-side caching layer (§F): each browser tab would make independent API calls
  for the same location+dates.
- The existing architecture (server action → server fetcher → pure derivation) is already
  established by the NL parser and URL enrichment patterns; consistent patterns reduce cognitive
  overhead for implementors.

---

## Consequences

### Less friction, conditions become evidence-grounded

The most common friction point for new trips — estimating temperature ranges and precipitation
for an unfamiliar destination — is eliminated for trips within the 16-day forecast horizon. The
user provides location and dates (already natural planning inputs); the engine derives the
conditions envelope from real forecast data. The recommendation engine then reasons over a
`TripConditions` value that reflects actual expected weather rather than the user's best guess.

### The recommendation engine is unchanged

`deriveRequirements` and `planTrip` receive the same `TripConditions` shape regardless of how
it was populated. The capability predicates, the gap analysis, and the output contract are
completely unchanged. Weather auto-conditions is a conditions-input convenience — it does not touch
the reasoning layer.

### Override-always keeps the user in control

Auto-filled conditions are a starting point. A user planning an alpine trip who knows from
experience that temperatures will be lower than the lowland forecast shows can adjust the values
before submitting. The form remains fully editable.

### Forecast horizon limit: trips beyond ~16 days get no auto-fill

Open-Meteo's forecast horizon is approximately 16 days. For trips starting beyond that window —
a common case for longer-lead planning — auto-fill is unavailable. The form falls back to manual
entry and the UI notes the limitation. This is an honest, user-surfaced constraint, not a silent
failure.

### No new secret, no new dependency, hermetic gauntlet preserved

The gauntlet (`typecheck / lint / test / build`) requires zero env vars both before and after this
feature. Open-Meteo requires no API key. The pure core functions are tested with fixture data. The
live-fetch path is in `src/server/` and is injected, not imported into core.

### Rate-limit politeness

Open-Meteo is a free public service. The short-TTL in-memory cache (§F) prevents duplicate calls
for the same location+dates within a planning session. The trip form submission is human-paced
(not automated), so call volume per deployment is naturally bounded. If usage scales to levels
where politeness is a concern, the cache TTL or entry cap can be tuned, or a server-side
persistent cache added — without changing the core or the UI contract.

### Testing environment consistency

All unit and integration tests use fixture data (no outbound HTTP). The live verification step on
Vercel validates the real API response path. This is the same testing posture as ADR-0011 (URL
enrichment) and is proven by the engineering lesson documented for that feature.

---

## Relationship to the roadmap and prior ADRs

This ADR implements **Phase 3 step 3** from `docs/roadmap.md` (greenlit 2026-06-20).

- **ADR-0005** (conditions → capabilities engine) defined the `TripConditions` shape that
  `forecastToConditions` must emit into. This ADR does not change that shape.
- **ADR-0011** (manufacturer URL enrichment) established the egress/fixture testing posture and
  the architecture split (pure core + injected server fetcher) that this ADR follows exactly.
- **ADR-0004** (classification contract) established "unknown is first-class; never fabricate" —
  the same principle governs failed/missing forecasts here (leave conditions for manual entry;
  never invent a condition).

Phase 3 step 4 (catalog gap-fill suggestions) is the next item in sequence and does not depend
on this ADR being shipped first, but both are independent initiatives within Phase 3.
