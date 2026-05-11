"use strict";

const GEO_API = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_API = "https://api.open-meteo.com/v1/forecast";
const TIME_API = "https://worldtimeapi.org/api/timezone";

const REQUEST_TIMEOUT = 10000;
const DEBOUNCE_DELAY = 500;

let debounceTimer = null;
let lastQuery = "";
let lastCity = "";

const WMO = {
  0:  { desc: "Clear sky", icon: "☀️" },
  1:  { desc: "Mainly clear", icon: "🌤️" },
  2:  { desc: "Partly cloudy", icon: "⛅" },
  3:  { desc: "Overcast", icon: "☁️" },
  45: { desc: "Fog", icon: "🌫️" },
  48: { desc: "Icy fog", icon: "🌫️" },
  51: { desc: "Light drizzle", icon: "🌦️" },
  53: { desc: "Moderate drizzle", icon: "🌦️" },
  55: { desc: "Dense drizzle", icon: "🌧️" },
  61: { desc: "Slight rain", icon: "🌧️" },
  63: { desc: "Moderate rain", icon: "🌧️" },
  65: { desc: "Heavy rain", icon: "🌧️" },
  71: { desc: "Slight snow", icon: "🌨️" },
  73: { desc: "Moderate snow", icon: "🌨️" },
  75: { desc: "Heavy snow", icon: "❄️" },
  80: { desc: "Slight showers", icon: "🌦️" },
  81: { desc: "Moderate showers", icon: "🌧️" },
  82: { desc: "Violent showers", icon: "⛈️" },
  95: { desc: "Thunderstorm", icon: "⛈️" },
  96: { desc: "Thunderstorm with hail", icon: "⛈️" },
  99: { desc: "Heavy thunderstorm", icon: "⛈️" }
};

function wmo(code) {
  return WMO[code] || { desc: "Unknown", icon: "❓" };
}

const SKEL_IDS = [
  "city-name",
  "weather-desc",
  "weather-icon",
  "temp-big",
  "humidity",
  "wind",
  "feels-like",
  "wind-dir"
];

function showSkeletons() {
  SKEL_IDS.forEach(id => document.getElementById(id).classList.add("skeleton"));
  buildForecastSkeletons();
}

function hideSkeletons() {
  SKEL_IDS.forEach(id => document.getElementById(id).classList.remove("skeleton"));
}

function buildForecastSkeletons() {
  const row = document.getElementById("forecast-row");
  let html = "";

  for (let i = 0; i < 7; i++) {
    html += `
      <div class="forecast-card">
        <div class="forecast-day skeleton">----</div>
        <div class="forecast-icon skeleton">--</div>
        <div class="forecast-hi skeleton">--</div>
        <div class="forecast-lo skeleton">--</div>
      </div>
    `;
  }

  row.innerHTML = html;
}

function showError(msg) {
  document.getElementById("error-msg").textContent = msg;
  document.getElementById("error-banner").classList.remove("hidden");
}

function hideError() {
  document.getElementById("error-banner").classList.add("hidden");
}

function showValidation(msg) {
  document.getElementById("validation-msg").textContent = msg;
}

function clearValidation() {
  document.getElementById("validation-msg").textContent = "";
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === "AbortError") {
      throw new Error("Request timed out after 10 seconds.");
    }

    throw err;
  }
}

async function doSearch(rawInput) {
  clearValidation();
  hideError();

  const city = rawInput.trim();

  if (city.length < 2) {
    showValidation("Enter at least 2 characters.");
    return;
  }

  lastQuery = city;
  showSkeletons();
  document.getElementById("local-time").textContent = "";

  try {
    const geoData = await fetchWithTimeout(
      `${GEO_API}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
    );

    if (!geoData.results || geoData.results.length === 0) {
      hideSkeletons();
      showError("City not found.");
      return;
    }

    const { latitude, longitude, name, timezone } = geoData.results[0];
    lastCity = name;

    const params = new URLSearchParams({
      latitude,
      longitude,
      current_weather: true,
      hourly: "temperature_2m,relativehumidity_2m",
      daily: "temperature_2m_max,temperature_2m_min,weathercode",
      timezone: "auto",
      forecast_days: 7,
      wind_speed_unit: "kmh"
    });

    const weatherData = await fetchWithTimeout(`${WEATHER_API}?${params}`);

    renderWeather(weatherData, name);
    fetchLocalTime(timezone);

  } catch (err) {
    hideSkeletons();
    showError(err.message);
  }
}

function renderWeather(data, cityName) {
  hideSkeletons();

  const cw = data.current_weather;
  const hourly = data.hourly;
  const daily = data.daily;

  const nowStr = new Date().toISOString().slice(0, 13);
  let hourIndex = hourly.time.findIndex(t => t.startsWith(nowStr));
  if (hourIndex < 0) hourIndex = 0;

  const humidity = hourly.relativehumidity_2m?.[hourIndex] ?? "--";
  const temp = Math.round(cw.temperature);
  const wind = Math.round(cw.windspeed);
  const feelsLike = temp;
  const windDirDeg = cw.winddirection ?? 0;

  const { desc, icon } = wmo(cw.weathercode);

  document.getElementById("city-name").textContent = cityName;
  document.getElementById("weather-desc").textContent = desc;
  document.getElementById("weather-icon").textContent = icon;
  document.getElementById("temp-big").textContent = `${temp}°C`;
  document.getElementById("humidity").textContent = `${humidity}%`;
  document.getElementById("wind").textContent = `${wind} km/h`;
  document.getElementById("feels-like").textContent = `${feelsLike}°C`;
  document.getElementById("wind-dir").textContent = `${degToCompass(windDirDeg)} (${windDirDeg}°)`;

  renderForecast(daily);
}

function renderForecast(daily) {
  const row = document.getElementById("forecast-row");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let html = "";

  daily.time.forEach((dateStr, i) => {
    const d = new Date(dateStr + "T00:00:00");
    const dayLabel = i === 0 ? "Today" : days[d.getDay()];
    const { icon } = wmo(daily.weathercode[i]);

    html += `
      <div class="forecast-card">
        <div class="forecast-day">${dayLabel}</div>
        <div class="forecast-icon">${icon}</div>
        <div class="forecast-hi">${Math.round(daily.temperature_2m_max[i])}°C</div>
        <div class="forecast-lo">${Math.round(daily.temperature_2m_min[i])}°C</div>
      </div>
    `;
  });

  row.innerHTML = html;
}

function degToCompass(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function fetchLocalTime(timezone) {
  if (!timezone) {
    setLocalTime();
    return;
  }

  $.getJSON(`${TIME_API}/${encodeURIComponent(timezone)}`)
    .done(function (data) {
      const dt = new Date(data.datetime);
      const timeString = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      document.getElementById("local-time").textContent = `Local time: ${timeString}`;
    })
    .fail(function () {
      setLocalTime();
    })
    .always(function () {
      console.log("WorldTimeAPI request finished at", new Date().toISOString());
    });
}

function setLocalTime() {
  const now = new Date();
  const timeString = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  document.getElementById("local-time").textContent = `Local time: ${timeString}`;
}

document.getElementById("search-input").addEventListener("input", function () {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (this.value.trim().length >= 2) {
      doSearch(this.value);
    }
  }, DEBOUNCE_DELAY);
});

document.getElementById("search-input").addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    clearTimeout(debounceTimer);
    doSearch(this.value);
  }
});

document.getElementById("search-btn").addEventListener("click", function () {
  clearTimeout(debounceTimer);
  doSearch(document.getElementById("search-input").value);
});

document.getElementById("retry-btn").addEventListener("click", function () {
  if (lastQuery) {
    doSearch(lastQuery);
  }
});

(function init() {
  buildForecastSkeletons();
  doSearch("Kuala Lumpur");
})();