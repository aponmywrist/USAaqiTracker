const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const cacheDir = path.join(rootDir, "cache");
const envPath = path.join(rootDir, ".env");
const cityIndexPath = path.join(cacheDir, "city-index.json");
const cachePath = path.join(cacheDir, "aqi-cache.json");

loadEnv(envPath);

const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "127.0.0.1",
  apiKey: process.env.IQAIR_API_KEY || "",
  apiBaseUrl: process.env.IQAIR_BASE_URL || "https://api.airvisual.com/v2",
  country: process.env.IQAIR_COUNTRY || "USA",
  refreshIntervalHours: Number(process.env.REFRESH_INTERVAL_HOURS || 6),
  cityIndexRefreshDays: Number(process.env.CITY_INDEX_REFRESH_DAYS || 7),
  concurrency: Math.max(1, Number(process.env.IQAIR_CONCURRENCY || 4)),
  requestDelayMs: Math.max(0, Number(process.env.IQAIR_REQUEST_DELAY_MS || 750)),
  maxCityCallsPerRefresh: Math.max(
    1,
    Number(process.env.IQAIR_MAX_CITY_CALLS_PER_REFRESH || 1500)
  ),
};

const solarFarms = [
  {
    id: "gemini",
    name: "Gemini Solar Project",
    state: "Nevada",
    lat: 36.5139,
    lon: -114.9527,
    capacityMw: 966,
    note: "One of the largest U.S. solar projects, north of Las Vegas.",
  },
  {
    id: "edwards-sanborn",
    name: "Edwards Sanborn Solar + Storage",
    state: "California",
    lat: 34.8869,
    lon: -117.8727,
    capacityMw: 864,
    note: "Large-scale solar and storage installation in Kern County.",
  },
  {
    id: "lumina",
    name: "Lumina I and II",
    state: "Texas",
    lat: 31.2557,
    lon: -102.776,
    capacityMw: 828,
    note: "Major West Texas solar development.",
  },
  {
    id: "copper-mountain",
    name: "Copper Mountain Solar Facility",
    state: "Nevada",
    lat: 35.7868,
    lon: -114.9921,
    capacityMw: 802,
    note: "Flagship solar complex in southern Nevada.",
  },
  {
    id: "orion-solar-belt",
    name: "Orion Solar Belt",
    state: "Texas",
    lat: 31.9686,
    lon: -99.9018,
    capacityMw: 900,
    note: "Large multi-phase Texas solar belt project.",
  },
  {
    id: "mount-signal",
    name: "Mount Signal Solar",
    state: "California",
    lat: 32.8186,
    lon: -115.3904,
    capacityMw: 794,
    note: "Imperial Valley utility-scale solar complex.",
  },
  {
    id: "roadrunner",
    name: "Roadrunner Solar",
    state: "Texas",
    lat: 31.7619,
    lon: -106.485,
    capacityMw: 497,
    note: "Large El Paso-area solar installation.",
  },
  {
    id: "topaz",
    name: "Topaz Solar Farm",
    state: "California",
    lat: 35.3791,
    lon: -120.0912,
    capacityMw: 550,
    note: "Long-running utility-scale solar farm in San Luis Obispo County.",
  },
];

const state = {
  cityIndex: [],
  cityData: [],
  lastUpdated: null,
  lastAttemptedAt: null,
  isRefreshing: false,
  errors: [],
  nextOffset: 0,
};

ensureDir(cacheDir);
hydrateState();

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === "/api/air-quality") {
    return respondJson(res, 200, getApiPayload());
  }

  if (requestUrl.pathname === "/api/refresh" && req.method === "POST") {
    refreshData({ force: true }).catch((error) => {
      console.error("Forced refresh failed:", error);
    });
    return respondJson(res, 202, { ok: true, message: "Refresh started." });
  }

  if (requestUrl.pathname === "/health") {
    return respondJson(res, 200, {
      ok: true,
      hasApiKey: Boolean(config.apiKey),
      citiesLoaded: state.cityData.length,
      lastUpdated: state.lastUpdated,
      refreshing: state.isRefreshing,
    });
  }

  serveStatic(requestUrl.pathname, res);
});

server.listen(config.port, config.host, () => {
  console.log(`AQI app running at http://${config.host}:${config.port}`);
  refreshData({ force: false }).catch((error) => {
    console.error("Initial refresh failed:", error);
  });
  const intervalMs = config.refreshIntervalHours * 60 * 60 * 1000;
  setInterval(() => {
    refreshData({ force: false }).catch((error) => {
      console.error("Scheduled refresh failed:", error);
    });
  }, intervalMs);
});

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function hydrateState() {
  if (fs.existsSync(cityIndexPath)) {
    const payload = safeReadJson(cityIndexPath, { cities: [], updatedAt: null });
    state.cityIndex = Array.isArray(payload.cities) ? payload.cities : [];
  }

  if (fs.existsSync(cachePath)) {
    const payload = safeReadJson(cachePath, {});
    state.cityData = Array.isArray(payload.cityData) ? payload.cityData : [];
    state.lastUpdated = payload.lastUpdated || null;
    state.lastAttemptedAt = payload.lastAttemptedAt || null;
    state.errors = Array.isArray(payload.errors) ? payload.errors : [];
    state.nextOffset = Number(payload.nextOffset || 0);
  }
}

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function respondJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function serveStatic(requestPath, res) {
  const normalizedPath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.resolve(publicDir, normalizedPath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
    });
    res.end(data);
  });
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath);
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };

  return contentTypes[extension] || "application/octet-stream";
}

function getApiPayload() {
  return {
    hasApiKey: Boolean(config.apiKey),
    country: config.country,
    lastUpdated: state.lastUpdated,
    lastAttemptedAt: state.lastAttemptedAt,
    refreshing: state.isRefreshing,
    citiesDiscovered: state.cityIndex.length,
    citiesLoaded: state.cityData.length,
    nextOffset: state.nextOffset,
    refreshIntervalHours: config.refreshIntervalHours,
    warnings: buildWarnings(),
    solarFarms,
    cityData: state.cityData,
  };
}

function buildWarnings() {
  const warnings = [];

  if (!config.apiKey) {
    warnings.push(
      "Add your IQAir API key in .env to enable live air-quality data."
    );
  }

  if (state.errors.length > 0) {
    warnings.push(...state.errors.slice(-3));
  }

  if (
    config.maxCityCallsPerRefresh < state.cityIndex.length &&
    state.cityIndex.length > 0
  ) {
    warnings.push(
      "Your refresh limit is lower than the discovered city count, so updates will rotate through cities over time."
    );
  }

  return warnings;
}

async function refreshData({ force }) {
  if (state.isRefreshing) {
    return;
  }

  if (!config.apiKey) {
    persistCache();
    return;
  }

  state.isRefreshing = true;
  state.lastAttemptedAt = new Date().toISOString();
  state.errors = [];

  try {
    await refreshCityIndexIfNeeded(force);
    if (state.cityIndex.length === 0) {
      throw new Error("No cities discovered from IQAir.");
    }

    const selectedCities = selectCitiesForRefresh();
    const freshData = await fetchCityBatch(selectedCities);
    const existingByKey = new Map(
      state.cityData.map((city) => [city.cacheKey, city])
    );

    for (const city of freshData) {
      existingByKey.set(city.cacheKey, city);
    }

    state.cityData = Array.from(existingByKey.values()).sort((left, right) => {
      return left.city.localeCompare(right.city) || left.state.localeCompare(right.state);
    });
    state.lastUpdated = new Date().toISOString();
    state.nextOffset =
      (state.nextOffset + selectedCities.length) % state.cityIndex.length;
    persistCache();
  } catch (error) {
    state.errors.push(error.message);
    persistCache();
  } finally {
    state.isRefreshing = false;
  }
}

async function refreshCityIndexIfNeeded(force) {
  const currentIndex = safeReadJson(cityIndexPath, { updatedAt: null, cities: [] });
  const updatedAt = currentIndex.updatedAt ? new Date(currentIndex.updatedAt) : null;
  const ageMs = updatedAt ? Date.now() - updatedAt.getTime() : Infinity;
  const maxAgeMs = config.cityIndexRefreshDays * 24 * 60 * 60 * 1000;

  if (!force && state.cityIndex.length > 0 && ageMs < maxAgeMs) {
    return;
  }

  const statesPayload = await iqAirRequest("/states", {
    country: config.country,
  });

  const states = Array.isArray(statesPayload.data) ? statesPayload.data : [];
  const cities = [];

  for (const entry of states) {
    const stateName = entry.state;
    const cityPayload = await iqAirRequest("/cities", {
      state: stateName,
      country: config.country,
    });
    const stateCities = Array.isArray(cityPayload.data) ? cityPayload.data : [];
    for (const cityEntry of stateCities) {
      cities.push({
        country: config.country,
        state: stateName,
        city: cityEntry.city,
        cacheKey: `${cityEntry.city}::${stateName}::${config.country}`,
      });
    }
    await wait(config.requestDelayMs);
  }

  state.cityIndex = cities;
  fs.writeFileSync(
    cityIndexPath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        cities,
      },
      null,
      2
    )
  );
}

function selectCitiesForRefresh() {
  if (state.cityIndex.length <= config.maxCityCallsPerRefresh) {
    return state.cityIndex;
  }

  const selected = [];
  for (let index = 0; index < config.maxCityCallsPerRefresh; index += 1) {
    const cityIndex = (state.nextOffset + index) % state.cityIndex.length;
    selected.push(state.cityIndex[cityIndex]);
  }
  return selected;
}

async function fetchCityBatch(cities) {
  const queue = [...cities];
  const results = [];
  const workers = Array.from({ length: config.concurrency }, async () => {
    while (queue.length > 0) {
      const city = queue.shift();
      if (!city) {
        return;
      }
      try {
        const payload = await iqAirRequest("/city", city);
        const normalized = normalizeCityPayload(city, payload.data);
        if (normalized) {
          results.push(normalized);
        }
      } catch (error) {
        state.errors.push(
          `Failed to load ${city.city}, ${city.state}: ${error.message}`
        );
      }
      await wait(config.requestDelayMs);
    }
  });

  await Promise.all(workers);
  return results;
}

function normalizeCityPayload(request, data) {
  if (!data || !data.current || !data.current.pollution || !data.location) {
    return null;
  }

  const pollution = data.current.pollution;
  const weather = data.current.weather || {};
  const aqi = Number(pollution.aqius || 0);
  const recommendation = buildRecommendation(aqi);
  const coordinates = Array.isArray(data.location.coordinates)
    ? data.location.coordinates
    : [null, null];

  return {
    cacheKey: request.cacheKey,
    city: data.city || request.city,
    state: data.state || request.state,
    country: data.country || request.country,
    aqi,
    category: classifyAqi(aqi).label,
    advice: recommendation.title,
    recommendation: recommendation.detail,
    primaryPollutant: pollution.mainus || "Unknown",
    pollutionTimestamp: pollution.ts || null,
    weather: {
      temperatureC: Number(weather.tp || 0),
      humidity: Number(weather.hu || 0),
      windKph: Number(weather.ws || 0),
      windDirection: Number(weather.wd || 0),
      pressure: Number(weather.pr || 0),
      icon: weather.ic || "",
    },
    lat: Number(coordinates[1]),
    lon: Number(coordinates[0]),
  };
}

function classifyAqi(aqi) {
  if (aqi <= 50) {
    return { label: "Good", color: "#2ecc71" };
  }
  if (aqi <= 100) {
    return { label: "Moderate", color: "#f1c40f" };
  }
  if (aqi <= 150) {
    return { label: "Unhealthy for Sensitive Groups", color: "#e67e22" };
  }
  if (aqi <= 200) {
    return { label: "Unhealthy", color: "#e74c3c" };
  }
  if (aqi <= 300) {
    return { label: "Very Unhealthy", color: "#8e44ad" };
  }
  return { label: "Hazardous", color: "#6b1d1d" };
}

function buildRecommendation(aqi) {
  if (aqi <= 50) {
    return {
      title: "Open-air conditions look comfortable.",
      detail: "Most people can enjoy normal outdoor activity.",
    };
  }
  if (aqi <= 100) {
    return {
      title: "Outdoor time is generally fine.",
      detail: "Sensitive groups may want to reduce long, intense exertion outside.",
    };
  }
  if (aqi <= 150) {
    return {
      title: "Consider shorter outdoor exposure.",
      detail: "Children, older adults, and people with asthma should favor indoor breaks and masks if needed.",
    };
  }
  if (aqi <= 200) {
    return {
      title: "Limit time outdoors.",
      detail: "For most people, indoor time is the safer default until conditions improve.",
    };
  }
  if (aqi <= 300) {
    return {
      title: "Stay indoors if you can.",
      detail: "Avoid strenuous activity outside and consider leaving the area if poor air is expected to persist.",
    };
  }
  return {
    title: "Treat this as a health event.",
    detail: "Stay indoors, use filtration if available, and consider relocating temporarily if local guidance also flags dangerous conditions.",
  };
}

async function iqAirRequest(endpoint, params) {
  const url = new URL(`${config.apiBaseUrl}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  url.searchParams.set("key", config.apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`IQAir request failed with status ${response.status}`);
  }

  const payload = await response.json();
  if (payload.status !== "success") {
    throw new Error(payload.data?.message || payload.message || "IQAir error");
  }

  return payload;
}

function persistCache() {
  fs.writeFileSync(
    cachePath,
    JSON.stringify(
      {
        cityData: state.cityData,
        lastUpdated: state.lastUpdated,
        lastAttemptedAt: state.lastAttemptedAt,
        nextOffset: state.nextOffset,
        errors: state.errors.slice(-20),
      },
      null,
      2
    )
  );
}

function wait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
