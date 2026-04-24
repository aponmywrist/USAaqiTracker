# United States AQI Atlas

Interactive website for exploring IQAir AQI data across the United States.

## What it includes

- Full-screen U.S. map with clickable AQI city markers
- Search bar for city and state lookup
- AQI-based health recommendations
- Hotspot and clean-air leaderboards
- Major U.S. solar farm icons and popups
- Server-side IQAir syncing so the API key stays private
- Cached live data with scheduled refreshes a few times per day

## Run it

1. Copy `.env.example` to `.env`
2. Add your `IQAIR_API_KEY`
3. Start the server:

```bash
npm start
```

4. Open `http://localhost:3000`

## Important note about IQAir quotas

IQAir's published API plans currently mention Community, Startup, and Enterprise tiers, and the Community tier is much lower quota than paid plans. A nationwide "all cities" refresh can require far more calls than a free-tier key allows.

Because of that, this app is built to:

- cache prior city results
- refresh on a schedule
- rotate through cities when `IQAIR_MAX_CITY_CALLS_PER_REFRESH` is lower than the discovered city count

If your plan has enough quota, raise `IQAIR_MAX_CITY_CALLS_PER_REFRESH` so the full U.S. dataset can refresh in each cycle.

## Config

- `REFRESH_INTERVAL_HOURS`: how often to refresh cached AQI data
- `CITY_INDEX_REFRESH_DAYS`: how often to rediscover the list of U.S. cities
- `IQAIR_CONCURRENCY`: number of concurrent city-detail requests
- `IQAIR_REQUEST_DELAY_MS`: delay between IQAir requests per worker
- `IQAIR_MAX_CITY_CALLS_PER_REFRESH`: max city-detail calls per refresh cycle

## Assumptions

This implementation uses the IQAir AirVisual-style API endpoint structure for `states`, `cities`, and `city` lookups. If your account exposes slightly different endpoint paths, update `server.js` in the `iqAirRequest` callers.
