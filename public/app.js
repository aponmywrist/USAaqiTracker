const map = L.map("map", {
  zoomControl: false,
  minZoom: 3,
  maxZoom: 12,
});

L.control.zoom({ position: "bottomright" }).addTo(map);

map.setView([39.5, -98.35], 4);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const cityLayer = L.layerGroup().addTo(map);
const solarLayer = L.layerGroup().addTo(map);
const cityMarkers = new Map();

const elements = {
  search: document.getElementById("city-search"),
  locate: document.getElementById("locate-me"),
  refresh: document.getElementById("refresh-data"),
  toggleCities: document.getElementById("toggle-cities"),
  toggleSolar: document.getElementById("toggle-solar"),
  detail: document.getElementById("city-detail"),
  hotspots: document.getElementById("hotspots"),
  cleanest: document.getElementById("cleanest"),
  warnings: document.getElementById("warnings"),
  lastUpdated: document.getElementById("last-updated"),
  statCities: document.getElementById("stat-cities"),
  statAverage: document.getElementById("stat-average"),
  statWorst: document.getElementById("stat-worst"),
};

let latestPayload = null;
let selectedCity = null;

bootstrap();

async function bootstrap() {
  bindEvents();
  await loadData();
}

function bindEvents() {
  elements.search.addEventListener("input", handleSearch);
  elements.refresh.addEventListener("click", triggerRefresh);
  elements.locate.addEventListener("click", findMyArea);
  elements.toggleCities.addEventListener("change", syncLayerVisibility);
  elements.toggleSolar.addEventListener("change", syncLayerVisibility);
}

async function loadData() {
  try {
    const response = await fetch("/api/air-quality");
    latestPayload = await response.json();
    render(latestPayload);
  } catch (error) {
    elements.warnings.innerHTML = `<div class="warning"><span>Could not load air-quality data.</span><small>${error.message}</small></div>`;
  }
}

function render(payload) {
  const cities = Array.isArray(payload.cityData) ? payload.cityData : [];
  renderStats(cities);
  renderWarnings(payload);
  renderCityMarkers(cities);
  renderSolarFarms(payload.solarFarms || []);
  renderLists(cities);
  syncLayerVisibility();

  if (!selectedCity && cities.length > 0) {
    selectCity(cities[0]);
  } else if (selectedCity) {
    const refreshedCity = cities.find((city) => city.cacheKey === selectedCity.cacheKey);
    if (refreshedCity) {
      selectCity(refreshedCity);
    }
  }

  elements.lastUpdated.textContent = payload.lastUpdated
    ? `Updated ${formatDate(payload.lastUpdated)}`
    : "No live update yet";
}

function renderStats(cities) {
  elements.statCities.textContent = String(cities.length);
  if (cities.length === 0) {
    elements.statAverage.textContent = "--";
    elements.statWorst.textContent = "--";
    return;
  }

  const average = Math.round(
    cities.reduce((sum, city) => sum + city.aqi, 0) / cities.length
  );
  const worst = [...cities].sort((left, right) => right.aqi - left.aqi)[0];

  elements.statAverage.textContent = String(average);
  elements.statWorst.textContent = `${worst.city}, ${worst.state}`;
}

function renderWarnings(payload) {
  const warnings = payload.warnings || [];
  if (warnings.length === 0) {
    elements.warnings.className = "notes-panel empty";
    elements.warnings.textContent = "No current warnings. Cached AQI data is available for browsing.";
    return;
  }

  elements.warnings.className = "notes-panel";
  elements.warnings.innerHTML = warnings
    .map(
      (warning) =>
        `<div class="warning"><span>${escapeHtml(warning)}</span></div>`
    )
    .join("");
}

function renderLists(cities) {
  const hottest = [...cities].sort((left, right) => right.aqi - left.aqi).slice(0, 5);
  const cleanest = [...cities].sort((left, right) => left.aqi - right.aqi).slice(0, 5);

  renderListPanel(elements.hotspots, hottest);
  renderListPanel(elements.cleanest, cleanest);
}

function renderListPanel(container, cities) {
  if (cities.length === 0) {
    container.className = "list-panel empty";
    container.textContent = "Waiting for city data.";
    return;
  }

  container.className = "list-panel";
  container.innerHTML = cities
    .map(
      (city) => `
        <button class="list-item" type="button" data-key="${city.cacheKey}">
          <span>
            ${escapeHtml(city.city)}, ${escapeHtml(city.state)}
            <small>${escapeHtml(city.category)}</small>
          </span>
          <strong>${city.aqi}</strong>
        </button>
      `
    )
    .join("");

  container.querySelectorAll("[data-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const city = latestPayload.cityData.find(
        (item) => item.cacheKey === button.dataset.key
      );
      if (city) {
        selectCity(city, true);
      }
    });
  });
}

function renderCityMarkers(cities) {
  cityLayer.clearLayers();
  cityMarkers.clear();

  cities
    .filter((city) => Number.isFinite(city.lat) && Number.isFinite(city.lon))
    .forEach((city) => {
      const marker = L.marker([city.lat, city.lon], {
        icon: createCityIcon(city.aqi),
        title: `${city.city}, ${city.state}`,
      });

      marker.on("click", () => selectCity(city));
      marker.bindPopup(
        `
          <strong>${escapeHtml(city.city)}, ${escapeHtml(city.state)}</strong><br />
          AQI ${city.aqi} · ${escapeHtml(city.category)}<br />
          Main pollutant: ${escapeHtml(city.primaryPollutant)}
        `
      );

      marker.addTo(cityLayer);
      cityMarkers.set(city.cacheKey, marker);
    });
}

function renderSolarFarms(farms) {
  solarLayer.clearLayers();
  farms.forEach((farm) => {
    const marker = L.marker([farm.lat, farm.lon], {
      icon: L.divIcon({
        html: "☀",
        className: "solar-marker",
        iconSize: [30, 30],
      }),
      title: farm.name,
    });

    marker.bindPopup(
      `
        <strong>${escapeHtml(farm.name)}</strong><br />
        ${escapeHtml(farm.state)}<br />
        Capacity: ${farm.capacityMw} MW<br />
        ${escapeHtml(farm.note)}
      `
    );
    marker.addTo(solarLayer);
  });
}

function handleSearch(event) {
  const query = event.target.value.trim().toLowerCase();
  if (!latestPayload || !latestPayload.cityData) {
    return;
  }

  if (!query) {
    return;
  }

  const match = latestPayload.cityData.find((city) => {
    return (
      city.city.toLowerCase().includes(query) ||
      city.state.toLowerCase().includes(query)
    );
  });

  if (match) {
    selectCity(match, true);
  }
}

async function triggerRefresh() {
  elements.refresh.disabled = true;
  elements.refresh.textContent = "Refreshing...";
  try {
    await fetch("/api/refresh", { method: "POST" });
    await wait(1200);
    await loadData();
  } finally {
    elements.refresh.disabled = false;
    elements.refresh.textContent = "Refresh data";
  }
}

function selectCity(city, flyTo = false) {
  selectedCity = city;
  elements.detail.className = "city-detail";
  elements.detail.innerHTML = `
    <div class="city-title">
      <div>
        <h2>${escapeHtml(city.city)}, ${escapeHtml(city.state)}</h2>
        <span class="category-pill">${escapeHtml(city.category)}</span>
      </div>
      <div class="aqi-badge" style="background:${aqiColor(city.aqi)}">${city.aqi}</div>
    </div>
    <div class="recommendation">
      <strong>${escapeHtml(city.advice)}</strong>
      <span>${escapeHtml(city.recommendation)}</span>
    </div>
    <div class="metric-grid">
      <article class="metric">
        <span class="metric-label">Main pollutant</span>
        <span class="metric-value">${escapeHtml(city.primaryPollutant)}</span>
      </article>
      <article class="metric">
        <span class="metric-label">Temperature</span>
        <span class="metric-value">${city.weather.temperatureC}&deg;C</span>
      </article>
      <article class="metric">
        <span class="metric-label">Humidity</span>
        <span class="metric-value">${city.weather.humidity}%</span>
      </article>
      <article class="metric">
        <span class="metric-label">Wind</span>
        <span class="metric-value">${city.weather.windKph} km/h</span>
      </article>
    </div>
    <div class="metric">
      <span class="metric-label">Observed at</span>
      <span class="metric-value">${city.pollutionTimestamp ? formatDate(city.pollutionTimestamp) : "Unknown"}</span>
    </div>
  `;

  if (flyTo && Number.isFinite(city.lat) && Number.isFinite(city.lon)) {
    map.flyTo([city.lat, city.lon], Math.max(map.getZoom(), 7), {
      duration: 1.2,
    });
  }

  const marker = cityMarkers.get(city.cacheKey);
  if (marker) {
    marker.openPopup();
  }
}

function syncLayerVisibility() {
  if (elements.toggleCities.checked) {
    if (!map.hasLayer(cityLayer)) {
      map.addLayer(cityLayer);
    }
  } else if (map.hasLayer(cityLayer)) {
    map.removeLayer(cityLayer);
  }

  if (elements.toggleSolar.checked) {
    if (!map.hasLayer(solarLayer)) {
      map.addLayer(solarLayer);
    }
  } else if (map.hasLayer(solarLayer)) {
    map.removeLayer(solarLayer);
  }
}

function findMyArea() {
  if (!navigator.geolocation) {
    return;
  }

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      map.flyTo([coords.latitude, coords.longitude], 8, { duration: 1.2 });
      const nearest = nearestCity(coords.latitude, coords.longitude);
      if (nearest) {
        selectCity(nearest, false);
      }
    },
    () => {}
  );
}

function nearestCity(lat, lon) {
  if (!latestPayload || !latestPayload.cityData) {
    return null;
  }

  let bestCity = null;
  let bestDistance = Infinity;
  latestPayload.cityData.forEach((city) => {
    if (!Number.isFinite(city.lat) || !Number.isFinite(city.lon)) {
      return;
    }
    const distance = Math.hypot(lat - city.lat, lon - city.lon);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCity = city;
    }
  });
  return bestCity;
}

function createCityIcon(aqi) {
  return L.divIcon({
    html: `<span class="city-marker" style="background:${aqiColor(aqi)}">${aqi}</span>`,
    className: "",
    iconSize: [32, 32],
  });
}

function aqiColor(aqi) {
  if (aqi <= 50) return "#2ecc71";
  if (aqi <= 100) return "#f1c40f";
  if (aqi <= 150) return "#e67e22";
  if (aqi <= 200) return "#e74c3c";
  if (aqi <= 300) return "#8e44ad";
  return "#6b1d1d";
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function wait(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}
