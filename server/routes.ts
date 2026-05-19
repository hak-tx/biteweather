import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage.js";
import { Router } from "express";
import express from "express";
import { setupAuth, isAuthenticated, optionalAuth } from "./directAuth.js";
import { stripeService } from "./stripeService.js";
import { getStripePublishableKey, getUncachableStripeClient } from "./stripeClient.js";
import { DateTime } from "luxon";
import * as SunCalcModule from "suncalc3";
import memoize from "memoizee";
import { FishingForecastService } from "./fishingForecast.js";
import { getCacheKey, getCached, setCached } from "./cache.js";

// Normalize suncalc3 import - the library may expose API on .default in some module systems
const SunCalc = (SunCalcModule as any).default ?? SunCalcModule;

// --- Canonical Data Structures ---

interface HourlyForecast {
  time: string;        // "1p", "2a"
  datetime: string;    // ISO string or timestamp
  precipProb: number;  // 0-100
  precipAmount: number;// inches
  temp: number;        // F
  icon: "sun" | "cloud" | "rain" | "storm";
  humidity?: number;   // 0-100 %
  pressure?: number;   // mb
  windSpeed?: number;  // mph
  windGust?: number;   // mph
  windDir?: number;    // degrees (0-360)
  feelsLike?: number;  // F
  cloudCover?: number; // 0-100 %
  visibility?: number; // miles
  uvIndex?: number;    // 0-10
  dewPoint?: number;   // F
  tideHeight?: number; // feet - tide height at this hour (interpolated)
}

interface TideEvent {
  time: string;        // "3:15 AM" or "9:42 PM"
  height: number;      // feet
  type: "H" | "L";     // High or Low
}

interface TideCurvePoint {
  time: string;        // "1:15p", "1:30p", etc
  datetime: string;    // ISO string
  height: number;      // feet
}

interface MoonAltitudeSample {
  timestamp: number;   // Unix timestamp in ms
  altitude: number;    // Normalized 0-100 (above horizon only)
}

interface FeedingPeriod {
  type: 'major' | 'minor';
  event: 'overhead' | 'underfoot' | 'rise' | 'set';
  centerTime: string;   // HH:MM:SS format
  centerTimestamp: number; // Unix timestamp
  startTimestamp: number;  // Unix timestamp
  endTimestamp: number;    // Unix timestamp
  duration: number;     // minutes (60 for major, 30 for minor half-window)
}

interface SolunarData {
  date: string;
  moonAltitudes: MoonAltitudeSample[];
  feedingPeriods: FeedingPeriod[];
  moonrise: string | null;
  moonset: string | null;
  moonOverhead: string | null;
  moonUnderfoot: string | null;
}

interface DailyForecast {
  day: string;         // "MON"
  date: number;        // 12
  fullDate: string;    // "2024-11-12"
  high: number;        // F
  low: number;         // F
  precipProb: number;  // 0-100
  precipAmount: number;// inches
  icon: "sun" | "cloud" | "rain" | "storm";
  hours: HourlyForecast[];
  tideEvents?: TideEvent[]; // High/low tide times for this day
  tideCurve?: TideCurvePoint[]; // Dense tide data (96+ points) for smooth parabolic visualization
}

interface WeatherData {
  currentTemp: number; // F
  location: string;
  days: DailyForecast[];
  alerts: any[];
  provider: string;
  latitude: number;
  longitude: number;
  timezone?: string; // IANA timezone from weather API (e.g., "America/Chicago")
  observedPrecipitation?: number; // inches - actual observed to date
  tideStation?: string; // NOAA station ID for tides
  tideStationName?: string; // NOAA station name
  tideAvailable?: boolean; // Whether tide data is available
}

// --- Icon Mapper ---
function mapIcon(apiIcon: string | number): "sun" | "cloud" | "rain" | "storm" {
  const iconStr = String(apiIcon).toLowerCase();
  
  // WMO Weather Codes (Open-Meteo)
  // 0-3: Clear/Cloudy
  // 51-67: Drizzle/Rain
  // 71-77: Snow
  // 80-82: Showers
  // 95-99: Thunderstorm
  if (!isNaN(Number(apiIcon))) {
    const code = Number(apiIcon);
    if (code >= 95) return "storm";
    if (code >= 51 || code === 80 || code === 81 || code === 82) return "rain";
    if (code > 3) return "cloud"; // Fog, etc
    if (code > 1) return "cloud";
    return "sun";
  }

  // String descriptions (VC)
  if (iconStr.includes("thunder") || iconStr.includes("lightning")) return "storm";
  if (iconStr.includes("rain") || iconStr.includes("shower") || iconStr.includes("drizzle")) return "rain";
  if (iconStr.includes("cloud") || iconStr.includes("overcast") || iconStr.includes("partly")) return "cloud";
  return "sun";
}

// --- IEM (Iowa Environmental Mesonet) Observed Precipitation ---
// Uses RADAR-based gridded precipitation data (NCEP Stage IV gauge-corrected)
async function fetchObservedPrecipitation(lat: number, lon: number): Promise<number | undefined> {
  try {
    // IEM Reanalysis API returns precipitation in inches
    // Try today first, then yesterday if today is null (data takes time to process)
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    
    // Try to fetch today's data
    let dataResponse = await fetch(
      `https://mesonet.agron.iastate.edu/iemre/daily/${dateStr}/${lat}/${lon}/json`
    );
    
    if (!dataResponse.ok) {
      console.warn(`IEM API failed for ${dateStr}`);
      return undefined;
    }
    
    let data = await dataResponse.json();
    let precipInches = data.data?.[0]?.daily_precip_in;
    
    console.log(`IEM precipitation (${dateStr}):`, { precipInches });
    
    // If today's data is null/undefined, try yesterday (data may still be processing)
    if (precipInches === null || precipInches === undefined) {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      console.log(`Today's IEM data unavailable, trying yesterday (${yesterdayStr})`);
      
      dataResponse = await fetch(
        `https://mesonet.agron.iastate.edu/iemre/daily/${yesterdayStr}/${lat}/${lon}/json`
      );
      
      if (dataResponse.ok) {
        data = await dataResponse.json();
        precipInches = data.data?.[0]?.daily_precip_in;
        console.log(`IEM precipitation (${yesterdayStr}):`, { precipInches });
      }
    }
    
    // Convert to number and handle null/undefined
    if (precipInches === null || precipInches === undefined) {
      console.warn(`No precipitation data available from IEM for the past 2 days`);
      return undefined;
    }
    
    precipInches = Number(precipInches);
    
    if (typeof precipInches !== 'number' || isNaN(precipInches)) {
      console.warn(`Invalid precipitation value from IEM: ${precipInches}`);
      return undefined;
    }
    
    console.log(`Got precipitation from IEM: ${precipInches.toFixed(3)}" inches`);
    return precipInches;
  } catch (error) {
    console.error("Failed to fetch IEM precipitation:", error);
    return undefined;
  }
}

// --- NOAA Tide Data Fetching ---
interface TidePrediction {
  time: Date;
  height: number; // feet
  type?: "H" | "L"; // High or Low (only for identified extrema, undefined for dense 6-min data)
  coefficient?: number; // Tidal coefficient (20-120 scale)
}

// Cache for tide stations (loaded once per server start)
let tideStationsCache: any[] | null = null;

// Cache for station datums (MHHW, MLLW for coefficient calculations)
const stationDatumsCache: Map<string, { mhhw: number; mllw: number; referenceRange: number }> = new Map();

// Cache for station metadata including timezone
const stationMetadataCache: Map<string, { timezone: string }> = new Map();

// Map NOAA timezone offsets to IANA timezone names
function getIANATimezone(gmtOffset: string, lat: number, lon: number): string {
  // NOAA uses GMT offsets like "GMT-5", "GMT-6", etc.
  // Map to IANA timezones based on offset and location
  const offset = gmtOffset.replace('GMT', '').trim();
  
  // US coastal timezones based on offset
  const offsetMap: { [key: string]: string } = {
    '-5': 'America/New_York',     // Eastern
    '-6': 'America/Chicago',       // Central
    '-7': 'America/Denver',        // Mountain
    '-8': 'America/Los_Angeles',   // Pacific
    '-9': 'America/Anchorage',     // Alaska
    '-10': 'Pacific/Honolulu',     // Hawaii
    '0': 'UTC',
  };
  
  return offsetMap[offset] || 'America/New_York';
}

async function fetchStationMetadata(stationId: string): Promise<string | null> {
  if (stationMetadataCache.has(stationId)) {
    return stationMetadataCache.get(stationId)!.timezone;
  }
  
  try {
    const response = await fetch(
      `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${stationId}.json`
    );
    
    if (!response.ok) {
      console.warn(`Failed to fetch metadata for station ${stationId}`);
      return null;
    }
    
    const data = await response.json();
    const stations = data.stations || [];
    if (stations.length === 0) {
      console.warn(`No metadata found for station ${stationId}`);
      return null;
    }
    
    const station = stations[0];
    const gmtOffset = station.timeZone || 'GMT-6'; // Default to Central if missing
    const timezone = getIANATimezone(gmtOffset, station.lat, station.lng);
    
    stationMetadataCache.set(stationId, { timezone });
    return timezone;
  } catch (error) {
    console.error(`Error fetching metadata for station ${stationId}:`, error);
    return null;
  }
}

async function fetchStationDatums(stationId: string): Promise<{ mhhw: number; mllw: number; referenceRange: number } | null> {
  // Check cache first
  if (stationDatumsCache.has(stationId)) {
    return stationDatumsCache.get(stationId)!;
  }

  try {
    // Fetch station datums from the dedicated datums endpoint
    const datumsResponse = await fetch(
      `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${stationId}/datums.json`
    );
    
    if (!datumsResponse.ok) {
      console.warn(`Failed to fetch datums for station ${stationId}`);
      return null;
    }
    
    const datumsData = await datumsResponse.json();
    const datums = datumsData.datums || [];
    
    // Extract datum values for coefficient calculation
    let mhhw = 0;
    let mllw = 0;
    let msr = 0;
    let mn = 0;  // Mean Range (MN)
    let range = 0;
    let gt = 0;
    
    for (const datum of datums) {
      if (datum.name === "MHHW") mhhw = parseFloat(datum.value);
      if (datum.name === "MLLW") mllw = parseFloat(datum.value);
      if (datum.name === "MSR") msr = parseFloat(datum.value);
      if (datum.name === "MN") mn = parseFloat(datum.value);
      if (datum.name === "RANGE") range = parseFloat(datum.value);
      if (datum.name === "GT") gt = parseFloat(datum.value);
    }
    
    // Calculate reference range for tide coefficient (European scale 20-120)
    // MSR (Mean Spring Range) is the ideal reference, representing average spring tide range
    // If MSR unavailable, estimate from MN (Mean Range) or GT using empirical spring factor
    // The factor of 1.60 matches European systems like Nautide (calibrated empirically)
    let referenceRange = 0;
    if (msr > 0) {
      referenceRange = msr;
    } else if (mn > 0) {
      // Estimate spring range from mean range using spring/neap ratio
      // Factor of 1.60 matches European coefficient systems (e.g., Nautide, SHOM)
      referenceRange = mn * 1.60;
    } else if (range > 0) {
      referenceRange = range;
    } else if (gt > 0) {
      // GT is great diurnal range, use as last resort with same spring factor
      referenceRange = gt * 1.60;
    }
    
    // Only cache and return if we have a valid reference range
    if (referenceRange > 0) {
      const result = { mhhw, mllw, referenceRange };
      stationDatumsCache.set(stationId, result);
      return result;
    } else {
      console.warn(`No suitable reference range datum found for station ${stationId}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching datums for station ${stationId}:`, error);
    return null;
  }
}

// Identify high/low tides from 6-minute prediction data
function identifyHighLowTides(predictions: TidePrediction[]): TidePrediction[] {
  if (predictions.length < 5) return [];
  
  const highLowTides: TidePrediction[] = [];
  const windowSize = 5; // Look at 5 points before and after (~30 minutes)
  const minTimeBetweenTides = 4 * 60 * 60 * 1000; // 4 hours minimum between same-type tides
  
  // Find local maxima (high tides) and minima (low tides)
  for (let i = windowSize; i < predictions.length - windowSize; i++) {
    const current = predictions[i];
    
    // Check if current point is a local maximum or minimum within the window
    let isMax = true;
    let isMin = true;
    
    for (let j = i - windowSize; j <= i + windowSize; j++) {
      if (j === i) continue;
      if (predictions[j].height > current.height) isMax = false;
      if (predictions[j].height < current.height) isMin = false;
    }
    
    // If it's a local maximum, check if enough time has passed since last high tide
    if (isMax) {
      const lastHighTide = [...highLowTides].reverse().find(t => t.type === "H");
      const enoughTimePassed = !lastHighTide || 
        (current.time.getTime() - lastHighTide.time.getTime() >= minTimeBetweenTides);
      
      if (enoughTimePassed) {
        highLowTides.push({
          time: current.time,
          height: current.height,
          type: "H"
        });
      }
    }
    // If it's a local minimum, check if enough time has passed since last low tide
    else if (isMin) {
      const lastLowTide = [...highLowTides].reverse().find(t => t.type === "L");
      const enoughTimePassed = !lastLowTide || 
        (current.time.getTime() - lastLowTide.time.getTime() >= minTimeBetweenTides);
      
      if (enoughTimePassed) {
        highLowTides.push({
          time: current.time,
          height: current.height,
          type: "L"
        });
      }
    }
  }
  
  return highLowTides;
}

// Fetch tide data for a date range (single NOAA API call)
async function fetchTideDataRange(lat: number, lon: number, beginDate: string, endDate: string): Promise<{ predictions: TidePrediction[]; stationId?: string; stationName?: string } | null> {
  try {
    // Load all tide prediction stations if not cached
    if (!tideStationsCache) {
      console.log('Loading NOAA tide stations...');
      const stationsResponse = await fetch(
        `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions`
      );
      
      if (!stationsResponse.ok) {
        console.warn(`NOAA stations API failed (${stationsResponse.status})`);
        return null;
      }
      
      const stationsData = await stationsResponse.json();
      tideStationsCache = stationsData.stations || [];
      console.log(`Loaded ${tideStationsCache?.length || 0} NOAA tide stations`);
    }
    
    if (!tideStationsCache || tideStationsCache.length === 0) {
      console.warn('No tide stations available');
      return null;
    }
    
    // Find all nearby stations and sort by distance
    const nearbyStations = tideStationsCache
      .filter((station: any) => station.lat && station.lng)
      .map((station: any) => {
        const dlat = station.lat - lat;
        const dlng = station.lng - lon;
        const distance = Math.sqrt(dlat * dlat + dlng * dlng);
        return { station, distance };
      })
      .filter((item: any) => item.distance <= 1.5) // Only stations within ~100 miles
      .sort((a: any, b: any) => a.distance - b.distance);
    
    if (nearbyStations.length === 0) {
      console.warn(`No NOAA tide stations within range of ${lat},${lon}`);
      return null;
    }
    
    // Try stations in order of distance until we find one with prediction data
    for (const { station: nearestStation, distance } of nearbyStations) {
      const stationId = nearestStation.id;
      
      console.log(`Found NOAA station: ${stationId} (${nearestStation.name})`);
      
      // Fetch station timezone for correct time parsing
      const timezone = await fetchStationMetadata(stationId);
      if (!timezone) {
        console.warn(`Could not determine timezone for station ${stationId}, using default`);
      }
      const stationTZ = timezone || 'America/Chicago'; // Default to Central if unavailable
      
      // Fetch 6-minute tide predictions for the entire date range in one call
      const beginDateFormatted = `${beginDate.replace(/-/g, '')} 00:00`;
      const endDateFormatted = `${endDate.replace(/-/g, '')} 23:59`;
      console.log(`[NOAA] Fetching continuous tide window: ${beginDateFormatted} to ${endDateFormatted}`);
      
      const tideResponse = await fetch(
        `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${stationId}&begin_date=${encodeURIComponent(beginDateFormatted)}&end_date=${encodeURIComponent(endDateFormatted)}&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=6&units=english&format=json`
      );
      
      if (!tideResponse.ok) {
        console.warn(`NOAA tide fetch failed for station ${stationId}, trying next station`);
        continue; // Try next station
      }
      
      const tideData = await tideResponse.json();
      if (!tideData.predictions || tideData.predictions.length === 0) {
        console.warn(`No tide predictions for station ${stationId} on ${beginDate} to ${endDate}, trying next station`);
        continue; // Try next station
      }
      
      // Found a station with predictions! Use this one
      console.log(`Using NOAA station ${stationId} (${nearestStation.name}) with ${tideData.predictions.length} predictions`);
      
      // Debug: Log time range of returned predictions
      if (tideData.predictions.length > 0) {
        const firstTime = tideData.predictions[0].t;
        const lastTime = tideData.predictions[tideData.predictions.length - 1].t;
        console.log(`[NOAA Tides] Station ${stationId} continuous: ${tideData.predictions.length} predictions from ${firstTime} to ${lastTime}`);
      }
      
      // Parse times in station's local timezone and convert to Date objects
      const predictions = tideData.predictions.map((p: any) => {
        // NOAA returns times like "2025-11-24 03:00" in station local time (LST/LDT)
        // Parse in the station's timezone, then convert to JavaScript Date
        const dt = DateTime.fromFormat(p.t, 'yyyy-MM-dd HH:mm', { zone: stationTZ });
        return {
          time: dt.toJSDate(), // Convert to JS Date which will serialize correctly
          height: parseFloat(p.v),
          type: undefined // 6-minute data doesn't have type field
        };
      });
      
      return { predictions, stationId, stationName: nearestStation.name };
    }
    
    // No nearby stations had prediction data
    console.warn(`Tried ${nearbyStations.length} nearby stations, none had prediction data for ${beginDate} to ${endDate}`);
    return null;
  } catch (error) {
    console.error("Failed to fetch tide data range:", error);
    return null;
  }
}

async function fetchTideData(lat: number, lon: number, date: string): Promise<{ predictions: TidePrediction[]; stationId?: string; stationName?: string } | null> {
  try {
    // Load all tide prediction stations if not cached
    if (!tideStationsCache) {
      console.log('Loading NOAA tide stations...');
      const stationsResponse = await fetch(
        `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions`
      );
      
      if (!stationsResponse.ok) {
        console.warn(`NOAA stations API failed (${stationsResponse.status})`);
        return null;
      }
      
      const stationsData = await stationsResponse.json();
      tideStationsCache = stationsData.stations || [];
      console.log(`Loaded ${tideStationsCache?.length || 0} NOAA tide stations`);
    }
    
    if (!tideStationsCache || tideStationsCache.length === 0) {
      console.warn('No tide stations available');
      return null;
    }
    
    // Find all nearby stations and sort by distance
    const nearbyStations = tideStationsCache
      .filter((station: any) => station.lat && station.lng)
      .map((station: any) => {
        const dlat = station.lat - lat;
        const dlng = station.lng - lon;
        const distance = Math.sqrt(dlat * dlat + dlng * dlng);
        return { station, distance };
      })
      .filter((item: any) => item.distance <= 1.5) // Only stations within ~100 miles
      .sort((a: any, b: any) => a.distance - b.distance);
    
    if (nearbyStations.length === 0) {
      console.warn(`No NOAA tide stations within range of ${lat},${lon}`);
      return null;
    }
    
    // Try stations in order of distance until we find one with prediction data
    for (const { station: nearestStation, distance } of nearbyStations) {
      const stationId = nearestStation.id;
      
      console.log(`Found NOAA station: ${stationId} (${nearestStation.name})`);
      
      // Fetch station timezone for correct time parsing
      const timezone = await fetchStationMetadata(stationId);
      if (!timezone) {
        console.warn(`Could not determine timezone for station ${stationId}, using default`);
      }
      const stationTZ = timezone || 'America/Chicago'; // Default to Central if unavailable
      
      // Fetch 6-minute tide predictions for smooth parabolic curves
      // Start from midnight (00:00) to get full day data, not from current time
      const beginDate = `${date.replace(/-/g, '')} 00:00`;
      const endDate = `${date.replace(/-/g, '')} 23:59`;
      const tideResponse = await fetch(
        `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${stationId}&begin_date=${encodeURIComponent(beginDate)}&end_date=${encodeURIComponent(endDate)}&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=6&units=english&format=json`
      );
      
      if (!tideResponse.ok) {
        console.warn(`NOAA tide fetch failed for station ${stationId}, trying next station`);
        continue; // Try next station
      }
      
      const tideData = await tideResponse.json();
      if (!tideData.predictions || tideData.predictions.length === 0) {
        console.warn(`No tide predictions for station ${stationId} on ${date}, trying next station`);
        continue; // Try next station
      }
      
      // Found a station with predictions! Use this one
      console.log(`Using NOAA station ${stationId} (${nearestStation.name}) with ${tideData.predictions.length} predictions`);
      
      // Debug: Log time range of returned predictions
      if (tideData.predictions.length > 0) {
        const firstTime = tideData.predictions[0].t;
        const lastTime = tideData.predictions[tideData.predictions.length - 1].t;
        console.log(`[NOAA Tides] Station ${stationId} ${date}: ${tideData.predictions.length} predictions from ${firstTime} to ${lastTime}`);
      }
      
      // Parse times in station's local timezone and convert to Date objects
      const predictions = tideData.predictions.map((p: any) => {
        // NOAA returns times like "2025-11-24 03:00" in station local time (LST/LDT)
        // Parse in the station's timezone, then convert to JavaScript Date
        const dt = DateTime.fromFormat(p.t, 'yyyy-MM-dd HH:mm', { zone: stationTZ });
        return {
          time: dt.toJSDate(), // Convert to JS Date which will serialize correctly
          height: parseFloat(p.v),
          type: undefined // 6-minute data doesn't have type field
        };
      });
      
      return { predictions, stationId, stationName: nearestStation.name };
    }
    
    // No nearby stations had prediction data
    console.warn(`Tried ${nearbyStations.length} nearby stations, none had prediction data for ${date}`);
    return null;
  } catch (error) {
    console.error("Failed to fetch tide data:", error);
    return null;
  }
}

// Interpolate tide height for a given time between high/low predictions
function interpolateTideHeight(time: Date, predictions: TidePrediction[]): number | undefined {
  if (!predictions || predictions.length < 2) return undefined;
  
  // Find the two surrounding predictions
  let before: TidePrediction | null = null;
  let after: TidePrediction | null = null;
  
  for (let i = 0; i < predictions.length; i++) {
    if (predictions[i].time <= time) {
      before = predictions[i];
    }
    if (predictions[i].time > time && !after) {
      after = predictions[i];
      break;
    }
  }
  
  if (!before || !after) return undefined;
  
  // Linear interpolation between before and after
  const beforeTime = before.time.getTime();
  const afterTime = after.time.getTime();
  const currentTime = time.getTime();
  
  const ratio = (currentTime - beforeTime) / (afterTime - beforeTime);
  return before.height + (after.height - before.height) * ratio;
}

// --- NOAA NWS Provider ---
async function fetchNOAA(location: string): Promise<WeatherData> {
  try {
    // First geocode the location using Visual Crossing (or could use another geocoding service)
    const apiKey = process.env.VISUAL_CROSSING_API_KEY;
    if (!apiKey) throw new Error("VISUAL_CROSSING_API_KEY needed for geocoding");
    
    const geocodeUrl = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(location)}?unitGroup=us&key=${apiKey.trim()}&contentType=json&include=current`;
    const geocodeResponse = await fetch(geocodeUrl);
    
    if (!geocodeResponse.ok) {
      throw new Error("Failed to geocode location");
    }
    
    const geocodeData = await geocodeResponse.json();
    const lat = geocodeData.latitude;
    const lon = geocodeData.longitude;
    const resolvedAddress = geocodeData.resolvedAddress;
    const currentTemp = Math.round(geocodeData.currentConditions.temp);
    
    // Step 1: Get grid endpoint from coordinates
    const pointsUrl = `https://api.weather.gov/points/${lat},${lon}`;
    const pointsResponse = await fetch(pointsUrl, {
      headers: {
        'User-Agent': 'BiteWeather/1.0 (biteweather.com)'
      }
    });
    
    if (!pointsResponse.ok) {
      throw new Error(`NOAA points API failed: ${pointsResponse.status}`);
    }
    
    const pointsData = await pointsResponse.json();
    const hourlyForecastUrl = pointsData.properties.forecastHourly;
    const gridDataUrl = pointsData.properties.forecastGridData;
    
    // Step 2: Fetch both hourly forecast AND grid data (for humidity, dewpoint, precip prob, etc.)
    const [forecastResponse, gridDataResponse] = await Promise.all([
      fetch(hourlyForecastUrl, {
        headers: { 'User-Agent': 'BiteWeather/1.0 (biteweather.com)' }
      }),
      fetch(gridDataUrl, {
        headers: { 'User-Agent': 'BiteWeather/1.0 (biteweather.com)' }
      })
    ]);
    
    if (!forecastResponse.ok) {
      throw new Error(`NOAA forecast API failed: ${forecastResponse.status}`);
    }
    
    if (!gridDataResponse.ok) {
      throw new Error(`NOAA grid data API failed: ${gridDataResponse.status}`);
    }
    
    const forecastData = await forecastResponse.json();
    const gridData = await gridDataResponse.json();
    const periods = forecastData.properties.periods;
    
    // Extract grid data parameters (time-series data)
    const gridProps = gridData.properties;
    const humidity = gridProps.relativeHumidity?.values || [];
    const dewpoint = gridProps.dewpoint?.values || [];
    const precipProb = gridProps.probabilityOfPrecipitation?.values || [];
    const precipAmount = gridProps.quantitativePrecipitation?.values || [];
    const pressure = gridProps.pressure?.values || [];
    const cloudCover = gridProps.skyCover?.values || [];
    const apparentTemp = gridProps.apparentTemperature?.values || [];
    
    // Fetch observed precipitation from IEM
    const observedPrecip = await fetchObservedPrecipitation(lat, lon);
    
    // Fetch tide data for the location
    let tideStationId: string | undefined;
    let tideStationName: string | undefined;
    const tideDataByDate: { [date: string]: TidePrediction[] } = {};
    
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    const tideResult = await fetchTideData(lat, lon, todayStr);
    if (tideResult) {
      tideStationId = tideResult.stationId;
      tideStationName = tideResult.stationName;
      
      // Fetch tide data for next 15 days
      for (let i = 0; i < 15; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        const dayTideResult = await fetchTideData(lat, lon, dateStr);
        if (dayTideResult) {
          tideDataByDate[dateStr] = dayTideResult.predictions;
        }
      }
    }
    
    // Group periods by day
    const dayMap: { [date: string]: any[] } = {};
    
    periods.forEach((period: any) => {
      // Extract date in local timezone by parsing the ISO string directly
      // NOAA returns timestamps like "2025-11-24T06:00:00-06:00" (local time with offset)
      // We want the date portion in that local timezone, not UTC
      const dateStr = period.startTime.split('T')[0];
      
      if (!dayMap[dateStr]) {
        dayMap[dateStr] = [];
      }
      dayMap[dateStr].push(period);
    });
    
    // Helper to calculate daily precipitation total from grid data intervals
    const calculateDailyPrecip = (gridPrecipData: any[], dateStr: string): number => {
      if (!gridPrecipData || gridPrecipData.length === 0) return 0;
      
      const dayStart = new Date(dateStr + 'T00:00:00');
      const dayEnd = new Date(dateStr + 'T23:59:59');
      let total = 0;
      
      for (const item of gridPrecipData) {
        if (!item.validTime || item.value === null || item.value === undefined) continue;
        
        const parts = item.validTime.split('/');
        const startTime = new Date(parts[0]);
        
        // Parse duration
        let durationHours = 1;
        if (parts.length > 1 && parts[1]) {
          const hourMatch = parts[1].match(/PT(\d+)H/);
          if (hourMatch) {
            durationHours = parseInt(hourMatch[1]);
          }
        }
        
        const endTime = new Date(startTime.getTime() + durationHours * 3600000);
        
        // Check if this interval overlaps with the target day
        if (startTime < dayEnd && endTime > dayStart) {
          // NOAA quantitativePrecipitation values represent the total precipitation
          // for the entire interval period (e.g., 6 hours), not per-hour rates
          // So we add the value directly without multiplying by duration
          const precipInches = item.value / 25.4; // mm to inches
          total += precipInches;
        }
      }
      
      return total;
    };
    
    // Convert to DailyForecast format
    const timezone = pointsData.properties.timeZone;
    const nowInLocation = DateTime.now().setZone(timezone);
    
    const days: DailyForecast[] = Object.keys(dayMap).slice(0, 15).map((dateStr, index) => {
      const dayPeriods = dayMap[dateStr];
      const date = new Date(dateStr);
      
      // Calculate daily high/low from hourly data
      let high = -Infinity;
      let low = Infinity;
      let totalPrecipProb = 0;
      let precipCount = 0;
      
      // Calculate daily precipitation from grid data (avoiding double-counting)
      const dailyPrecipAmount = calculateDailyPrecip(precipAmount, dateStr);
      
      const dayTidePredictions = tideDataByDate[dateStr] || [];
      
      // Identify high/low tides from 6-minute prediction data
      const highLowTides = identifyHighLowTides(dayTidePredictions);
      
      // Format tide events for display (only high/low tides, not all 6-min predictions)
      const tideEvents: TideEvent[] = highLowTides
        .map(p => {
          const hour = p.time.getHours();
          const minute = p.time.getMinutes();
          const period = hour >= 12 ? 'PM' : 'AM';
          const hour12 = hour % 12 || 12;
          const minuteStr = minute.toString().padStart(2, '0');
          return {
            time: `${hour12}:${minuteStr} ${period}`,
            datetime: p.time.toISOString(), // Add ISO timestamp for precise positioning
            height: Math.round(p.height * 10) / 10,
            type: p.type!
          };
        });
      
      // NOAA only provides forecasts from current hour forward
      // For today, we need to fill in missing hours from midnight to now
      const firstPeriod = dayPeriods[0];
      const firstHour = firstPeriod ? new Date(firstPeriod.startTime).getHours() : 0;
      
      // Check if this is today by comparing the local date from NOAA's timestamp
      const todayLocalDate = firstPeriod ? firstPeriod.startTime.split('T')[0] : null;
      const isToday = dateStr === todayLocalDate;
      
      // Build hourly forecast array
      let hours: HourlyForecast[] = [];
      
      // Use first forecast temperature for filled hours to avoid false highs/lows
      const fillTemp = firstPeriod ? firstPeriod.temperature : currentTemp;
      
      // If this is today and we're missing hours before the first forecast, fill them in
      if (isToday && firstHour > 0) {
        for (let h = 0; h < firstHour; h++) {
          const hourInt = h;
          const period12 = hourInt >= 12 ? 'p' : 'a';
          const hour12 = hourInt % 12 || 12;
          
          // Create a datetime for this hour today
          const hourDate = new Date(dateStr + `T${h.toString().padStart(2, '0')}:00:00`);
          
          // Interpolate tide height for past hours if available
          let tideHeight: number | undefined;
          if (dayTidePredictions.length > 0) {
            tideHeight = interpolateTideHeight(hourDate, dayTidePredictions);
            if (tideHeight !== undefined) {
              tideHeight = Math.round(tideHeight * 10) / 10;
            }
          }
          
          // Fill with first forecast temp to create smooth line without false highs/lows
          hours.push({
            time: `${hour12}${period12}`,
            datetime: hourDate.toISOString(),
            precipProb: 0,
            precipAmount: 0,
            temp: fillTemp, // Use first forecast temp to avoid artificial peaks
            icon: 'cloud' as const,
            humidity: undefined,
            pressure: undefined,
            windSpeed: 0,
            windGust: undefined,
            windDir: undefined,
            feelsLike: undefined,
            cloudCover: undefined,
            visibility: undefined,
            uvIndex: undefined,
            dewPoint: undefined,
            tideHeight
          });
        }
      }
      
      // Add actual forecast data from NOAA
      const forecastHours: HourlyForecast[] = dayPeriods.map((period: any) => {
        const startTime = new Date(period.startTime);
        const hourInt = startTime.getHours();
        const period12 = hourInt >= 12 ? 'p' : 'a';
        const hour12 = hourInt % 12 || 12;
        
        const temp = period.temperature;
        high = Math.max(high, temp);
        low = Math.min(low, temp);
        
        // Extract values from grid data at this specific time
        const hourlyHumidity = getGridValueAtTime(humidity, startTime);
        const hourlyDewpoint = getGridValueAtTime(dewpoint, startTime);
        const hourlyPrecipProb = getGridValueAtTime(precipProb, startTime);
        const hourlyPrecipAmount = getGridValueAtTime(precipAmount, startTime);
        const hourlyPressure = getGridValueAtTime(pressure, startTime);
        const hourlyCloudCover = getGridValueAtTime(cloudCover, startTime);
        const hourlyFeelsLike = getGridValueAtTime(apparentTemp, startTime);
        
        // Convert NOAA units to our format (keep undefined for missing data)
        const precipProbPercent = hourlyPrecipProb !== undefined ? Math.round(hourlyPrecipProb) : undefined;
        const precipAmountInches = hourlyPrecipAmount !== undefined && hourlyPrecipAmount > 0 ? hourlyPrecipAmount / 25.4 : 0; // mm to inches
        const dewpointF = hourlyDewpoint !== undefined ? (hourlyDewpoint * 9/5) + 32 : undefined; // C to F
        const feelsLikeF = hourlyFeelsLike !== undefined ? (hourlyFeelsLike * 9/5) + 32 : undefined; // C to F
        const pressureMb = hourlyPressure !== undefined ? hourlyPressure / 100 : undefined; // Pa to mb
        
        // Only count if we have actual precipitation probability data
        if (precipProbPercent !== undefined) {
          totalPrecipProb += precipProbPercent;
          precipCount++;
        }
        
        // Parse wind speed (e.g., "10 mph" or "5 to 10 mph")
        const windSpeedStr = period.windSpeed;
        let windSpeed = 0;
        const windMatch = windSpeedStr.match(/(\d+)/);
        if (windMatch) {
          windSpeed = parseInt(windMatch[1]);
        }
        
        // Interpolate tide height for this hour
        let tideHeight: number | undefined;
        if (dayTidePredictions.length > 0) {
          tideHeight = interpolateTideHeight(startTime, dayTidePredictions);
          if (tideHeight !== undefined) {
            tideHeight = Math.round(tideHeight * 10) / 10;
          }
        }
        
        return {
          time: `${hour12}${period12}`,
          datetime: period.startTime,
          precipProb: precipProbPercent || 0, // Default to 0 for display but keep undefined as undefined
          precipAmount: precipAmountInches,
          temp,
          icon: mapNOAAIcon(period.icon, period.shortForecast),
          humidity: hourlyHumidity !== undefined ? Math.round(hourlyHumidity) : undefined,
          pressure: pressureMb !== undefined ? Math.round(pressureMb) : undefined,
          windSpeed,
          windGust: undefined, // NOAA doesn't provide wind gust reliably
          windDir: mapWindDirection(period.windDirection),
          feelsLike: feelsLikeF !== undefined ? Math.round(feelsLikeF) : undefined,
          cloudCover: hourlyCloudCover !== undefined ? Math.round(hourlyCloudCover) : undefined,
          visibility: undefined, // Not reliably available
          uvIndex: undefined, // Not reliably available
          dewPoint: dewpointF !== undefined ? Math.round(dewpointF) : undefined,
          tideHeight
        };
      });
      
      // Combine filled hours with forecast hours
      hours = [...hours, ...forecastHours];
      
      // Generate separate dense tide curve for smooth parabolic visualization
      let tideCurve: TideCurvePoint[] | undefined;
      if (dayTidePredictions.length > 0) {
        tideCurve = [];
        // Sample every 10 minutes (6 points per hour = 144 points per day) for maximum smoothness
        for (let h = 0; h < 24; h++) {
          for (let m = 0; m < 60; m += 10) {
            const hourDate = new Date(dateStr + `T${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`);
            const tideHeight = interpolateTideHeight(hourDate, dayTidePredictions);
            
            if (tideHeight !== undefined) {
              const period12 = h >= 12 ? 'p' : 'a';
              const hour12 = h % 12 || 12;
              const timeLabel = m === 0 ? `${hour12}${period12}` : `${hour12}:${m.toString().padStart(2, '0')}${period12}`;
              
              tideCurve.push({
                time: timeLabel,
                datetime: hourDate.toISOString(),
                height: Math.round(tideHeight * 100) / 100 // Round to 2 decimals for precision
              });
            }
          }
        }
      }
      
      let avgPrecipProb = precipCount > 0 ? totalPrecipProb / precipCount : 0;
      let finalDailyPrecipAmount = dailyPrecipAmount;
      
      // For today (index 0), recalculate precip to only include future hours
      if (index === 0 && hours.length > 0) {
        const futureHours = hours.filter(h => {
          const hourTime = DateTime.fromISO(h.datetime, { zone: timezone });
          return hourTime >= nowInLocation;
        });
        
        if (futureHours.length > 0) {
          avgPrecipProb = Math.max(...futureHours.map(h => h.precipProb || 0));
          finalDailyPrecipAmount = futureHours.reduce((sum, h) => sum + (h.precipAmount || 0), 0);
        } else {
          // No future hours left today
          avgPrecipProb = 0;
          finalDailyPrecipAmount = 0;
        }
      }
      
      // Determine icon from most common forecast
      const iconCounts: { [key: string]: number } = {};
      dayPeriods.forEach((p: any) => {
        const icon = mapNOAAIcon(p.icon, p.shortForecast);
        iconCounts[icon] = (iconCounts[icon] || 0) + 1;
      });
      const dayIcon = Object.keys(iconCounts).reduce((a, b) => 
        iconCounts[a] > iconCounts[b] ? a : b
      ) as "sun" | "cloud" | "rain" | "storm";
      
      return {
        day: date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
        date: date.getDate(),
        fullDate: dateStr,
        high,
        low,
        precipProb: Math.round(avgPrecipProb),
        precipAmount: Math.round(finalDailyPrecipAmount * 100) / 100, // Round to 2 decimal places
        icon: dayIcon,
        hours,
        tideEvents: tideEvents.length > 0 ? tideEvents : undefined,
        tideCurve: tideCurve && tideCurve.length > 0 ? tideCurve : undefined
      };
    });
    
    return {
      currentTemp,
      location: resolvedAddress,
      days,
      alerts: [],
      provider: 'noaa',
      latitude: lat,
      longitude: lon,
      observedPrecipitation: observedPrecip,
      tideStation: tideStationId,
      tideStationName: tideStationName,
      tideAvailable: !!tideStationId && Object.keys(tideDataByDate).length > 0
    };
  } catch (error) {
    console.error("NOAA Error:", error);
    throw error;
  }
}

// Helper to extract value from NOAA grid data time-series at a given time
function getGridValueAtTime(gridValues: any[], targetTime: Date): number | undefined {
  if (!gridValues || gridValues.length === 0) return undefined;
  
  const targetTimestamp = targetTime.getTime();
  
  for (const item of gridValues) {
    const validTime = item.validTime;
    if (!validTime || item.value === null || item.value === undefined) continue;
    
    // Parse ISO 8601 interval format: "2024-11-24T12:00:00+00:00/PT3H"
    const parts = validTime.split('/');
    const startTimeStr = parts[0];
    const startTime = new Date(startTimeStr);
    const startTimestamp = startTime.getTime();
    
    // Parse duration (e.g., "PT3H" = 3 hours, "PT1H" = 1 hour, "PT30M" = 30 min)
    let durationMs = 3600000; // default 1 hour
    if (parts.length > 1 && parts[1]) {
      const durationStr = parts[1];
      const hourMatch = durationStr.match(/PT(\d+)H/);
      const minMatch = durationStr.match(/PT(\d+)M/);
      
      if (hourMatch) {
        durationMs = parseInt(hourMatch[1]) * 3600000;
      } else if (minMatch) {
        durationMs = parseInt(minMatch[1]) * 60000;
      }
    }
    
    const endTimestamp = startTimestamp + durationMs;
    
    // Check if target time falls within this interval
    if (targetTimestamp >= startTimestamp && targetTimestamp < endTimestamp) {
      return item.value;
    }
  }
  
  return undefined;
}

// Map NOAA wind direction to degrees
function mapWindDirection(direction: string): number {
  const directionMap: { [key: string]: number } = {
    'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5,
    'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5,
    'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5,
    'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5
  };
  return directionMap[direction] || 0;
}

// Map NOAA icon to our simple icon types
function mapNOAAIcon(iconUrl: string, shortForecast: string): "sun" | "cloud" | "rain" | "storm" {
  const forecast = shortForecast.toLowerCase();
  
  if (forecast.includes('thunder') || forecast.includes('storm')) {
    return 'storm';
  } else if (forecast.includes('rain') || forecast.includes('shower') || forecast.includes('drizzle')) {
    return 'rain';
  } else if (forecast.includes('cloud') || forecast.includes('overcast')) {
    return 'cloud';
  } else {
    return 'sun';
  }
}

// --- Visual Crossing Provider ---
async function fetchVisualCrossing(location: string): Promise<WeatherData> {
  try {
    const apiKey = process.env.VISUAL_CROSSING_API_KEY;
    if (!apiKey) throw new Error("VISUAL_CROSSING_API_KEY is missing");

    const params = new URLSearchParams({
      unitGroup: "us",
      key: apiKey.trim(),
      contentType: "json",
      include: "current,hours,days,alerts"
    });

    const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(location)}?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
       // Fallback to mock if key invalid/quota exceeded
       console.warn("VC API failed, using mock");
       return generateMockWeather(location);
    }

    const data = await response.json();
    
    console.log(`[Visual Crossing] Location: ${data.resolvedAddress}, Timezone: ${data.timezone || 'not provided'}`);
    console.log(`[Visual Crossing] First 3 daily dates:`, data.days.slice(0, 3).map((d: any) => d.datetime));
    console.log(`[Visual Crossing] First daily precip probs:`, data.days.slice(0, 3).map((d: any) => d.precipprob));

    // Fetch tide data for the location
    let tideStationId: string | undefined;
    let tideStationName: string | undefined;
    const tideDataByDate: { [date: string]: TidePrediction[] } = {};
    
    // Fetch tide data for first day to check availability
    const firstDayDate = data.days[0]?.datetime?.split('T')[0];
    if (firstDayDate) {
      const tideResult = await fetchTideData(data.latitude, data.longitude, firstDayDate);
      if (tideResult) {
        tideStationId = tideResult.stationId;
        tideStationName = tideResult.stationName;
        // Fetch tide data for all days in forecast
        for (const day of data.days.slice(0, 5)) {
          const dayDate = day.datetime.split('T')[0];
          const dayTideResult = await fetchTideData(data.latitude, data.longitude, dayDate);
          if (dayTideResult) {
            tideDataByDate[dayDate] = dayTideResult.predictions;
          }
        }
      }
    }

    const timezone = data.timezone || 'UTC';
    const nowInLocation = DateTime.now().setZone(timezone);
    
    const days: DailyForecast[] = data.days.slice(0, 15).map((d: any, index: number) => {
      const dayDate = d.datetime.split('T')[0];
      const dayTidePredictions = tideDataByDate[dayDate] || [];
      
      // Identify high/low tides from 6-minute prediction data
      const highLowTides = identifyHighLowTides(dayTidePredictions);
      
      // Format tide events for display (only high/low tides, not all 6-min predictions)
      const tideEvents: TideEvent[] = highLowTides
        .map(p => {
          const hour = p.time.getHours();
          const minute = p.time.getMinutes();
          const period = hour >= 12 ? 'PM' : 'AM';
          const hour12 = hour % 12 || 12;
          const minuteStr = minute.toString().padStart(2, '0');
          return {
            time: `${hour12}:${minuteStr} ${period}`,
            datetime: p.time.toISOString(), // Add ISO timestamp for precise positioning
            height: Math.round(p.height * 10) / 10,
            type: p.type!
          };
        });
      
      let hours: HourlyForecast[] = d.hours ? d.hours.map((h: any) => {
        let timeStr = h.datetime; // "13:00:00"
        if (timeStr.includes('T')) timeStr = timeStr.split('T')[1];
        const [hourStr] = timeStr.split(':');
        const hourInt = parseInt(hourStr);
        const period = hourInt >= 12 ? 'p' : 'a';
        const hour12 = hourInt % 12 || 12;
        
        // Construct full ISO datetime string from day date + hour time
        const fullDatetime = `${dayDate}T${timeStr}`;
        
        // Interpolate tide height for this hour
        let tideHeight: number | undefined;
        if (dayTidePredictions.length > 0) {
          const hourTime = new Date(fullDatetime);
          tideHeight = interpolateTideHeight(hourTime, dayTidePredictions);
          if (tideHeight !== undefined) {
            tideHeight = Math.round(tideHeight * 10) / 10; // Round to 1 decimal
          }
        }
        
        return {
          time: `${hour12}${period}`,
          datetime: fullDatetime,
          precipProb: h.precipprob || 0,
          precipAmount: h.precip || 0,
          temp: Math.round(h.temp),
          icon: mapIcon(h.icon),
          humidity: h.humidity,
          pressure: h.pressure,
          windSpeed: h.windspeed,
          windGust: h.windgust,
          windDir: h.winddir,
          feelsLike: h.feelslike ? Math.round(h.feelslike) : undefined,
          cloudCover: h.cloudcover,
          visibility: h.visibility,
          uvIndex: h.uvindex,
          dewPoint: h.dew ? Math.round(h.dew) : undefined,
          tideHeight
        };
      }) : [];

      // Generate separate dense tide curve for smooth parabolic visualization
      let tideCurve: TideCurvePoint[] | undefined;
      if (dayTidePredictions.length > 0) {
        tideCurve = [];
        // Sample every 10 minutes (6 points per hour = 144 points per day) for maximum smoothness
        for (let h = 0; h < 24; h++) {
          for (let m = 0; m < 60; m += 10) {
            const hourDate = new Date(dayDate + `T${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`);
            const tideHeight = interpolateTideHeight(hourDate, dayTidePredictions);
            
            if (tideHeight !== undefined) {
              const period12 = h >= 12 ? 'p' : 'a';
              const hour12 = h % 12 || 12;
              const timeLabel = m === 0 ? `${hour12}${period12}` : `${hour12}:${m.toString().padStart(2, '0')}${period12}`;
              
              tideCurve.push({
                time: timeLabel,
                datetime: hourDate.toISOString(),
                height: Math.round(tideHeight * 100) / 100 // Round to 2 decimals for precision
              });
            }
          }
        }
      }

      // Parse the date in the location's timezone
      // d.datetime is in format "2025-11-28" representing a local date
      const [year, month, dayNum] = d.datetime.split('-').map(Number);
      const localDate = new Date(year, month - 1, dayNum); // month is 0-indexed
      
      // For today (index 0), recalculate precip to only include future hours
      let dailyPrecipProb = d.precipprob || 0;
      let dailyPrecipAmount = d.precip || 0;
      
      if (index === 0 && hours.length > 0) {
        const futureHours = hours.filter(h => {
          const hourTime = DateTime.fromISO(h.datetime, { zone: timezone });
          return hourTime >= nowInLocation;
        });
        
        if (futureHours.length > 0) {
          dailyPrecipProb = Math.max(...futureHours.map(h => h.precipProb || 0));
          dailyPrecipAmount = futureHours.reduce((sum, h) => sum + (h.precipAmount || 0), 0);
        } else {
          // No future hours left today
          dailyPrecipProb = 0;
          dailyPrecipAmount = 0;
        }
      }
      
      return {
        day: localDate.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
        date: dayNum,
        fullDate: d.datetime,
        high: Math.round(d.tempmax),
        low: Math.round(d.tempmin),
        precipProb: dailyPrecipProb,
        precipAmount: dailyPrecipAmount,
        icon: mapIcon(d.icon),
        hours,
        tideEvents: tideEvents.length > 0 ? tideEvents : undefined,
        tideCurve: tideCurve && tideCurve.length > 0 ? tideCurve : undefined
      };
    });

    // Fetch observed precipitation from weather.gov
    const observedPrecip = await fetchObservedPrecipitation(data.latitude, data.longitude);

    // Filter alerts to only include warnings (not watches)
    const warningsOnly = (data.alerts || []).filter((alert: any) => {
      const event = (alert.event || alert.headline || '').toLowerCase();
      // Exclude watches, only keep warnings
      return !event.includes('watch') && (event.includes('warning') || event.includes('advisory'));
    });

    return {
      currentTemp: Math.round(data.currentConditions.temp),
      location: data.resolvedAddress,
      days,
      alerts: warningsOnly,
      provider: 'visualcrossing',
      latitude: data.latitude,
      longitude: data.longitude,
      observedPrecipitation: observedPrecip,
      tideStation: tideStationId,
      tideStationName: tideStationName,
      tideAvailable: !!tideStationId && Object.keys(tideDataByDate).length > 0
    };

  } catch (error) {
    console.error("VC Error:", error);
    return generateMockWeather(location);
  }
}

// --- Open-Meteo Provider ---
async function fetchOpenMeteo(location: string): Promise<WeatherData> {
  try {
    // First, use Visual Crossing to geocode and get coordinates
    // This provides better geocoding while still using Open-Meteo's weather data
    const vcApiKey = process.env.VISUAL_CROSSING_API_KEY;
    if (!vcApiKey) {
      throw new Error("VISUAL_CROSSING_API_KEY is not configured");
    }
    
    const vcUrl = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(location)}/today?key=${vcApiKey}&include=current`;
    const vcResponse = await fetch(vcUrl);
    
    if (!vcResponse.ok) {
      throw new Error(`Geocoding failed: ${vcResponse.statusText}`);
    }
    
    const vcData = await vcResponse.json();
    const lat = vcData.latitude;
    const lon = vcData.longitude;
    const resolvedLocation = vcData.resolvedAddress;
    
    // Fetch weather data
    const params = new URLSearchParams({
      latitude: lat.toString(),
      longitude: lon.toString(),
      hourly: [
        'temperature_2m',
        'precipitation_probability',
        'precipitation',
        'relative_humidity_2m',
        'dewpoint_2m',
        'apparent_temperature',
        'weathercode',
        'surface_pressure',
        'cloudcover',
        'visibility',
        'windspeed_10m',
        'winddirection_10m',
        'windgusts_10m',
        'uv_index'
      ].join(','),
      daily: [
        'weathercode',
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_sum',
        'precipitation_probability_max'
      ].join(','),
      current: 'temperature_2m',
      temperature_unit: 'fahrenheit',
      windspeed_unit: 'mph',
      precipitation_unit: 'inch',
      timezone: 'auto',
      forecast_days: '16'
    });
    
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?${params}`;
    const weatherResponse = await fetch(weatherUrl);
    
    if (!weatherResponse.ok) {
      throw new Error(`Weather API failed: ${weatherResponse.statusText}`);
    }
    
    const data = await weatherResponse.json();
    
    // Get timezone from Open-Meteo response
    const timezone = data.timezone || 'UTC';
    console.log(`[Open-Meteo] Location: ${resolvedLocation}, Timezone: ${timezone}`);
    console.log(`[Open-Meteo] First 3 daily dates:`, data.daily.time.slice(0, 3));
    console.log(`[Open-Meteo] First daily precip probs:`, data.daily.precipitation_probability_max.slice(0, 3));
    
    // Fetch tide data for the location
    let tideStationId: string | undefined;
    let tideStationName: string | undefined;
    const tideDataByDate: { [date: string]: TidePrediction[] } = {};
    
    // Fetch tide data for first day to check availability
    const firstDayDate = data.daily.time[0];
    if (firstDayDate) {
      const tideResult = await fetchTideData(lat, lon, firstDayDate);
      if (tideResult) {
        tideStationId = tideResult.stationId;
        tideStationName = tideResult.stationName;
        // Fetch tide data for all days in forecast (first 5 days)
        for (let i = 0; i < Math.min(5, data.daily.time.length); i++) {
          const dayDate = data.daily.time[i];
          const dayTideResult = await fetchTideData(lat, lon, dayDate);
          if (dayTideResult) {
            tideDataByDate[dayDate] = dayTideResult.predictions;
          }
        }
      }
    }
    
    // Process daily forecasts
    const days: DailyForecast[] = [];
    const nowInLocation = DateTime.now().setZone(timezone);
    
    for (let i = 0; i < Math.min(15, data.daily.time.length); i++) {
      const dayDate = data.daily.time[i];
      const dayTidePredictions = tideDataByDate[dayDate] || [];
      
      // Identify high/low tides from 6-minute prediction data
      const highLowTides = identifyHighLowTides(dayTidePredictions);
      
      // Format tide events for display
      const tideEvents: TideEvent[] = highLowTides.map(p => {
        const hour = p.time.getHours();
        const minute = p.time.getMinutes();
        const period = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        const minuteStr = minute.toString().padStart(2, '0');
        return {
          time: `${hour12}:${minuteStr} ${period}`,
          datetime: p.time.toISOString(),
          height: Math.round(p.height * 10) / 10,
          type: p.type!
        };
      });
      
      // Get hourly data for this day (24 hours)
      const startHourIndex = i * 24;
      const hours: HourlyForecast[] = [];
      
      for (let h = 0; h < 24; h++) {
        const hourIndex = startHourIndex + h;
        
        if (hourIndex >= data.hourly.time.length) break;
        
        const hourTime = data.hourly.time[hourIndex];
        const hourDate = new Date(hourTime);
        const hourInt = hourDate.getHours();
        const period = hourInt >= 12 ? 'p' : 'a';
        const hour12 = hourInt % 12 || 12;
        
        // Interpolate tide height for this hour
        let tideHeight: number | undefined;
        if (dayTidePredictions.length > 0) {
          tideHeight = interpolateTideHeight(hourDate, dayTidePredictions);
          if (tideHeight !== undefined) {
            tideHeight = Math.round(tideHeight * 10) / 10;
          }
        }
        
        hours.push({
          time: `${hour12}${period}`,
          datetime: hourTime,
          precipProb: Math.round(data.hourly.precipitation_probability[hourIndex] || 0),
          precipAmount: data.hourly.precipitation[hourIndex] || 0,
          temp: Math.round(data.hourly.temperature_2m[hourIndex]),
          icon: mapIcon(data.hourly.weathercode[hourIndex]),
          humidity: Math.round(data.hourly.relative_humidity_2m[hourIndex] || 0),
          pressure: Math.round(data.hourly.surface_pressure[hourIndex] || 0),
          windSpeed: Math.round(data.hourly.windspeed_10m[hourIndex] || 0),
          windGust: Math.round(data.hourly.windgusts_10m[hourIndex] || 0),
          windDir: Math.round(data.hourly.winddirection_10m[hourIndex] || 0),
          feelsLike: Math.round(data.hourly.apparent_temperature[hourIndex]),
          cloudCover: Math.round(data.hourly.cloudcover[hourIndex] || 0),
          visibility: data.hourly.visibility[hourIndex] 
            ? Math.round(data.hourly.visibility[hourIndex] / 1609.34 * 10) / 10 // meters to miles
            : undefined,
          uvIndex: Math.round(data.hourly.uv_index?.[hourIndex] || 0),
          dewPoint: Math.round(data.hourly.dewpoint_2m[hourIndex]),
          tideHeight
        });
      }
      
      // Generate dense tide curve for smooth visualization
      let tideCurve: TideCurvePoint[] | undefined;
      if (dayTidePredictions.length > 0) {
        tideCurve = [];
        for (let h = 0; h < 24; h++) {
          for (let m = 0; m < 60; m += 10) {
            const hourDate = new Date(dayDate + `T${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`);
            const tideHeight = interpolateTideHeight(hourDate, dayTidePredictions);
            
            if (tideHeight !== undefined) {
              const period12 = h >= 12 ? 'p' : 'a';
              const hour12 = h % 12 || 12;
              const timeLabel = m === 0 ? `${hour12}${period12}` : `${hour12}:${m.toString().padStart(2, '0')}${period12}`;
              
              tideCurve.push({
                time: timeLabel,
                datetime: hourDate.toISOString(),
                height: Math.round(tideHeight * 100) / 100
              });
            }
          }
        }
      }
      
      // Parse the date in the location's timezone, not UTC
      // dayDate is in format "2025-11-28", which represents a local date in the location's timezone
      const [year, month, day] = dayDate.split('-').map(Number);
      const localDate = new Date(year, month - 1, day); // month is 0-indexed
      
      // For today (i=0), recalculate precip to only include future hours
      let dailyPrecipProb = Math.round(data.daily.precipitation_probability_max[i] || 0);
      let dailyPrecipAmount = data.daily.precipitation_sum[i] || 0;
      
      if (i === 0 && hours.length > 0) {
        const futureHours = hours.filter(h => {
          const hourTime = DateTime.fromISO(h.datetime, { zone: timezone });
          return hourTime >= nowInLocation;
        });
        
        if (futureHours.length > 0) {
          dailyPrecipProb = Math.max(...futureHours.map(h => h.precipProb || 0));
          dailyPrecipAmount = futureHours.reduce((sum, h) => sum + (h.precipAmount || 0), 0);
        } else {
          // No future hours left today
          dailyPrecipProb = 0;
          dailyPrecipAmount = 0;
        }
      }
      
      days.push({
        day: localDate.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
        date: day,
        fullDate: dayDate,
        high: Math.round(data.daily.temperature_2m_max[i]),
        low: Math.round(data.daily.temperature_2m_min[i]),
        precipProb: dailyPrecipProb,
        precipAmount: dailyPrecipAmount,
        icon: mapIcon(data.daily.weathercode[i]),
        hours,
        tideEvents: tideEvents.length > 0 ? tideEvents : undefined,
        tideCurve: tideCurve && tideCurve.length > 0 ? tideCurve : undefined
      });
    }
    
    // Fetch observed precipitation
    const observedPrecip = await fetchObservedPrecipitation(lat, lon);
    
    return {
      currentTemp: Math.round(data.current.temperature_2m),
      location: resolvedLocation,
      days,
      alerts: [],
      provider: 'openmeteo',
      latitude: lat,
      longitude: lon,
      observedPrecipitation: observedPrecip,
      tideStation: tideStationId,
      tideStationName: tideStationName,
      tideAvailable: !!tideStationId && Object.keys(tideDataByDate).length > 0,
      timezone
    };
    
  } catch (error) {
    console.error("Open-Meteo Error:", error);
    return generateMockWeather(location);
  }
}

// --- Mock Generator (Fallback) ---
function generateMockWeather(location: string): WeatherData {
  const now = new Date();
  
  const days: DailyForecast[] = [];
  for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
    const dayDate = new Date(now);
    dayDate.setDate(now.getDate() + dayIdx);
    
    // Generate unique hours for each day (starting at midnight)
    const dayHours: HourlyForecast[] = [];
    const baseTemp = 68 - dayIdx; // Each day slightly cooler
    
    for (let h = 0; h < 24; h++) {
      const hourDate = new Date(dayDate);
      hourDate.setHours(h, 0, 0, 0);
      
      // Realistic temperature curve: coolest at 6am, warmest at 3pm
      const tempOffset = Math.sin((h - 6) * Math.PI / 12) * 8;
      const temp = Math.round(baseTemp + tempOffset);
      
      // Rain in afternoon on day 2
      const isStormy = dayIdx === 2 && h >= 12 && h <= 18;
      
      const period = h >= 12 ? 'p' : 'a';
      const hour12 = h % 12 || 12;

      dayHours.push({
        time: `${hour12}${period}`,
        datetime: hourDate.toISOString(),
        temp,
        precipProb: isStormy ? 75 + Math.random() * 20 : 5,
        precipAmount: isStormy ? 0.2 + Math.random() * 0.3 : 0,
        icon: isStormy ? "rain" : (h >= 6 && h <= 18 ? "sun" : "cloud")
      });
    }
    
    // Calculate high/low from generated hours
    const temps = dayHours.map(h => h.temp);
    const high = Math.max(...temps);
    const low = Math.min(...temps);
    
    days.push({
      day: dayDate.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
      date: dayDate.getDate(),
      fullDate: dayDate.toISOString().split('T')[0],
      high,
      low,
      precipProb: dayIdx === 2 ? 85 : 15,
      precipAmount: dayIdx === 2 ? 0.5 : 0.02,
      icon: dayIdx === 2 ? "rain" : "cloud",
      hours: dayHours
    });
  }

  return {
    currentTemp: days[0]?.hours?.[new Date().getHours()]?.temp || 72,
    location: location + " (Simulated)",
    days,
    alerts: [],
    provider: 'mock',
    latitude: 45.5152,
    longitude: -122.6784
  };
}

// --- Memoized Weather Fetchers (5 minute cache) ---
const cachedFetchNOAA = memoize(fetchNOAA, { 
  maxAge: 5 * 60 * 1000, // 5 minutes
  promise: true,
  normalizer: (args) => args[0].toLowerCase().trim()
});

const cachedFetchOpenMeteo = memoize(fetchOpenMeteo, { 
  maxAge: 5 * 60 * 1000,
  promise: true,
  normalizer: (args) => args[0].toLowerCase().trim()
});

const cachedFetchVisualCrossing = memoize(fetchVisualCrossing, { 
  maxAge: 5 * 60 * 1000,
  promise: true,
  normalizer: (args) => args[0].toLowerCase().trim()
});

// Helper function to fetch moon phase data (for memoization)
async function fetchMoonPhases(location: string, lat: number, lon: number): Promise<any> {
  const apiKey = process.env.VISUAL_CROSSING_API_KEY;
  if (!apiKey) {
    throw new Error("Visual Crossing API key not configured");
  }

  const today = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 14);
  
  const startDateStr = today.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(location)}/${startDateStr}/${endDateStr}?unitGroup=us&key=${apiKey.trim()}&contentType=json&elements=datetime,moonphase,sunrise,sunset,moonrise,moonset&include=days`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Visual Crossing API error: ${response.status}`);
  }

  const data = await response.json();
  const timezone = data.timezone || 'UTC';
  
  console.log(`[Moon Phases] Visual Crossing timezone: ${timezone}, location: ${location}`);
  if (data.days && data.days.length > 0) {
    console.log(`[Moon Phases] First day sunrise/sunset: ${data.days[0].sunrise} / ${data.days[0].sunset} (local time in ${timezone})`);
  }
  
  const getMoonPhaseName = (phase: number) => {
    if (phase < 0.03 || phase > 0.97) return "🌑 New Moon";
    if (phase < 0.22) return "🌒 Waxing Crescent";
    if (phase < 0.28) return "🌓 First Quarter";
    if (phase < 0.47) return "🌔 Waxing Gibbous";
    if (phase < 0.53) return "🌕 Full Moon";
    if (phase < 0.72) return "🌖 Waning Gibbous";
    if (phase < 0.78) return "🌗 Last Quarter";
    return "🌘 Waning Crescent";
  };
  
  const formatTime = (date: Date | null | undefined) => {
    if (!date || isNaN(date.getTime())) return null;
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const phases = data.days.map((day: any) => {
    const date = new Date(day.datetime + 'T12:00:00');
    const moonphase = day.moonphase ?? 0;
    const illumination = Math.round(moonphase <= 0.5 ? moonphase * 200 : (1 - moonphase) * 200);
    
    let moonOverhead: string | null = null;
    let moonUnderfoot: string | null = null;
    
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      try {
        // Calculate overhead time using midpoint between moonrise and moonset
        // This matches the solunar calculation approach
        if (day.moonrise && day.moonset) {
          const dateStr = day.datetime.split('T')[0];
          const [riseH, riseM, riseS = 0] = day.moonrise.split(':').map(Number);
          const [setH, setM, setS = 0] = day.moonset.split(':').map(Number);
          
          const moonriseDate = new Date(`${dateStr}T${day.moonrise}`);
          const moonsetDate = new Date(`${dateStr}T${day.moonset}`);
          
          // If moonset is earlier than moonrise (crossed midnight), add a day
          if (moonsetDate < moonriseDate) {
            moonsetDate.setDate(moonsetDate.getDate() + 1);
          }
          
          // Overhead is the midpoint between rise and set
          const midTime = moonriseDate.getTime() + (moonsetDate.getTime() - moonriseDate.getTime()) / 2;
          const overheadDate = new Date(midTime);
          moonOverhead = formatTime(overheadDate);
          
          // Underfoot is 12 hours after overhead
          const underfootDate = new Date(midTime + 12 * 60 * 60 * 1000);
          moonUnderfoot = formatTime(underfootDate);
        }
      } catch (err) {
        console.error("[MoonOverhead] Calculation error:", err);
      }
    }
    
    return {
      date: day.datetime,
      dayOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()],
      dayOfMonth: date.getDate(),
      phaseName: getMoonPhaseName(moonphase),
      moonphase: moonphase,
      illumination: illumination,
      moonrise: day.moonrise || null,
      moonset: day.moonset || null,
      sunrise: day.sunrise || null,
      sunset: day.sunset || null,
      moonOverhead: moonOverhead,
      moonUnderfoot: moonUnderfoot,
    };
  });
  
  return { phases, timezone };
}

// Note: Moon phases caching is now handled by NodeCache in the route handler
// The memoized wrapper has been removed to prevent double-caching and cross-location issues

// --- Routes Registration ---

export async function registerRoutes(app: Express): Promise<Server> {
  if (process.env.DATABASE_URL && process.env.SESSION_SECRET) {
    await setupAuth(app);
  } else {
    console.warn("DATABASE_URL or SESSION_SECRET not set - auth and account features disabled");
    app.use((req: any, _res, next) => {
      req.isAuthenticated = () => false;
      next();
    });
  }

  const router = Router();

  // Auth endpoints
  router.get('/api/auth/user', optionalAuth, async (req: any, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.json(null);
      }
      // Direct OAuth stores user ID directly, not in claims.sub
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Favorite locations endpoints
  router.post('/api/favorites', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { locationQuery } = req.body;

      if (!locationQuery || typeof locationQuery !== 'string') {
        return res.status(400).json({ message: "Location query is required" });
      }

      const user = await storage.addFavoriteLocation(userId, locationQuery);
      res.json(user);
    } catch (error) {
      console.error("Error adding favorite:", error);
      res.status(500).json({ message: "Failed to add favorite location" });
    }
  });

  router.delete('/api/favorites/:locationQuery', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { locationQuery } = req.params;

      const user = await storage.removeFavoriteLocation(userId, decodeURIComponent(locationQuery));
      res.json(user);
    } catch (error) {
      console.error("Error removing favorite:", error);
      res.status(500).json({ message: "Failed to remove favorite location" });
    }
  });

  // Stripe subscription routes
  router.get('/api/stripe/config', async (req, res) => {
    try {
      const publishableKey = await getStripePublishableKey();
      res.json({ publishableKey });
    } catch (error) {
      console.error("Error fetching Stripe config:", error);
      res.status(500).json({ message: "Failed to fetch Stripe config" });
    }
  });

  router.get('/api/subscription', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user?.stripeSubscriptionId) {
        return res.json({ subscription: null });
      }

      const subscription = await storage.getStripeSubscription(user.stripeSubscriptionId);
      res.json({ subscription });
    } catch (error) {
      console.error("Error fetching subscription:", error);
      res.status(500).json({ message: "Failed to fetch subscription" });
    }
  });

  router.post('/api/checkout', express.json(), isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      const { priceId } = req.body;

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (!priceId) {
        return res.status(400).json({ message: "Price ID is required" });
      }

      // Create or get customer
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripeService.createCustomer(user.email || '', userId);
        await storage.updateUserStripeInfo(userId, { stripeCustomerId: customer.id });
        customerId = customer.id;
      }

      // Create checkout session
      const session = await stripeService.createCheckoutSession(
        customerId,
        priceId,
        userId,
        `${req.protocol}://${req.get('host')}?checkout=success`,
        `${req.protocol}://${req.get('host')}?checkout=cancel`
      );

      res.json({ url: session.url });
    } catch (error) {
      console.error("Error creating checkout:", error);
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });

  router.post('/api/customer-portal', express.json(), isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);

      if (!user?.stripeCustomerId) {
        return res.status(400).json({ message: "No Stripe customer found" });
      }

      const session = await stripeService.createCustomerPortalSession(
        user.stripeCustomerId,
        `${req.protocol}://${req.get('host')}`
      );

      res.json({ url: session.url });
    } catch (error) {
      console.error("Error creating customer portal:", error);
      res.status(500).json({ message: "Failed to create customer portal session" });
    }
  });

  // ===== PROMOTION CODE ROUTES =====

  // Validate a promo code (public - for users to check before redeeming)
  router.post('/api/promo/validate', express.json(), async (req: any, res) => {
    try {
      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ valid: false, error: 'Code is required' });
      }

      const promoCode = await storage.getPromotionCodeByCode(code.toUpperCase());
      
      if (!promoCode) {
        return res.json({ valid: false, error: 'Invalid promo code' });
      }

      // Check if active
      if (!promoCode.isActive) {
        return res.json({ valid: false, error: 'This code is no longer active' });
      }

      // Check validity dates
      const now = new Date();
      if (promoCode.validFrom && now < new Date(promoCode.validFrom)) {
        return res.json({ valid: false, error: 'This code is not yet valid' });
      }
      if (promoCode.validUntil && now > new Date(promoCode.validUntil)) {
        return res.json({ valid: false, error: 'This code has expired' });
      }

      // Check redemption limits
      if (promoCode.maxRedemptions && promoCode.currentRedemptions >= promoCode.maxRedemptions) {
        return res.json({ valid: false, error: 'This code has reached its redemption limit' });
      }

      // Code is valid - return details
      res.json({
        valid: true,
        type: promoCode.type,
        discountPercent: promoCode.discountPercent,
        freeAccessDays: promoCode.freeAccessDays,
        description: promoCode.description,
      });
    } catch (error) {
      console.error("Error validating promo code:", error);
      res.status(500).json({ valid: false, error: 'Failed to validate code' });
    }
  });

  // Redeem a promo code (requires auth)
  router.post('/api/promo/redeem', express.json(), isAuthenticated, async (req: any, res) => {
    try {
      const { code } = req.body;
      const userId = req.user.id;

      if (!code) {
        return res.status(400).json({ success: false, error: 'Code is required' });
      }

      const promoCode = await storage.getPromotionCodeByCode(code.toUpperCase());
      
      if (!promoCode) {
        return res.json({ success: false, error: 'Invalid promo code' });
      }

      // Check if active
      if (!promoCode.isActive) {
        return res.json({ success: false, error: 'This code is no longer active' });
      }

      // Check validity dates
      const now = new Date();
      if (promoCode.validFrom && now < new Date(promoCode.validFrom)) {
        return res.json({ success: false, error: 'This code is not yet valid' });
      }
      if (promoCode.validUntil && now > new Date(promoCode.validUntil)) {
        return res.json({ success: false, error: 'This code has expired' });
      }

      // Check redemption limits
      if (promoCode.maxRedemptions && promoCode.currentRedemptions >= promoCode.maxRedemptions) {
        return res.json({ success: false, error: 'This code has reached its redemption limit' });
      }

      // Check if user already redeemed this code
      const existingRedemption = await storage.getUserRedemptionForCode(userId, promoCode.id);
      if (existingRedemption) {
        return res.json({ success: false, error: 'You have already redeemed this code' });
      }

      // Process redemption based on type
      if (promoCode.type === 'free_access') {
        // Grant free premium access
        const days = promoCode.freeAccessDays || 30;
        const untilDate = new Date();
        untilDate.setDate(untilDate.getDate() + days);
        
        await storage.grantPremiumAccess(userId, untilDate);
        await storage.createRedemption(promoCode.id, userId);
        await storage.incrementCodeRedemptions(promoCode.id);

        return res.json({
          success: true,
          type: 'free_access',
          message: `You now have premium access for ${days} days!`,
          premiumUntil: untilDate.toISOString(),
        });
      } else if (promoCode.type === 'discount') {
        // For discount codes, return the Stripe coupon ID to use in checkout
        await storage.createRedemption(promoCode.id, userId);
        await storage.incrementCodeRedemptions(promoCode.id);

        return res.json({
          success: true,
          type: 'discount',
          message: `${promoCode.discountPercent}% discount applied!`,
          stripeCouponId: promoCode.stripeCouponId,
          discountPercent: promoCode.discountPercent,
        });
      }

      res.json({ success: false, error: 'Invalid code type' });
    } catch (error) {
      console.error("Error redeeming promo code:", error);
      res.status(500).json({ success: false, error: 'Failed to redeem code' });
    }
  });

  // Admin: List all promo codes
  router.get('/api/admin/promo-codes', isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.id);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const codes = await storage.listPromotionCodes();
      res.json({ codes });
    } catch (error) {
      console.error("Error listing promo codes:", error);
      res.status(500).json({ error: 'Failed to list promo codes' });
    }
  });

  // Admin: Create a promo code
  router.post('/api/admin/promo-codes', express.json(), isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.id);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { code, type, discountPercent, freeAccessDays, maxRedemptions, validFrom, validUntil, description } = req.body;

      if (!code || !type) {
        return res.status(400).json({ error: 'Code and type are required' });
      }

      if (type !== 'discount' && type !== 'free_access') {
        return res.status(400).json({ error: 'Type must be "discount" or "free_access"' });
      }

      // Check if code already exists
      const existing = await storage.getPromotionCodeByCode(code.toUpperCase());
      if (existing) {
        return res.status(400).json({ error: 'A code with this name already exists' });
      }

      let stripeCouponId = null;
      if (type === 'discount' && discountPercent) {
        // Create Stripe coupon for discount codes
        try {
          const coupon = await stripeService.createCoupon(discountPercent, code.toUpperCase());
          stripeCouponId = coupon.id;
        } catch (err) {
          console.error('Failed to create Stripe coupon:', err);
          // Continue without Stripe coupon - can be added later
        }
      }

      const promoCode = await storage.createPromotionCode({
        code: code.toUpperCase(),
        type,
        discountPercent: type === 'discount' ? discountPercent : null,
        freeAccessDays: type === 'free_access' ? freeAccessDays : null,
        maxRedemptions: maxRedemptions || null,
        stripeCouponId,
        validFrom: validFrom ? new Date(validFrom) : new Date(),
        validUntil: validUntil ? new Date(validUntil) : null,
        isActive: true,
        description: description || null,
        createdBy: req.user.id,
      });

      res.json({ success: true, code: promoCode });
    } catch (error) {
      console.error("Error creating promo code:", error);
      res.status(500).json({ error: 'Failed to create promo code' });
    }
  });

  // Admin: Deactivate a promo code
  router.post('/api/admin/promo-codes/:id/deactivate', isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.id);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const codeId = parseInt(req.params.id);
      const code = await storage.deactivatePromotionCode(codeId);
      res.json({ success: true, code });
    } catch (error) {
      console.error("Error deactivating promo code:", error);
      res.status(500).json({ error: 'Failed to deactivate promo code' });
    }
  });

  // Admin: Get redemptions for a code
  router.get('/api/admin/promo-codes/:id/redemptions', isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.id);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const codeId = parseInt(req.params.id);
      const redemptions = await storage.getRedemptionsForCode(codeId);
      res.json({ redemptions });
    } catch (error) {
      console.error("Error getting redemptions:", error);
      res.status(500).json({ error: 'Failed to get redemptions' });
    }
  });

  // ===== END PROMOTION CODE ROUTES =====

  router.get('/api/products-with-prices', async (req, res) => {
    try {
      let products: any[] = [];

      try {
        const rows = await storage.listStripeProductsWithPrices();
        const productsMap = new Map();
        for (const row of rows) {
          if (!productsMap.has(row.product_id)) {
            productsMap.set(row.product_id, {
              id: row.product_id,
              name: row.product_name,
              description: row.product_description,
              active: row.product_active,
              prices: []
            });
          }
          if (row.price_id) {
            productsMap.get(row.product_id).prices.push({
              id: row.price_id,
              unit_amount: row.unit_amount,
              currency: row.currency,
              recurring: row.recurring,
              active: row.price_active,
            });
          }
        }
        products = Array.from(productsMap.values());
      } catch (dbError) {
        console.warn("Database unavailable for products, falling back to Stripe API directly");
        try {
          const stripe = await getUncachableStripeClient();
          const productsResult = await stripe.products.list({ active: true, limit: 10 });
          for (const product of productsResult.data) {
            const pricesResult = await stripe.prices.list({ product: product.id, active: true });
            if (pricesResult.data.length > 0) {
              products.push({
                id: product.id,
                name: product.name,
                description: product.description,
                active: product.active,
                prices: pricesResult.data.map(p => ({
                  id: p.id,
                  unit_amount: p.unit_amount,
                  currency: p.currency,
                  recurring: p.recurring,
                  active: p.active,
                }))
              });
            }
          }
        } catch (stripeError) {
          console.error("Stripe API fallback also failed:", stripeError);
          throw stripeError;
        }
      }

      res.json({ data: products });
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  router.get("/api/weather", async (req, res) => {
    const location = req.query.q as string || "Portland,OR";
    const provider = (req.query.provider as string || "visualcrossing").toLowerCase();

    try {
      let weatherData: WeatherData;
      
      // Use cached versions for faster repeat requests
      if (provider === "noaa") {
        weatherData = await cachedFetchNOAA(location);
      } else if (provider === "openmeteo") {
        weatherData = await cachedFetchOpenMeteo(location);
      } else {
        weatherData = await cachedFetchVisualCrossing(location);
      }
      
      // Add cache headers for client-side caching
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min browser cache
      res.json(weatherData);
    } catch (error: any) {
      console.error("Weather fetch failed:", error);
      
      // Provide clearer error messages
      let errorMessage = error.message || "Failed to fetch weather data";
      if (provider === "noaa" && error.message?.includes("500")) {
        errorMessage = "NOAA weather service is temporarily unavailable. Please try again or switch to Visual Crossing.";
      }
      
      res.status(500).json({ message: errorMessage });
    }
  });

  // 15-Minute Precipitation Detail
  router.get("/api/weather/precipitation/15min", async (req, res) => {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const datetime = req.query.datetime as string; // ISO datetime string
    const timezone = req.query.timezone as string || 'UTC';
    const hourlyPrecip = parseFloat(req.query.hourlyPrecip as string);
    const hourlyProb = parseFloat(req.query.hourlyProb as string);

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !datetime) {
      return res.status(400).json({ message: "Missing required parameters: lat, lon, datetime" });
    }

    try {
      // Parse the requested datetime in the location's timezone
      const requestDateTime = DateTime.fromISO(datetime, { zone: timezone });
      const dateStr = requestDateTime.toISODate() || requestDateTime.toFormat('yyyy-MM-dd');

      // Fetch 15-minute data from Open-Meteo to get the precipitation pattern
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lon.toString(),
        minutely_15: 'precipitation,precipitation_probability',
        precipitation_unit: 'inch',
        timezone: 'auto',
        start_date: dateStr,
        end_date: dateStr
      });

      const url = `https://api.open-meteo.com/v1/forecast?${params}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Open-Meteo API failed: ${response.statusText}`);
      }

      const data = await response.json();

      // Extract 15-minute data
      const minutely15 = data.minutely_15 || {};
      const times = minutely15.time || [];
      const precipitation = minutely15.precipitation || [];
      const precipProbability = minutely15.precipitation_probability || [];

      // Find the 3-hour window around the requested time (1.5 hours before, 1.5 hours after)
      const targetTime = requestDateTime.toMillis();
      const windowStart = targetTime - (1.5 * 60 * 60 * 1000);
      const windowEnd = targetTime + (1.5 * 60 * 60 * 1000);

      // Filter data to the window
      const windowData = times
        .map((time: string, index: number) => {
          const itemTime = DateTime.fromISO(time, { zone: data.timezone || 'UTC' });
          return {
            time,
            precipitation: precipitation[index] || 0,
            precipProbability: precipProbability[index] || 0,
            timestamp: itemTime.toMillis(),
            itemDateTime: itemTime
          };
        })
        .filter((item: any) => item.timestamp >= windowStart && item.timestamp <= windowEnd);

      // If hourly precipitation was provided, scale the 15-minute data to match it
      if (Number.isFinite(hourlyPrecip) && hourlyPrecip > 0) {
        // Find the clicked hour's 15-minute intervals
        const hourStart = requestDateTime.startOf('hour').toMillis();
        const hourEnd = requestDateTime.endOf('hour').toMillis();
        
        const hourData = windowData.filter((item: any) => 
          item.timestamp >= hourStart && item.timestamp < hourEnd
        );
        
        // Calculate the sum of 15-minute data for this hour
        const apiHourTotal = hourData.reduce((sum: number, item: any) => sum + item.precipitation, 0);
        
        // If API has data for this hour, scale it to match the hourly total
        if (apiHourTotal > 0 && hourData.length > 0) {
          const scaleFactor = hourlyPrecip / apiHourTotal;
          
          // Apply scaling only to the clicked hour's data
          windowData.forEach((item: any) => {
            if (item.timestamp >= hourStart && item.timestamp < hourEnd) {
              item.precipitation = item.precipitation * scaleFactor;
            }
          });
        } else if (hourData.length > 0) {
          // No API precipitation, but we have hourly data - distribute evenly
          const precipPerInterval = hourlyPrecip / hourData.length;
          hourData.forEach((item: any) => {
            item.precipitation = precipPerInterval;
          });
        }
        
        // Use hourly probability for the clicked hour if provided
        if (Number.isFinite(hourlyProb)) {
          hourData.forEach((item: any) => {
            item.precipProbability = hourlyProb;
          });
        }
      }

      // Calculate summary stats
      const total = windowData.reduce((sum: number, item: any) => sum + item.precipitation, 0);
      const maxChance = Math.max(...windowData.map((item: any) => item.precipProbability || 0));

      res.json({
        requestedTime: datetime,
        windowStart: new Date(windowStart).toISOString(),
        windowEnd: new Date(windowEnd).toISOString(),
        data: windowData.map((item: any) => ({
          time: item.time,
          precipitation: item.precipitation,
          precipProbability: item.precipProbability,
          timestamp: item.timestamp
        })),
        summary: {
          total15min: total,
          maxChance: maxChance
        },
        timezone: data.timezone
      });

    } catch (error: any) {
      console.error("15-min precipitation fetch failed:", error);
      res.status(500).json({ message: error.message || "Failed to fetch 15-minute precipitation data" });
    }
  });

  // Expert Fishing Forecast
  router.get("/api/forecast/fishing", async (req, res) => {
    const location = req.query.location as string || "Portland,OR";
    const provider = (req.query.provider as string || "visualcrossing").toLowerCase();

    try {
      // First, fetch weather data to get lat/lon coordinates
      let weatherData: WeatherData;
      if (provider === "noaa") {
        weatherData = await cachedFetchNOAA(location);
      } else if (provider === "openmeteo") {
        weatherData = await cachedFetchOpenMeteo(location);
      } else {
        weatherData = await cachedFetchVisualCrossing(location);
      }

      const lat = weatherData.latitude;
      const lon = weatherData.longitude;

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error("Failed to geocode location");
      }

      // Create cache key with normalized coordinates and provider to prevent cross-location data
      const latRounded = Math.round(lat * 100) / 100;
      const lonRounded = Math.round(lon * 100) / 100;
      const cacheKey = getCacheKey('fishing-forecast', location.toLowerCase().trim(), latRounded.toString(), lonRounded.toString(), provider);
      
      // Check cache first (1 hour TTL)
      const cached = getCached<any>(cacheKey);
      if (cached) {
        console.log(`[Cache HIT] Fishing forecast: ${location} (${latRounded}, ${lonRounded}) - ${provider}`);
        res.setHeader('Cache-Control', 'public, max-age=1800');
        return res.json(cached);
      }
      
      console.log(`[Cache MISS] Fishing forecast: ${location} (${latRounded}, ${lonRounded}) - ${provider}`);

      // Fetch solunar, tide, and moon data using internal route handlers
      // Using the protocol/host from the request ensures this works in any deployment
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      
      const [solunarResponse, tideResponse, moonResponse] = await Promise.all([
        fetch(`${baseUrl}/api/solunar?location=${encodeURIComponent(location)}&lat=${lat}&lon=${lon}`),
        fetch(`${baseUrl}/api/tides?location=${encodeURIComponent(location)}`),
        fetch(`${baseUrl}/api/moon-phases?location=${encodeURIComponent(location)}&lat=${lat}&lon=${lon}`)
      ]);

      // Validate responses (tide data is optional)
      if (!solunarResponse.ok) {
        throw new Error(`Solunar API failed: ${solunarResponse.statusText}`);
      }
      if (!moonResponse.ok) {
        throw new Error(`Moon phases API failed: ${moonResponse.statusText}`);
      }

      // Parse responses - tide data is optional (404 is OK if no station available)
      const [solunarData, tideData, moonResponseData] = await Promise.all([
        solunarResponse.json(),
        tideResponse.ok ? tideResponse.json() : null,
        moonResponse.json()
      ]);
      
      // Extract phases array from new response format (supports both old and new)
      const moonData = moonResponseData?.phases || moonResponseData;

      // Validate data structure
      if (!Array.isArray(solunarData) || solunarData.length === 0) {
        throw new Error("Invalid solunar data received");
      }
      if (!Array.isArray(moonData) || moonData.length === 0) {
        throw new Error("Invalid moon phase data received");
      }
      
      // Tide data is optional - log if not available but don't fail
      if (!tideData) {
        console.log(`[FishingForecast] No tide data available for ${location} - continuing without tide analysis`);
      }

      // Generate fishing forecast with location timezone for proper sunrise/sunset parsing
      const timezone = weatherData.timezone || 'America/Chicago'; // fallback to Central Time
      const forecast = await FishingForecastService.generateForecast({
        weatherData,
        solunarData,
        moonData,
        tideData,
        location,
        timezone
      });

      const result = { forecast };
      
      // Store in cache with 1 hour TTL
      setCached(cacheKey, result, 3600);
      console.log(`[Cache SET] Fishing forecast: ${location} (${latRounded}, ${lonRounded}) - ${provider} - cached for 1 hour`);

      // Also set HTTP cache header
      res.setHeader('Cache-Control', 'public, max-age=1800');
      res.json(result);
    } catch (error: any) {
      console.error("Fishing forecast generation failed:", error);
      const statusCode = error.message?.includes('API failed') ? 502 : 500;
      res.status(statusCode).json({ message: error.message || "Failed to generate fishing forecast" });
    }
  });

  // Tides & Fishing Forecast
  router.get("/api/tides", async (req, res) => {
    const location = req.query.location as string || "San Francisco,CA";

    try {
      // Create cache key with normalized location
      const normalizedLocation = location.toLowerCase().trim();
      const cacheKey = getCacheKey('tides', normalizedLocation);
      
      // Check cache first (1 hour TTL)
      const cached = getCached<any>(cacheKey);
      if (cached) {
        console.log(`[Cache HIT] Tides: ${location}`);
        res.setHeader('Cache-Control', 'public, max-age=1800');
        return res.json(cached);
      }
      
      console.log(`[Cache MISS] Tides: ${location}`);
      
      // Geocode the location
      const apiKey = process.env.VISUAL_CROSSING_API_KEY;
      if (!apiKey) throw new Error("Geocoding unavailable");

      // Check geocoding cache to avoid redundant Visual Crossing calls
      const geocodeCacheKey = getCacheKey('geocode', normalizedLocation);
      let geocodeData = getCached<any>(geocodeCacheKey);
      
      if (!geocodeData) {
        console.log(`[Geocode] Fetching from Visual Crossing for: ${location}`);
        const geocodeUrl = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(location)}?unitGroup=us&key=${apiKey.trim()}&contentType=json&include=current`;
        const geocodeResponse = await fetch(geocodeUrl);

        if (!geocodeResponse.ok) {
          throw new Error("Failed to geocode location");
        }

        geocodeData = await geocodeResponse.json();
        // Cache geocoding result for 24 hours (coordinates don't change)
        setCached(geocodeCacheKey, geocodeData, 86400);
        console.log(`[Geocode] Cached for 24 hours: ${location}`);
      } else {
        console.log(`[Geocode] Cache hit for: ${location}`);
      }

      const lat = geocodeData.latitude;
      const lon = geocodeData.longitude;
      const locationTimezone = geocodeData.timezone || 'UTC';

      // Fetch tide data as ONE CONTINUOUS window (day -1 through day +14) for accurate coefficient pairing
      // Use location timezone to determine "today" so coefficient data starts at correct local time
      const { DateTime } = await import('luxon');
      const nowInLocation = DateTime.now().setZone(locationTimezone);
      const today = nowInLocation.toJSDate(); // Keep for later use
      
      // Calculate date range: previous day through 14 days forward (15 forecast days total)
      const beginDate = nowInLocation.minus({ days: 1 }).toISODate() || '';
      const endDate = nowInLocation.plus({ days: 14 }).toISODate() || '';
      
      // Fetch ALL tide data in ONE API call (16 days worth)
      const tideResult = await fetchTideDataRange(lat, lon, beginDate, endDate);
      
      if (!tideResult || !tideResult.predictions || tideResult.predictions.length === 0) {
        return res.status(404).json({ message: "No tide station available for this location" });
      }
      
      const { predictions: allPredictions, stationId, stationName } = tideResult;
      
      // Sort all predictions chronologically (should already be sorted, but ensure)
      allPredictions.sort((a, b) => a.time.getTime() - b.time.getTime());
      
      // Identify high/low tides from the continuous stream
      const allHighLowTides = identifyHighLowTides(allPredictions);
      
      // Fetch station datums for coefficient calculation (cached per station)
      // Coefficients are calculated from actual local tide amplitudes, NOT astronomical factors
      const datums = stationId ? await fetchStationDatums(stationId) : null;
      
      if (!datums || datums.referenceRange <= 0) {
        console.warn(`No valid reference range for station ${stationId}, cannot calculate coefficients`);
      }

      // Calculate tide coefficients per tide cycle (Nautide/SHOM method)
      // Both high AND low tides get coefficients based on the amplitude of their tide cycle
      // European scale: 20-120, where coefficient = (amplitude / referenceRange) * 100
      // - 20-45: Neap tides (small range)
      // - 70: Average tide
      // - 95-120: Spring tides (large range)
      
      // Calculate coefficients for all tides in the continuous stream BEFORE organizing into daily buckets
      for (let i = 0; i < allHighLowTides.length; i++) {
        const tide = allHighLowTides[i];
        
        if (tide.type === "H") {
          // High tide: amplitude = high - preceding low
          let precedingLow = null;
          for (let j = i - 1; j >= 0; j--) {
            if (allHighLowTides[j].type === "L") {
              precedingLow = allHighLowTides[j];
              break;
            }
          }
          
          if (datums && datums.referenceRange > 0 && precedingLow) {
            const amplitude = tide.height - precedingLow.height;
            if (amplitude > 0.01) {
              const coefficient = (amplitude / datums.referenceRange) * 100;
              tide.coefficient = Math.round(Math.max(20, Math.min(120, coefficient)));
            } else {
              tide.coefficient = undefined; // Skip invalid amplitude
            }
          } else {
            tide.coefficient = undefined; // No preceding low found
          }
        } else if (tide.type === "L") {
          // Low tide: amplitude = following high - low (REQUIRE following high)
          let followingHigh = null;
          for (let j = i + 1; j < allHighLowTides.length; j++) {
            if (allHighLowTides[j].type === "H") {
              followingHigh = allHighLowTides[j];
              break;
            }
          }
          
          if (datums && datums.referenceRange > 0 && followingHigh) {
            const amplitude = followingHigh.height - tide.height;
            if (amplitude > 0.01) {
              const coefficient = (amplitude / datums.referenceRange) * 100;
              tide.coefficient = Math.round(Math.max(20, Math.min(120, coefficient)));
            } else {
              tide.coefficient = undefined; // Skip invalid amplitude
            }
          } else {
            tide.coefficient = undefined; // No following high found or invalid data
          }
        }
      }
      
      // Now organize predictions and high/low tides (with coefficients) into daily buckets
      const forecast: any[] = [];
      
      // Create 15 forecast days (day 0 through day 14)
      for (let i = 0; i < 15; i++) {
        const forecastDate = nowInLocation.plus({ days: i });
        const dateStr = forecastDate.toISODate() || forecastDate.toFormat('yyyy-MM-dd');
        
        const dayStart = DateTime.fromISO(dateStr, { zone: locationTimezone }).startOf('day');
        const dayEnd = dayStart.endOf('day');
        
        // Filter predictions for this day
        const dayPredictions = allPredictions.filter(p => {
          const pTime = DateTime.fromJSDate(p.time, { zone: locationTimezone });
          return pTime >= dayStart && pTime <= dayEnd;
        });
        
        // Filter high/low tides for this day (coefficients already calculated)
        const dayHighLowTides = allHighLowTides.filter(t => {
          const tTime = DateTime.fromJSDate(t.time, { zone: locationTimezone });
          return tTime >= dayStart && tTime <= dayEnd;
        });
        
        // Downsample predictions for performance
        const downsampledPredictions = dayPredictions.filter((_, idx) => idx % 6 === 0);
        
        forecast.push({
          date: dateStr,
          stationId,
          stationName,
          predictions: downsampledPredictions.map((p) => ({
            time: p.time.toISOString(),
            height: p.height,
          })),
          highTides: dayHighLowTides.filter(p => p.type === "H").map(p => ({time: p.time.toISOString(), height: p.height, coefficient: p.coefficient})),
          lowTides: dayHighLowTides.filter(p => p.type === "L").map(p => ({time: p.time.toISOString(), height: p.height, coefficient: p.coefficient})),
          highLowTides: dayHighLowTides.map(p => ({time: p.time.toISOString(), height: p.height, type: p.type, coefficient: p.coefficient}))
        });
      }

      if (!forecast.length) {
        return res.status(404).json({ message: "No tide station available for this location" });
      }
      
      // Now aggregate coefficients per day (include both highs and lows)
      for (const day of forecast) {
        const dayCoefficients = (day.highLowTides || [])
          .filter((t: any) => t.coefficient !== undefined)
          .map((t: any) => t.coefficient);
        
        if (dayCoefficients.length > 0) {
          day.minCoefficient = Math.min(...dayCoefficients);
          day.maxCoefficient = Math.max(...dayCoefficients);
          day.avgCoefficient = Math.round(dayCoefficients.reduce((a: number, b: number) => a + b, 0) / dayCoefficients.length);
        } else {
          day.minCoefficient = 70;
          day.maxCoefficient = 70;
          day.avgCoefficient = 70;
        }
        
        // Update highTides and lowTides arrays with coefficients
        day.highTides = (day.highLowTides || []).filter((p: any) => p.type === "H").map((p: any) => ({
          time: p.time,
          height: p.height,
          coefficient: p.coefficient
        }));
        
        day.lowTides = (day.highLowTides || []).filter((p: any) => p.type === "L").map((p: any) => ({
          time: p.time,
          height: p.height,
          coefficient: p.coefficient
        }));
      }

      // Get next high/low from all 7 days using identified high/low tides
      const now = new Date();
      let nextHighTide: any = null;
      let nextLowTide: any = null;

      // Search through all forecast days for next high/low tides
      for (const day of forecast) {
        const highLowTides = (day.highLowTides || []).map((p: any) => ({...p, time: new Date(p.time)}));
        for (const pred of highLowTides) {
          if (pred.time > now) {
            if (pred.type === "H" && !nextHighTide) nextHighTide = pred;
            if (pred.type === "L" && !nextLowTide) nextLowTide = pred;
          }
        }
        if (nextHighTide && nextLowTide) break;
      }

      // Determine current tide state from identified high/low tides
      const tidesForStateCheck = forecast.flatMap(day => 
        (day.highLowTides || []).map((p: any) => ({...p, time: new Date(p.time)}))
      );
      let currentState: "rising" | "falling" = "rising";
      if (tidesForStateCheck.length >= 2) {
        for (let i = 0; i < tidesForStateCheck.length - 1; i++) {
          if (tidesForStateCheck[i].time <= now && tidesForStateCheck[i + 1].time >= now) {
            currentState = tidesForStateCheck[i].type === "L" ? "rising" : "falling";
            break;
          }
        }
      }

      const result = {
        stationId: forecast[0].stationId,
        stationName: forecast[0].stationName,
        latitude: lat,
        longitude: lon,
        forecast: forecast,
        nextHighTide: nextHighTide
          ? { time: nextHighTide.time.toISOString(), height: nextHighTide.height, type: "H", coefficient: nextHighTide.coefficient }
          : null,
        nextLowTide: nextLowTide
          ? { time: nextLowTide.time.toISOString(), height: nextLowTide.height, type: "L", coefficient: nextLowTide.coefficient }
          : null,
        currentTideState: currentState,
        currentTimeISO: now.toISOString(),
        todayDateISO: new Date(today).toISOString().split('T')[0],
      };
      
      // Store in cache with 1 hour TTL
      setCached(cacheKey, result, 3600);
      console.log(`[Cache SET] Tides: ${location} - cached for 1 hour`);
      
      res.setHeader('Cache-Control', 'public, max-age=1800');
      res.json(result);
    } catch (error: any) {
      console.error("Tides fetch failed:", error);
      res.status(500).json({ message: error.message || "Failed to fetch tide data" });
    }
  });

  // Get NOAA Tide Stations for Map
  router.get("/api/tides/stations", async (req, res) => {
    try {
      if (!tideStationsCache) {
        const stationsResponse = await fetch(
          `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions`
        );
        if (!stationsResponse.ok) return res.status(500).json({ message: "Failed to load stations" });
        const stationsData = await stationsResponse.json();
        tideStationsCache = stationsData.stations || [];
      }

      const stations = (tideStationsCache || [])
        .filter((s: any) => s.lat && s.lng && s.id && s.state)
        .map((s: any) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, state: s.state }))
        .slice(0, 500);

      res.json({ stations });
    } catch (error: any) {
      console.error("Stations fetch failed:", error);
      res.status(500).json({ message: "Failed to fetch stations" });
    }
  });

  // Search NOAA Tide Stations by name
  router.get("/api/tides/search", async (req, res) => {
    const query = (req.query.q as string || "").toLowerCase();
    if (!query || query.length < 2) {
      return res.json([]);
    }

    try {
      if (!tideStationsCache) {
        const stationsResponse = await fetch(
          `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions`
        );
        if (!stationsResponse.ok) return res.status(500).json({ message: "Failed to load stations" });
        const stationsData = await stationsResponse.json();
        tideStationsCache = stationsData.stations || [];
      }

      // Normalize text for better search matching (removes special chars, extra spaces)
      const normalizeForSearch = (text: string) => {
        return text
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '') // Remove special characters (apostrophes, commas, etc)
          .replace(/\s+/g, ' ') // Normalize whitespace
          .trim();
      };

      const normalizedQuery = normalizeForSearch(query);

      // Search stations by name (normalized) or station ID
      const results = (tideStationsCache || [])
        .filter((s: any) => s.name && s.lat && s.lng && s.id && s.state)
        .filter((s: any) => {
          const normalizedName = normalizeForSearch(s.name);
          const stationId = s.id.toString().toLowerCase();
          
          // Match by normalized name or station ID
          return normalizedName.includes(normalizedQuery) || stationId.includes(query);
        })
        .map((s: any) => ({
          id: s.id,
          name: s.name,
          region: s.state,
          state: s.state,
          lat: s.lat,
          lng: s.lng
        }))
        .slice(0, 10);

      res.json(results);
    } catch (error: any) {
      console.error("Tide station search failed:", error);
      res.status(500).json({ message: "Failed to search tide stations" });
    }
  });

  // City Search Autosuggest
  router.get("/api/search", async (req, res) => {
    const query = req.query.q as string;
    if (!query || query.length < 2) {
      return res.json([]);
    }

    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (!data.results) {
        return res.json([]);
      }

      const suggestions = data.results.map((item: any) => ({
        id: item.id,
        name: item.name,
        region: item.admin1 || item.country,
        country: item.country,
        label: `${item.name}, ${item.admin1 ? item.admin1 + ', ' : ''}${item.country}`
      }));

      res.json(suggestions);
    } catch (error) {
      console.error("Search API failed:", error);
      res.status(500).json({ message: "Failed to fetch suggestions" });
    }
  });

  // Reverse Geocoding (Lat/Lon -> City Name)
  router.get("/api/geolocate", async (req, res) => {
    const lat = req.query.lat as string;
    const lon = req.query.lon as string;

    if (!lat || !lon) {
      return res.status(400).json({ message: "Latitude and longitude required" });
    }

    try {
      // Use BigDataCloud for free reverse geocoding (no API key required)
      const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error("BigDataCloud API failed");
      }

      const data = await response.json();

      if (!data || !data.locality) {
        // Fallback: try to construct location from other fields
        const parts = [];
        if (data.city) parts.push(data.city);
        else if (data.locality) parts.push(data.locality);
        else if (data.principalSubdivision) parts.push(data.principalSubdivision);
        
        if (data.principalSubdivision && !parts.includes(data.principalSubdivision)) {
          parts.push(data.principalSubdivision);
        }
        if (data.countryCode) parts.push(data.countryCode);
        
        if (parts.length === 0) {
          return res.status(404).json({ message: "Location not found" });
        }
        
        return res.json({ location: parts.join(", ") });
      }

      // Construct location string: "City, State/Region, Country"
      const parts = [data.locality || data.city];
      if (data.principalSubdivision) parts.push(data.principalSubdivision);
      if (data.countryCode) parts.push(data.countryCode);
      
      const locationName = parts.join(", ");
      
      res.json({ location: locationName });
    } catch (error) {
      console.error("Geolocate API failed:", error);
      res.status(500).json({ message: "Failed to reverse geocode" });
    }
  });

  // In-memory tile cache: Map<cacheKey, {buffer: Buffer, timestamp: number}>
  const tileCache = new Map<string, {buffer: Buffer, timestamp: number}>();
  const TILE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  const MAX_CACHE_SIZE = 500; // Limit cache size

  // Moon Phase Data - fetches accurate moon data from Visual Crossing for the next 7 days
  // Includes solunar major/minor feeding periods for fishing (with 24-hour caching)
  router.get("/api/moon-phases", async (req, res) => {
    const location = (req.query.location as string) || "San Francisco,CA";
    const lat = parseFloat(req.query.lat as string) || 0;
    const lon = parseFloat(req.query.lon as string) || 0;
    
    if (!location || location.trim() === "") {
      return res.status(400).json({ message: "Location parameter is required" });
    }
    
    // Validate coordinates
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ message: "Valid latitude and longitude are required" });
    }
    
    try {
      // Create cache key with normalized coordinates (not location name alone)
      // This prevents serving stale data when user searches different location but with cached coordinates
      const latRounded = Math.round(lat * 100) / 100;
      const lonRounded = Math.round(lon * 100) / 100;
      const cacheKey = getCacheKey('moon-phases', location.toLowerCase().trim(), latRounded.toString(), lonRounded.toString());
      
      // Check cache first (24 hour TTL - moon data doesn't change frequently)
      const cached = getCached<any>(cacheKey);
      if (cached) {
        console.log(`[Cache HIT] Moon phases: ${location} (${latRounded}, ${lonRounded})`);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Vary', 'location, lat, lon');
        return res.json(cached);
      }
      
      console.log(`[Cache MISS] Moon phases: ${location} (${latRounded}, ${lonRounded})`);
      
      // Fetch moon phases data
      const result = await fetchMoonPhases(location, lat, lon);
      
      const response = {
        phases: result.phases,
        timezone: result.timezone
      };
      
      // Store in cache with 24 hour TTL
      setCached(cacheKey, response, 86400);
      console.log(`[Cache SET] Moon phases: ${location} (${latRounded}, ${lonRounded}) - cached for 24 hours`);
      
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Vary', 'location, lat, lon');
      res.json(response);
    } catch (error: any) {
      console.error("Moon phase fetch failed:", error);
      res.status(500).json({ message: error.message || "Failed to fetch moon phase data" });
    }
  });

  // Solunar Data - moon altitude curve and feeding period windows for fishing
  router.get("/api/solunar", async (req, res) => {
    const location = (req.query.location as string) || "San Francisco,CA";
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const daysParam = parseInt(req.query.days as string) || 15;
    
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ message: "Valid latitude and longitude are required" });
    }
    
    try {
      // Create cache key with normalized coordinates (round to 2 decimal places for ~1km precision)
      const latRounded = Math.round(lat * 100) / 100;
      const lonRounded = Math.round(lon * 100) / 100;
      const cacheKey = getCacheKey('solunar', location.toLowerCase().trim(), latRounded.toString(), lonRounded.toString(), daysParam.toString());
      
      // Check cache first (1 hour TTL)
      const cached = getCached<any[]>(cacheKey);
      if (cached) {
        console.log(`[Cache HIT] Solunar: ${location} (${latRounded}, ${lonRounded}) - ${daysParam} days`);
        res.setHeader('Cache-Control', 'public, max-age=1800');
        return res.json(cached);
      }
      
      console.log(`[Cache MISS] Solunar: ${location} (${latRounded}, ${lonRounded}) - ${daysParam} days`);
      
      const apiKey = process.env.VISUAL_CROSSING_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ message: "Visual Crossing API key not configured" });
      }

      // First, get location timezone by making a quick geocode call
      // This ensures we start the forecast from "today" in the LOCATION'S timezone, not UTC
      const { DateTime } = await import('luxon');
      const geocodeUrl = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(location)}/today?unitGroup=us&key=${apiKey.trim()}&contentType=json&elements=datetime&include=days`;
      const geocodeResponse = await fetch(geocodeUrl);
      if (!geocodeResponse.ok) {
        throw new Error(`Visual Crossing geocode error: ${geocodeResponse.status}`);
      }
      const geocodeData = await geocodeResponse.json();
      const locationTimezone = geocodeData.timezone || 'UTC';
      
      // Get date range starting from TODAY in location's timezone
      const todayInLocation = DateTime.now().setZone(locationTimezone);
      const startDate = todayInLocation.toISODate() || todayInLocation.toFormat('yyyy-MM-dd');
      const endDateInLocation = todayInLocation.plus({ days: daysParam - 1 });
      const endDate = endDateInLocation.toISODate() || endDateInLocation.toFormat('yyyy-MM-dd');
      
      console.log(`[Solunar] Using timezone: ${locationTimezone} for location: ${location}`);
      console.log(`[Solunar] Date range: ${startDate} to ${endDate} (location's timezone)`);

      // Fetch moon data from Visual Crossing for moonrise/moonset times
      const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(location)}/${startDate}/${endDate}?unitGroup=us&key=${apiKey.trim()}&contentType=json&elements=datetime,moonrise,moonset&include=days`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Visual Crossing API error: ${response.status}`);
      }

      const data = await response.json();
      
      // Helper to format time as HH:MM:SS in location's timezone (not UTC)
      const formatTime = (date: Date | null | undefined) => {
        if (!date || isNaN(date.getTime())) return null;
        // Convert to location timezone for display
        const dt = DateTime.fromJSDate(date, { zone: 'utc' }).setZone(locationTimezone);
        return dt.toFormat('HH:mm:ss');
      };
      
      // Helper to parse Visual Crossing time format (HH:MM:SS) to Date in location timezone
      const parseVCTime = (dateStr: string, timeStr: string | null): Date | null => {
        if (!timeStr) return null;
        try {
          // Parse in location's timezone, then convert to JS Date (UTC milliseconds)
          return DateTime.fromISO(`${dateStr}T${timeStr}`, { zone: locationTimezone }).toJSDate();
        } catch {
          return null;
        }
      };

      // First pass: Calculate all feeding periods across ALL days
      const allFeedingPeriods: (FeedingPeriod & { date: string })[] = [];
      
      data.days.forEach((day: any) => {
        const dateStr = day.datetime;
        
        // Create day boundaries in LOCATION's timezone, then convert to UTC milliseconds
        const dayStart = DateTime.fromISO(`${dateStr}T00:00:00`, { zone: locationTimezone }).toJSDate();
        const dayEnd = DateTime.fromISO(`${dateStr}T23:59:59`, { zone: locationTimezone }).toJSDate();
        
        // Parse moonrise/moonset from Visual Crossing
        const moonriseDate = parseVCTime(dateStr, day.moonrise);
        const moonsetDate = parseVCTime(dateStr, day.moonset);
        
        // Get moon transit (overhead) from suncalc3
        // Note: SunCalc.getMoonTimes may not exist in all versions of suncalc3
        // Fallback to calculating transit from moonrise/moonset if needed
        let moonOverheadDate: Date | null = null;
        try {
          if (typeof SunCalc.getMoonTimes === 'function') {
            const moonTimes = SunCalc.getMoonTimes(dayStart, lat, lon);
            moonOverheadDate = moonTimes.transit || null;
          }
        } catch (e) {
          // Fallback: estimate transit as midpoint between rise and set
          if (moonriseDate && moonsetDate) {
            const midTime = moonriseDate.getTime() + (moonsetDate.getTime() - moonriseDate.getTime()) / 2;
            moonOverheadDate = new Date(midTime);
          }
        }
        
        // If no transit from suncalc3, estimate from moonrise/moonset
        if (!moonOverheadDate && moonriseDate && moonsetDate) {
          const midTime = moonriseDate.getTime() + (moonsetDate.getTime() - moonriseDate.getTime()) / 2;
          moonOverheadDate = new Date(midTime);
        }
        
        // Calculate underfoot as transit + 12 hours (opposite side of Earth)
        let moonUnderfootDate: Date | null = null;
        if (moonOverheadDate) {
          moonUnderfootDate = new Date(moonOverheadDate.getTime() + 12 * 60 * 60 * 1000);
        }
        
        // Calculate moon altitude samples throughout the day (every 10 minutes)
        const moonAltitudes: MoonAltitudeSample[] = [];
        const sampleInterval = 10 * 60 * 1000; // 10 minutes in ms
        
        let currentTime = dayStart.getTime();
        const endTime = dayEnd.getTime();
        
        // Track max altitude for normalization
        let maxAltitude = 0;
        const rawAltitudes: { timestamp: number; altitude: number }[] = [];
        
        // Check if suncalc3 getMoonPosition is available
        const hasMoonPosition = typeof SunCalc.getMoonPosition === 'function';
        
        while (currentTime <= endTime) {
          let altitudeDegrees = 0;
          
          if (hasMoonPosition) {
            try {
              const sampleDate = new Date(currentTime);
              const moonPos = SunCalc.getMoonPosition(sampleDate, lat, lon);
              // Altitude is in radians, convert to degrees
              altitudeDegrees = moonPos.altitude * (180 / Math.PI);
            } catch (e) {
              // If getMoonPosition fails, use sinusoidal approximation
              altitudeDegrees = 0;
            }
          }
          
          // Fallback: Create a sinusoidal curve based on moonrise/moonset times
          if (!hasMoonPosition && moonriseDate && moonsetDate) {
            const riseTs = moonriseDate.getTime();
            const setTs = moonsetDate.getTime();
            const transitTs = moonOverheadDate?.getTime() || (riseTs + (setTs - riseTs) / 2);
            
            // Moon visible when between rise and set
            if (currentTime >= riseTs && currentTime <= setTs) {
              // Calculate position in arc (0 = rise, 0.5 = transit, 1 = set)
              const progress = (currentTime - riseTs) / (setTs - riseTs);
              // Sinusoidal curve peaking at transit
              altitudeDegrees = Math.sin(progress * Math.PI) * 45; // Max ~45 degrees
            }
          }
          
          rawAltitudes.push({
            timestamp: currentTime,
            altitude: altitudeDegrees
          });
          
          if (altitudeDegrees > maxAltitude) {
            maxAltitude = altitudeDegrees;
          }
          
          currentTime += sampleInterval;
        }
        
        // Normalize altitudes to 0-100 scale (only positive altitudes, below horizon = 0)
        for (const sample of rawAltitudes) {
          const normalizedAltitude = maxAltitude > 0 
            ? Math.max(0, (sample.altitude / maxAltitude) * 100)
            : 0;
          
          moonAltitudes.push({
            timestamp: sample.timestamp,
            altitude: normalizedAltitude
          });
        }
        
        // Find moonrise and moonset from actual altitude data (where curve crosses horizon)
        // These are more accurate than Visual Crossing API times
        const horizonCrossings: { timestamp: number; type: 'rise' | 'set' }[] = [];
        for (let i = 1; i < rawAltitudes.length; i++) {
          const prevAlt = rawAltitudes[i - 1].altitude;
          const currAlt = rawAltitudes[i].altitude;
          
          // Crossing from below to above horizon = moonrise
          if (prevAlt <= 0 && currAlt > 0) {
            horizonCrossings.push({
              timestamp: rawAltitudes[i].timestamp,
              type: 'rise'
            });
          }
          // Crossing from above to below horizon = moonset
          else if (prevAlt > 0 && currAlt <= 0) {
            horizonCrossings.push({
              timestamp: rawAltitudes[i].timestamp,
              type: 'set'
            });
          }
        }
        
        // Build feeding periods (collecting to allFeedingPeriods with actual occurrence date)
        
        // Minor periods: Moonrise and moonset from altitude data
        for (const crossing of horizonCrossings) {
          const crossingDate = new Date(crossing.timestamp);
          // Determine which day this period actually occurs on (in location timezone)
          const occurrenceDate = DateTime.fromMillis(crossing.timestamp, { zone: locationTimezone }).toFormat('yyyy-MM-dd');
          
          allFeedingPeriods.push({
            type: 'minor',
            event: crossing.type,
            centerTime: formatTime(crossingDate)!,
            centerTimestamp: crossing.timestamp,
            startTimestamp: crossing.timestamp - 30 * 60 * 1000,
            endTimestamp: crossing.timestamp + 30 * 60 * 1000,
            duration: 30,
            date: occurrenceDate // Assign to the day it actually occurs on!
          });
        }
        
        // Find ACTUAL peaks in the altitude data for MAJOR periods
        // The peak is when moon altitude is highest (overhead), not the astronomical transit
        // Look for local maxima in the altitude samples that are above the horizon
        const peaks: { timestamp: number; altitude: number }[] = [];
        for (let i = 1; i < rawAltitudes.length - 1; i++) {
          const prev = rawAltitudes[i - 1].altitude;
          const curr = rawAltitudes[i].altitude;
          const next = rawAltitudes[i + 1].altitude;
          
          // Local maximum: current is higher than both neighbors and above horizon
          if (curr > prev && curr > next && curr > 5) { // 5 degrees threshold
            peaks.push({
              timestamp: rawAltitudes[i].timestamp,
              altitude: curr
            });
          }
        }
        
        // Sort peaks by altitude (highest first) and take up to 2 peaks for this day
        peaks.sort((a, b) => b.altitude - a.altitude);
        const majorPeaks = peaks.slice(0, 2);
        
        // Create MAJOR periods at actual altitude peaks (overhead = highest visible peak)
        if (majorPeaks.length > 0) {
          // Primary peak = overhead (moon at its highest visible point)
          const overheadTime = majorPeaks[0].timestamp;
          const overheadDate = new Date(overheadTime);
          const occurrenceDate = DateTime.fromMillis(overheadTime, { zone: locationTimezone }).toFormat('yyyy-MM-dd');
          
          allFeedingPeriods.push({
            type: 'major',
            event: 'overhead',
            centerTime: formatTime(overheadDate)!,
            centerTimestamp: overheadTime,
            startTimestamp: overheadTime - 60 * 60 * 1000,
            endTimestamp: overheadTime + 60 * 60 * 1000,
            duration: 60,
            date: occurrenceDate
          });
        }
        
        // Underfoot period: 12 hours from overhead
        // Underfoot is when moon is on opposite side of Earth (gravitational effect)
        if (majorPeaks.length > 0) {
          // Calculate underfoot as 12 hours offset from the primary overhead
          const underfootTime = majorPeaks[0].timestamp + 12 * 60 * 60 * 1000;
          const underfootDate = new Date(underfootTime);
          const occurrenceDate = DateTime.fromMillis(underfootTime, { zone: locationTimezone }).toFormat('yyyy-MM-dd');
          
          // Add underfoot period - it will be assigned to the day it actually occurs on
          allFeedingPeriods.push({
            type: 'major',
            event: 'underfoot',
            centerTime: formatTime(underfootDate)!,
            centerTimestamp: underfootTime,
            startTimestamp: underfootTime - 60 * 60 * 1000,
            endTimestamp: underfootTime + 60 * 60 * 1000,
            duration: 60,
            date: occurrenceDate
          });
        }
      });
      
      // Second pass: Build final solunarData array with feeding periods assigned to correct days
      const solunarData: SolunarData[] = data.days.map((day: any) => {
        const dateStr = day.datetime;
        
        // Re-build day boundaries and moon data (same as before)
        const dayStart = DateTime.fromISO(`${dateStr}T00:00:00`, { zone: locationTimezone }).toJSDate();
        const dayEnd = DateTime.fromISO(`${dateStr}T23:59:59`, { zone: locationTimezone }).toJSDate();
        
        const moonriseDate = parseVCTime(dateStr, day.moonrise);
        const moonsetDate = parseVCTime(dateStr, day.moonset);
        
        let moonOverheadDate: Date | null = null;
        try {
          if (typeof SunCalc.getMoonTimes === 'function') {
            const moonTimes = SunCalc.getMoonTimes(dayStart, lat, lon);
            moonOverheadDate = moonTimes.transit || null;
          }
        } catch (e) {
          if (moonriseDate && moonsetDate) {
            const midTime = moonriseDate.getTime() + (moonsetDate.getTime() - moonriseDate.getTime()) / 2;
            moonOverheadDate = new Date(midTime);
          }
        }
        
        if (!moonOverheadDate && moonriseDate && moonsetDate) {
          const midTime = moonriseDate.getTime() + (moonsetDate.getTime() - moonriseDate.getTime()) / 2;
          moonOverheadDate = new Date(midTime);
        }
        
        let moonUnderfootDate: Date | null = null;
        if (moonOverheadDate) {
          moonUnderfootDate = new Date(moonOverheadDate.getTime() + 12 * 60 * 60 * 1000);
        }
        
        // Calculate moon altitudes for this day (reuse same logic as before)
        const moonAltitudes: MoonAltitudeSample[] = [];
        const sampleInterval = 10 * 60 * 1000; // 10 minutes
        
        let currentTime = dayStart.getTime();
        const endTime = dayEnd.getTime();
        
        let maxAltitude = 0;
        const rawAltitudes: { timestamp: number; altitude: number }[] = [];
        
        const hasMoonPosition = typeof SunCalc.getMoonPosition === 'function';
        
        while (currentTime <= endTime) {
          let altitudeDegrees = 0;
          
          if (hasMoonPosition) {
            try {
              const sampleDate = new Date(currentTime);
              const moonPos = SunCalc.getMoonPosition(sampleDate, lat, lon);
              altitudeDegrees = moonPos.altitude * (180 / Math.PI);
            } catch (e) {
              altitudeDegrees = 0;
            }
          }
          
          if (!hasMoonPosition && moonriseDate && moonsetDate) {
            const riseTs = moonriseDate.getTime();
            const setTs = moonsetDate.getTime();
            const transitTs = moonOverheadDate?.getTime() || (riseTs + (setTs - riseTs) / 2);
            
            if (currentTime >= riseTs && currentTime <= setTs) {
              const progress = (currentTime - riseTs) / (setTs - riseTs);
              altitudeDegrees = Math.sin(progress * Math.PI) * 45;
            }
          }
          
          rawAltitudes.push({
            timestamp: currentTime,
            altitude: altitudeDegrees
          });
          
          if (altitudeDegrees > maxAltitude) {
            maxAltitude = altitudeDegrees;
          }
          
          currentTime += sampleInterval;
        }
        
        for (const sample of rawAltitudes) {
          const normalizedAltitude = maxAltitude > 0 
            ? Math.max(0, (sample.altitude / maxAltitude) * 100)
            : 0;
          
          moonAltitudes.push({
            timestamp: sample.timestamp,
            altitude: normalizedAltitude
          });
        }
        
        // Filter feeding periods that occur on THIS day
        const feedingPeriods = allFeedingPeriods
          .filter(period => period.date === dateStr)
          .map(({ date, ...period }) => period) // Remove temporary 'date' field
          .sort((a, b) => a.startTimestamp - b.startTimestamp);
        
        return {
          date: dateStr,
          moonAltitudes,
          feedingPeriods,
          moonrise: day.moonrise || null,
          moonset: day.moonset || null,
          moonOverhead: formatTime(moonOverheadDate),
          moonUnderfoot: formatTime(moonUnderfootDate)
        };
      });

      // Store in cache with 1 hour TTL
      setCached(cacheKey, solunarData, 3600);
      console.log(`[Cache SET] Solunar: ${location} (${latRounded}, ${lonRounded}) - ${daysParam} days - cached for 1 hour`);

      res.setHeader('Cache-Control', 'public, max-age=1800');
      res.json(solunarData);
    } catch (error: any) {
      console.error("Solunar data fetch failed:", error);
      res.status(500).json({ message: error.message || "Failed to fetch solunar data" });
    }
  });

  // Tomorrow.io Radar Tile Proxy with caching
  router.get("/api/weather/radar-tile/:z/:x/:y/:timestamp", async (req, res) => {
    const { z, x, y, timestamp } = req.params;
    const apiKey = process.env.TOMORROW_IO_API_KEY;
    
    if (!apiKey) {
      console.error("TOMORROW_IO_API_KEY is missing");
      return res.status(500).json({ message: "Radar service unavailable" });
    }

    // Create cache key (round timestamp to nearest 5 minutes for better cache hits)
    const timestampDate = new Date(timestamp);
    const roundedMinutes = Math.floor(timestampDate.getMinutes() / 5) * 5;
    timestampDate.setMinutes(roundedMinutes, 0, 0);
    const cacheKey = `${z}_${x}_${y}_${timestampDate.toISOString()}`;

    // Check cache
    const cached = tileCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < TILE_CACHE_TTL) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min client cache
      res.setHeader('X-Cache', 'HIT');
      return res.send(cached.buffer);
    }

    try {
      const url = `https://api.tomorrow.io/v4/map/tile/${z}/${x}/${y}/precipitationIntensity/${timestamp}.png?apikey=${apiKey.trim()}`;
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 429) {
          console.warn(`Tomorrow.io rate limit hit for tile ${z}/${x}/${y}`);
          // Return transparent tile on rate limit instead of error
          const emptyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'no-cache');
          return res.send(emptyPng);
        }
        console.error(`Tomorrow.io tile request failed: ${response.status}`);
        return res.status(response.status).send();
      }

      // Store in cache
      const buffer = Buffer.from(await response.arrayBuffer());
      
      // Evict old entries if cache is too large
      if (tileCache.size >= MAX_CACHE_SIZE) {
        const firstKey = tileCache.keys().next().value;
        if (firstKey) tileCache.delete(firstKey);
      }
      
      tileCache.set(cacheKey, { buffer, timestamp: Date.now() });

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min client cache
      res.setHeader('X-Cache', 'MISS');
      res.send(buffer);
    } catch (error) {
      console.error("Tomorrow.io radar tile error:", error);
      // Return transparent tile on error
      const emptyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      res.setHeader('Content-Type', 'image/png');
      res.send(emptyPng);
    }
  });

  app.use(router);

  const httpServer = createServer(app);
  return httpServer;
}
