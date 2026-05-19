import type { Request, Response } from 'express';
import { DateTime } from 'luxon';

interface FishingWindow {
  startTime: Date;
  endTime: Date;
  triggers: string[];
  score: number;
  tideCoeff: number | null;
}

interface DayForecast {
  date: string;
  dayName: string;
  rating: number; // 1-5 stars
  score: number; // 0-100
  windows: FishingWindow[];
  tideCoeff: number | null;
  weather: {
    temp: number;
    tempMin: number;
    tempMax: number;
    windSpeed: number;
    windDir?: number;
    clouds: number;
    precip: number;
    pressureTrend: string;
  };
  sunrise: number | null;
  sunset: number | null;
  note: string;
}

export class FishingForecastService {
  /**
   * Generate fishing forecast for next 15 days
   */
  static async generateForecast(params: {
    weatherData: any;
    solunarData: any[];
    moonData: any[];
    tideData: any;
    location: string;
    timezone: string;
  }): Promise<DayForecast[]> {
    const { weatherData, solunarData, moonData, tideData, location, timezone } = params;
    const forecasts: DayForecast[] = [];

    // Collect ALL tide events across ALL days for cross-day coefficient lookups
    const allTideEvents: any[] = [];
    if (tideData?.forecast) {
      for (const day of tideData.forecast) {
        const dayTides = day.highLowTides || [];
        for (const tide of dayTides) {
          allTideEvents.push({
            time: tide.time,
            height: tide.height,
            type: tide.type === 'H' ? 'high' : 'low',
            coefficient: tide.coefficient
          });
        }
      }
      // Sort chronologically to enable proper prev/next tide lookups
      allTideEvents.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    }

    // Process each day (up to 15 days)
    const daysToProcess = Math.min(15, solunarData.length);
    
    for (let dayIndex = 0; dayIndex < daysToProcess; dayIndex++) {
      const solunarDay = solunarData[dayIndex];
      const dayDate = new Date(solunarDay.date);
      
      // Find corresponding weather and moon data
      const weatherDay = weatherData.days.find((d: any) => 
        new Date(d.fullDate).toDateString() === dayDate.toDateString()
      );
      const moonDay = moonData.find((m: any) => 
        new Date(m.date).toDateString() === dayDate.toDateString()
      );
      
      if (!weatherDay || !moonDay) continue;

      // Get tide data for this day
      const tideDay = tideData?.forecast?.find((td: any) => 
        new Date(td.date).toDateString() === dayDate.toDateString()
      );

      // Analyze and score this day
      const dayForecast = this.analyzeDayForFishing({
        date: solunarDay.date,
        solunarDay,
        weatherDay,
        moonDay,
        tideDay,
        allTideEvents, // Pass full cross-day tide array
        timezone,
        previousDayWeather: dayIndex > 0 ? weatherData.days.find((d: any) => 
          new Date(d.fullDate).toDateString() === new Date(new Date(solunarDay.date).getTime() - 86400000).toDateString()
        ) : null
      });

      // Include all days regardless of rating - show complete 15-day forecast
      forecasts.push(dayForecast);
    }

    return forecasts;
  }

  /**
   * Analyze a single day and generate forecast
   */
  private static analyzeDayForFishing(params: {
    date: string;
    solunarDay: any;
    weatherDay: any;
    moonDay: any;
    tideDay: any;
    allTideEvents: any[]; // Full cross-day tide array for accurate coefficient lookups
    timezone: string;
    previousDayWeather: any;
  }): DayForecast {
    const { date, solunarDay, weatherDay, moonDay, tideDay, allTideEvents, timezone, previousDayWeather } = params;
    
    const dayDate = new Date(date);
    const dateStr = date.split('T')[0];
    
    // Parse sunrise/sunset in the LOCATION'S timezone (not server timezone!) and convert to UTC
    // moonDay.sunrise/sunset are times like "07:06:51" in the location's local time
    const sunriseTs = moonDay.sunrise ? 
      DateTime.fromISO(`${dateStr}T${moonDay.sunrise}`, { zone: timezone }).toMillis() : null;
    const sunsetTs = moonDay.sunset ? 
      DateTime.fromISO(`${dateStr}T${moonDay.sunset}`, { zone: timezone }).toMillis() : null;
    
    // Validate timestamps - skip day if sunrise/sunset data is missing or invalid
    if (!sunriseTs || !sunsetTs || isNaN(sunriseTs) || isNaN(sunsetTs)) {
      console.warn(`[FishingForecast] Missing or invalid sunrise/sunset for ${dateStr}, using fallback scoring`);
    }
    
    // Parse moonrise/moonset in location timezone
    // Moon API returns full ISO strings with timezone (e.g., "2025-12-01T14:30:00-06:00")
    const moonriseTs = moonDay.moonrise ? DateTime.fromISO(moonDay.moonrise).toMillis() : null;
    const moonsetTs = moonDay.moonset ? DateTime.fromISO(moonDay.moonset).toMillis() : null;

    // Calculate temperature trend
    const tempTrend = this.calculateTempTrend(weatherDay, previousDayWeather);
    
    // Calculate barometric pressure trend
    const pressureTrend = this.calculatePressureTrend(weatherDay);

    // Find all potential fishing windows
    const allWindows: FishingWindow[] = [];

    // Analyze each solunar period
    solunarDay.feedingPeriods.forEach((period: any) => {
      const window = this.analyzePeriod({
        period,
        weatherDay,
        moonDay,
        tideDay,
        allTideEvents, // Pass cross-day tide data
        sunriseTs,
        sunsetTs,
        moonriseTs,
        moonsetTs,
        tempTrend,
        pressureTrend,
        dateStr,
        timezone
      });
      
      if (window) {
        allWindows.push(window);
      }
    });

    // Sort ALL windows chronologically by start time for display
    // This allows users to see all minor and major periods and compare scores
    allWindows.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    // Calculate overall day score (based on all windows)
    const dayScore = this.calculateDayScore({
      topWindows: allWindows,
      tideDay,
      tempTrend,
      pressureTrend,
      weatherDay
    });

    // Convert score to star rating
    const rating = this.scoreToStars(dayScore);

    // Get average weather for the day
    const avgWeather = this.getAverageWeather(weatherDay, pressureTrend);

    // Generate expert note
    const note = this.generateExpertNote({
      tempTrend,
      pressureTrend,
      tideDay,
      weatherDay,
      moonDay
    });

    return {
      date,
      dayName: dayDate.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }),
      rating,
      score: Math.round(dayScore),
      windows: allWindows,
      tideCoeff: tideDay?.avgCoefficient || null,
      weather: avgWeather,
      sunrise: sunriseTs,
      sunset: sunsetTs,
      note
    };
  }

  /**
   * Analyze a single feeding period to create a fishing window
   */
  private static analyzePeriod(params: {
    period: any;
    weatherDay: any;
    moonDay: any;
    tideDay: any;
    allTideEvents: any[]; // Full cross-day tide array
    sunriseTs: number | null;
    sunsetTs: number | null;
    moonriseTs: number | null;
    moonsetTs: number | null;
    tempTrend: number;
    pressureTrend: string;
    dateStr: string;
    timezone: string;
  }): FishingWindow | null {
    const { period, weatherDay, tideDay, allTideEvents, sunriseTs, sunsetTs, moonriseTs, moonsetTs, tempTrend, pressureTrend, dateStr, timezone } = params;
    
    const centerTs = period.centerTimestamp;
    const startTs = period.startTimestamp;
    const endTs = period.endTimestamp;

    // Filter for DAYTIME fishing only (sunrise to sunset in location timezone)
    if (sunriseTs && sunsetTs && !isNaN(sunriseTs) && !isNaN(sunsetTs)) {
      // Convert UTC timestamps to location timezone for comparison
      const centerLocal = DateTime.fromMillis(centerTs, { zone: timezone });
      const startLocal = DateTime.fromMillis(startTs, { zone: timezone });
      const endLocal = DateTime.fromMillis(endTs, { zone: timezone });
      
      const sunriseLocal = DateTime.fromMillis(sunriseTs, { zone: timezone });
      const sunsetLocal = DateTime.fromMillis(sunsetTs, { zone: timezone });
      
      // Check if this period is on the same day as our forecast day
      const forecastDate = dateStr; // e.g., "2025-12-01"
      const periodDate = centerLocal.toFormat('yyyy-MM-dd');
      
      // Only process periods that match our forecast day
      if (periodDate !== forecastDate) {
        console.log(`[FishingForecast] Skipping period on ${periodDate} (forecast day is ${forecastDate})`);
        return null; // Skip periods from other days
      }
      
      // Check if ANY part of the period overlaps with daylight hours
      // Only skip if ENTIRE period (both start AND end) is outside daylight
      const periodStartsAfterSunset = startTs > sunsetTs;
      const periodEndsBeforeSunrise = endTs < sunriseTs;
      
      const centerHour = centerLocal.hour + centerLocal.minute / 60;
      const sunriseHour = sunriseLocal.hour + sunriseLocal.minute / 60;
      const sunsetHour = sunsetLocal.hour + sunsetLocal.minute / 60;
      
      console.log(`[FishingForecast] ${dateStr} period at ${centerLocal.toFormat('HH:mm')}: type=${period.type}, event=${period.event}, daylight check: ${centerHour.toFixed(2)} vs sunrise ${sunriseHour.toFixed(2)} - sunset ${sunsetHour.toFixed(2)}`);
      
      // Skip only if the entire period is at night (no overlap with daylight)
      if (periodEndsBeforeSunrise || periodStartsAfterSunset) {
        console.log(`[FishingForecast] → Skipping nighttime period (entire period outside daylight)`);
        return null;
      }
      
      // Period has at least partial daylight overlap - include it
      if (centerHour < sunriseHour || centerHour > sunsetHour) {
        console.log(`[FishingForecast] → Including partial daylight period (center at night but overlaps daylight)`);
      }
    } else {
      // Missing sunrise/sunset data - skip to be safe
      console.warn(`[FishingForecast] Missing sunrise/sunset data for ${dateStr}`);
      return null;
    }

    // Find closest hourly weather
    // IMPORTANT: hourly weather datetime is in local time without timezone offset (e.g., "2025-12-03T09:00")
    // We must parse it in the location timezone, not as UTC
    let hourData: any = null;
    let minDiff = Infinity;
    weatherDay.hours.forEach((h: any) => {
      // Parse hourly datetime in location timezone
      const hourTs = DateTime.fromISO(h.datetime, { zone: timezone }).toMillis();
      const diff = Math.abs(hourTs - centerTs);
      if (diff < minDiff && diff < 5400000) { // Within 90 min
        minDiff = diff;
        hourData = h;
      }
    });

    if (!hourData) {
      console.warn(`[FishingForecast] No hourly weather found for period at ${new Date(centerTs).toISOString()}`);
      return null;
    }

    // Calculate window score
    let score = 0;
    const triggers: string[] = [];

    // Major vs Minor solunar (baseline)
    if (period.type === 'major') {
      score += 25;
      triggers.push(period.event === 'overhead' ? 'Major (moon overhead)' : 'Major (moon underfoot)');
    } else {
      score += 15;
      triggers.push('Minor solunar');
    }

    // Sunrise/Sunset ±1 hour (#1 bite trigger - worth 30 points)
    if (sunriseTs && !isNaN(sunriseTs)) {
      const sunriseOverlap = Math.abs(centerTs - sunriseTs) < 3600000; // Within 1 hour
      if (sunriseOverlap) {
        score += 30;
        triggers.push('Sunrise ±1hr');
      }
    }
    if (sunsetTs && !isNaN(sunsetTs)) {
      const sunsetOverlap = Math.abs(centerTs - sunsetTs) < 3600000;
      if (sunsetOverlap) {
        score += 30;
        triggers.push('Sunset ±1hr');
      }
    }

    // Exact moonrise/moonset (15-30 min sharp bite - worth 20 points)
    if (moonriseTs && !isNaN(moonriseTs) && Math.abs(centerTs - moonriseTs) < 1800000) { // Within 30 min
      score += 20;
      triggers.push('Moonrise');
    }
    if (moonsetTs && !isNaN(moonsetTs) && Math.abs(centerTs - moonsetTs) < 1800000) {
      score += 20;
      triggers.push('Moonset');
    }

    // Tide analysis (worth up to 25 points) - REMOVED, now integrated below
    // This section was moved down to combine with coefficient extraction

    // Temperature trend (worth up to 20 points)
    // Note: This is air temp trend, which affects fishing comfort and fish activity
    if (tempTrend >= 2 && tempTrend <= 4) {
      score += 20;
      triggers.push(`Warming trend (+${tempTrend.toFixed(1)}°F)`);
    } else if (tempTrend > 4) {
      score += 10; // Reduced bonus for rapid warming
      triggers.push(`Rapid warming (+${tempTrend.toFixed(1)}°F)`);
    } else if (tempTrend < -3) {
      score -= 10; // Penalty for falling temp
    }

    // Barometric pressure trend (worth up to 15 points)
    if (pressureTrend === 'falling') {
      score += 15;
      triggers.push('Falling barometer');
    } else if (pressureTrend === 'steady') {
      score += 10;
      triggers.push('Steady pressure');
    } else if (pressureTrend === 'sharp_rise') {
      score -= 15; // Penalty
    }

    // Weather conditions (penalties)
    const precipProb = hourData.precipProb || 0;
    const windSpeed = hourData.windSpeed || 0;
    
    if (precipProb > 70) {
      score -= 10;
    }
    if (windSpeed > 20) {
      score -= 10;
    }

    // Normalize score to 0-100
    score = Math.max(0, Math.min(100, score));

    // Get tide coefficient for this specific window (not daily average!)
    // analyzeTideForWindow now returns both score and the relevant tide coefficient
    const { tideScore, tideCoeff } = this.analyzeTideForWindow(centerTs, allTideEvents, triggers);
    score += tideScore;

    return {
      startTime: new Date(startTs),
      endTime: new Date(endTs),
      triggers,
      score,
      tideCoeff
    };
  }

  /**
   * Analyze tide for a specific window
   * Returns both tide score and the coefficient of the relevant tide event
   * Uses SHOM methodology: each tide event has its own coefficient
   */
  private static analyzeTideForWindow(centerTs: number, allTideEvents: any[], triggers: string[]): { tideScore: number; tideCoeff: number | null } {
    let tideScore = 0;
    let tideCoeff: number | null = null;

    if (!allTideEvents || allTideEvents.length === 0) {
      return { tideScore: 0, tideCoeff: null };
    }

    // Find tide state at this time
    let prevTide = null;
    let nextTide = null;
    
    for (let i = 0; i < allTideEvents.length - 1; i++) {
      const tideTs = new Date(allTideEvents[i].time).getTime();
      const nextTideTs = new Date(allTideEvents[i + 1].time).getTime();
      
      if (centerTs >= tideTs && centerTs <= nextTideTs) {
        prevTide = allTideEvents[i];
        nextTide = allTideEvents[i + 1];
        break;
      }
    }

    if (prevTide && nextTide) {
      // SHOM methodology: use the specific tide event's coefficient
      // For flood (low→high): use the high tide coefficient (the tide we're moving toward)
      // For ebb (high→low): use the low tide coefficient (the tide we're moving toward)
      const isFlood = prevTide.type === 'low' && nextTide.type === 'high';
      
      if (isFlood) {
        // Flood (low → high): use the HIGH tide coefficient we're moving toward
        tideCoeff = nextTide.coefficient ?? null;
        tideScore += 15;
        
        // First third of flood is best
        const tideStart = new Date(prevTide.time).getTime();
        const tideEnd = new Date(nextTide.time).getTime();
        const tideDuration = tideEnd - tideStart;
        const timeIntoTide = centerTs - tideStart;
        const percentIntoTide = timeIntoTide / tideDuration;
        
        if (percentIntoTide < 0.33) {
          tideScore += 10;
          triggers.push('First 3rd of flood tide');
        } else {
          triggers.push('Flood tide');
        }
      } else {
        // Ebb (high → low): use the LOW tide coefficient we're moving toward
        tideCoeff = nextTide.coefficient ?? null;
        tideScore += 5;
        triggers.push('Ebb tide');
      }

      // Tide coefficient bonus (use the specific tide coefficient)
      if (tideCoeff && tideCoeff >= 95) {
        tideScore += 10;
        triggers.push(`Strong tide (${tideCoeff})`);
      } else if (tideCoeff && tideCoeff >= 70) {
        tideScore += 5;
      }
    } else {
      // Fallback: if we can't find bracketing tides, use the nearest tide event
      let nearestTide = null;
      let minDist = Infinity;
      for (const tide of allTideEvents) {
        const dist = Math.abs(new Date(tide.time).getTime() - centerTs);
        if (dist < minDist) {
          minDist = dist;
          nearestTide = tide;
        }
      }
      
      if (nearestTide && nearestTide.coefficient) {
        tideCoeff = nearestTide.coefficient;
        // Reduced score since we don't have proper tide phase context
        tideScore += 5;
      }
    }

    return { tideScore, tideCoeff };
  }

  /**
   * Calculate temperature trend (clamped to realistic fishing-relevant values)
   */
  private static calculateTempTrend(weatherDay: any, previousDayWeather: any): number {
    if (!previousDayWeather) return 0;
    
    // Compare average air temps (water temp changes much slower, but air affects fishing comfort)
    const currentAvg = weatherDay.hours.reduce((sum: number, h: any) => sum + (h.temp || 0), 0) / weatherDay.hours.length;
    const previousAvg = previousDayWeather.hours.reduce((sum: number, h: any) => sum + (h.temp || 0), 0) / previousDayWeather.hours.length;
    
    const rawChange = currentAvg - previousAvg;
    
    // Clamp to realistic daily fishing-relevant range (±5°F max)
    // Water temp changes are much smaller, but air temp affects fishing conditions
    return Math.max(-5, Math.min(5, rawChange));
  }

  /**
   * Calculate barometric pressure trend
   */
  private static calculatePressureTrend(weatherDay: any): string {
    const hours = weatherDay.hours.filter((h: any) => h.pressure);
    if (hours.length < 3) return 'steady';

    const firstHalf = hours.slice(0, Math.floor(hours.length / 2));
    const secondHalf = hours.slice(Math.floor(hours.length / 2));
    
    const firstAvg = firstHalf.reduce((sum: number, h: any) => sum + h.pressure, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum: number, h: any) => sum + h.pressure, 0) / secondHalf.length;
    
    const change = secondAvg - firstAvg;
    
    if (change < -2) return 'sharp_fall';
    if (change < -0.5) return 'falling';
    if (change > 2) return 'sharp_rise';
    if (change > 0.5) return 'rising';
    return 'steady';
  }

  /**
   * Calculate overall day score
   */
  private static calculateDayScore(params: {
    topWindows: FishingWindow[];
    tideDay: any;
    tempTrend: number;
    pressureTrend: string;
    weatherDay: any;
  }): number {
    const { topWindows, tideDay, tempTrend, pressureTrend, weatherDay } = params;
    
    if (topWindows.length === 0) return 0;

    // Sort windows by score (best first) to ensure highest quality gets most weight
    // This prevents misleading ratings where a 4-star afternoon window gets lower weight than a 3-star morning window
    const sortedWindows = [...topWindows].sort((a, b) => b.score - a.score);

    // Weight best windows more heavily (70/20/10 instead of 50/30/20)
    // Fishermen plan trips around the BEST window, so day rating should reflect peak opportunity
    let score = 0;
    if (sortedWindows[0]) score += sortedWindows[0].score * 0.7;
    if (sortedWindows[1]) score += sortedWindows[1].score * 0.2;
    if (sortedWindows[2]) score += sortedWindows[2].score * 0.1;

    // Bonus for very strong tides
    if (tideDay && tideDay.avgCoefficient >= 100) {
      score += 5;
    }

    // Bonus for ideal conditions
    if (tempTrend >= 2 && tempTrend <= 4 && pressureTrend === 'falling') {
      score += 10;
    }

    return Math.min(100, score);
  }

  /**
   * Convert score to star rating
   */
  private static scoreToStars(score: number): number {
    if (score >= 85) return 5;
    if (score >= 70) return 4;
    if (score >= 55) return 3;
    if (score >= 40) return 2;
    return 1;
  }

  /**
   * Get average weather for the day
   */
  private static getAverageWeather(weatherDay: any, pressureTrend: string) {
    const hours = weatherDay.hours;
    const avgTemp = hours.reduce((sum: number, h: any) => sum + (h.temp || 0), 0) / hours.length;
    const minTemp = Math.min(...hours.map((h: any) => h.temp || 0));
    const maxTemp = Math.max(...hours.map((h: any) => h.temp || 0));
    const avgWind = hours.reduce((sum: number, h: any) => sum + (h.windSpeed || 0), 0) / hours.length;
    const avgClouds = hours.reduce((sum: number, h: any) => sum + (h.cloudCover || 0), 0) / hours.length;
    const maxPrecip = Math.max(...hours.map((h: any) => h.precipProb || 0));
    
    // Calculate circular average for wind direction - only if we have valid data
    const windDirs = hours.filter((h: any) => h.windDir !== undefined && h.windDir !== null).map((h: any) => h.windDir);
    let avgWindDir: number | undefined = undefined;
    if (windDirs.length > 0) {
      // Convert to radians, average sin/cos, convert back
      const avgSin = windDirs.reduce((sum: number, dir: number) => sum + Math.sin(dir * Math.PI / 180), 0) / windDirs.length;
      const avgCos = windDirs.reduce((sum: number, dir: number) => sum + Math.cos(dir * Math.PI / 180), 0) / windDirs.length;
      let windDirDeg = Math.atan2(avgSin, avgCos) * 180 / Math.PI;
      if (windDirDeg < 0) windDirDeg += 360;
      avgWindDir = Math.round(windDirDeg);
    }

    return {
      temp: Math.round(avgTemp),
      tempMin: Math.round(minTemp),
      tempMax: Math.round(maxTemp),
      windSpeed: Math.round(avgWind),
      windDir: avgWindDir,
      clouds: Math.round(avgClouds),
      precip: Math.round(maxPrecip),
      pressureTrend
    };
  }

  /**
   * Generate expert fishing note
   */
  private static generateExpertNote(params: {
    tempTrend: number;
    pressureTrend: string;
    tideDay: any;
    weatherDay: any;
    moonDay: any;
  }): string {
    const { tempTrend, pressureTrend, tideDay, moonDay } = params;
    const notes: string[] = [];

    // Temperature trend
    if (tempTrend >= 2 && tempTrend <= 4) {
      notes.push('Warming trend + falling barometer = red-hot bite expected');
    } else if (tempTrend > 4) {
      notes.push('Rapid warming may increase activity');
    } else if (tempTrend < -3) {
      notes.push('Cooling temps slow the bite');
    }

    // Pressure trend
    if (pressureTrend === 'falling' && notes.length === 0) {
      notes.push('Falling barometer = aggressive feeding');
    } else if (pressureTrend === 'sharp_rise') {
      notes.push('Sharp pressure rise after front = tough bite');
    } else if (pressureTrend === 'sharp_fall') {
      notes.push('Sharp pressure drop = feeding frenzy incoming');
    }

    // Tide strength
    if (tideDay && tideDay.avgCoefficient >= 108) {
      notes.push('Very strong tides = excellent current flow');
    } else if (tideDay && tideDay.avgCoefficient < 50) {
      notes.push('Weak tides = focus on structure');
    }

    // Moon phase bonus
    const phase = moonDay.phase;
    if (phase === 'New Moon' || phase === 'Full Moon') {
      notes.push('Peak moon phase amplifies bite windows');
    }

    // Default
    if (notes.length === 0) {
      notes.push('Solid conditions for consistent action');
    }

    return notes[0];
  }
}
