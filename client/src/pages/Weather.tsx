import { 
  Cloud, 
  CloudRain, 
  CloudLightning, 
  Sun, 
  Droplets, 
  Wind,
  Thermometer,
  Search,
  Loader2,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  MapPin,
  ChevronRight,
  ArrowRight,
  Gauge,
  Lock,
  Crown,
  Star,
  X,
  Fish
} from "lucide-react";
import { 
  Area, 
  AreaChart, 
  Bar, 
  BarChart, 
  CartesianGrid, 
  ResponsiveContainer, 
  Tooltip, 
  XAxis, 
  YAxis, 
  ComposedChart,
  LineChart,
  ReferenceLine,
  ReferenceArea,
  ReferenceDot,
  Cell,
  Scatter,
  Line,
  Label
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RadarMap } from "@/components/RadarMap";
import { AppHeader } from "@/components/AppHeader";
import { WelcomeTour, type WelcomeTourRef } from "@/components/WelcomeTour";
import { Footer } from "@/components/Footer";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import { UpgradeDialog } from "@/components/UpgradeDialog";
import { FreePreviewBanner } from "@/components/FreePreviewBanner";
import { PrecipitationDetailModal } from "@/components/PrecipitationDetailModal";
import { BiteWeatherModal } from "@/components/BiteWeatherModal";
import { useLocation } from "wouter";
import { DateTime } from "luxon";

import { type Location } from "@shared/schema";

// --- Types ---
type HourlyForecast = {
  time: string;
  datetime: string; // ISO datetime for sorting
  precipProb: number; // %
  precipAmount: number; // inches
  temp: number; // F
  icon: "sun" | "cloud" | "rain" | "storm";
  humidity?: number;   // %
  pressure?: number;   // mb
  windSpeed?: number;  // mph
  windGust?: number;   // mph
  windDir?: number;    // degrees
  feelsLike?: number;  // F
  cloudCover?: number; // %
  visibility?: number; // miles
  uvIndex?: number;    // 0-10
  dewPoint?: number;   // F
  tideHeight?: number; // feet
};

type MetricType = 'precip' | 'temp' | 'wind' | 'humidity' | 'dewpoint' | 'cloudcover' | 'pressure' | 'tide' | 'solunar' | 'sun';

type MoonAltitudeSample = {
  timestamp: number;
  altitude: number;
};

type FeedingPeriod = {
  type: 'major' | 'minor';
  event: 'overhead' | 'underfoot' | 'rise' | 'set';
  centerTime: string;
  centerTimestamp: number;
  startTimestamp: number;
  endTimestamp: number;
  duration: number;
};

type SolunarData = {
  date: string;
  moonAltitudes: MoonAltitudeSample[];
  feedingPeriods: FeedingPeriod[];
  moonrise: string | null;
  moonset: string | null;
  moonOverhead: string | null;
  moonUnderfoot: string | null;
};

type TideEvent = {
  time: string;        // "3:15 AM" or "9:42 PM"
  datetime?: string;   // ISO timestamp for precise positioning
  height: number;      // feet
  type: "H" | "L";     // High or Low
};

type DailyForecast = {
  day: string;
  date: number;
  fullDate: string; // Needed for key/selection
  high: number;
  low: number;
  precipProb: number;
  precipAmount: number;
  icon: "sun" | "cloud" | "rain" | "storm";
  hours: HourlyForecast[];
  tideEvents?: TideEvent[]; // High/low tide times for this day
};

type FishingWindow = {
  startTime: string;
  endTime: string;
  triggers: string[];
  score: number;
  tideCoeff: number | null;
};

type DayFishingForecast = {
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
};

type WeatherData = {
  currentTemp: number;
  location: string;
  days: DailyForecast[];
  alerts?: any[];
  latitude: number;
  longitude: number;
  timezone?: string; // IANA timezone from weather API (e.g., "America/Chicago")
  observedPrecipitation?: number; // inches - actual observed to date
  tideAvailable?: boolean;
  tideStation?: string;
  tideStationName?: string;
};

// --- Components ---

const WeatherIcon = ({ type, className = "" }: { type: string, className?: string }) => {
  switch (type) {
    case "sun": return <Sun className={`text-amber-400 ${className}`} />;
    case "cloud": return <Cloud className={`text-gray-400 ${className}`} />;
    case "rain": return <CloudRain className={`text-blue-400 ${className}`} />;
    case "storm": return <CloudLightning className={`text-purple-400 ${className}`} />;
    default: return <Sun className={`text-amber-400 ${className}`} />;
  }
};

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
}

export default function WeatherPage() {
  const isMobile = useIsMobile();
  const { isPremium, isLoading: authLoading, user, favoriteLocations, refreshUser, isAuthenticated, hasActiveSubscription, isInTrial, isTrialExpired, trialDaysRemaining } = useAuth();
  const [showFavorites, setShowFavorites] = useState(false);
  const [isSavingFavorite, setIsSavingFavorite] = useState(false);

  // Read location from URL param or localStorage
  const [location, setLocation] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const urlLocation = params.get('location');
    if (urlLocation) return decodeURIComponent(urlLocation);
    return localStorage.getItem("weather_location") || "Houston,TX";
  });

  // Sync URL param changes to location state
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlLocation = params.get('location');
    if (urlLocation) {
      setLocation(decodeURIComponent(urlLocation));
    }
  }, [window.location.search]);

  const [searchQuery, setSearchQuery] = useState(location);
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  // Sync searchQuery with location when location changes (e.g., from favorites or geolocation)
  useEffect(() => {
    setSearchQuery(location);
  }, [location]);
  
  const [isLocating, setIsLocating] = useState(false);
  const [selectedDateIndex, setSelectedDateIndex] = useState(0);
  const [biteModalOpen, setBiteModalOpen] = useState(false);
  const [selectedModalDay, setSelectedModalDay] = useState<number>(0);
  const [isAlertExpanded, setIsAlertExpanded] = useState(false);
  const [showScrollHint, setShowScrollHint] = useState(true);
  const [selectedMetrics, setSelectedMetrics] = useState<MetricType[]>(['solunar', 'temp', 'wind', 'precip']);
  const [tooltipVisible, setTooltipVisible] = useState(true);
  const [provider, setProvider] = useState<'visualcrossing' | 'openmeteo' | 'noaa'>(() => 
    (localStorage.getItem("weather_provider") as 'visualcrossing' | 'openmeteo' | 'noaa') || 'openmeteo'
  );
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [show15MinModal, setShow15MinModal] = useState(false);
  const [selected15MinDatetime, setSelected15MinDatetime] = useState<string | null>(null);
  const [selected15MinHourData, setSelected15MinHourData] = useState<{ precip: number; prob: number } | null>(null);
  
  // Scrollable chart and day cards refs
  const chartScrollRef = useRef<HTMLDivElement>(null);
  const dayCardsRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScrollRef = useRef(false);
  const tourRef = useRef<WelcomeTourRef>(null);

  // Check for upgrade query param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgrade') === 'true') {
      setShowUpgradeDialog(true);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Persist location and provider
  useEffect(() => {
    localStorage.setItem("weather_location", location);
  }, [location]);
  
  useEffect(() => {
    localStorage.setItem("weather_provider", provider);
  }, [provider]);

  const debouncedSearch = useDebounce(searchQuery, 300);

  const { data: suggestions } = useQuery({
    queryKey: ['search', debouncedSearch],
    queryFn: async () => {
      if (debouncedSearch.length < 2) return [];
      const res = await fetch(`/api/search?q=${encodeURIComponent(debouncedSearch)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: debouncedSearch.length >= 2
  });

  const { data: weatherData, isLoading, isFetching: isWeatherFetching, error } = useQuery<WeatherData>({
    queryKey: ['weather', location, provider],
    queryFn: async () => {
      const res = await fetch(`/api/weather?q=${encodeURIComponent(location)}&provider=${provider}`);
      if (!res.ok) throw new Error('Failed to fetch weather');
      return res.json();
    },
    // Keep previous data visible while fetching new data (prevents full page reload and blank screen)
    placeholderData: (previousData) => previousData,
    // Note: uses global defaults (staleTime: Infinity, gcTime: Infinity) to keep data cached indefinitely
  });

  // Fetch tide data from the same API as the Tides page when tide metric is selected
  const hasTideSelected = selectedMetrics.includes('tide');
  const { data: tideData } = useQuery({
    queryKey: ['tides-weather', location],
    queryFn: async () => {
      const res = await fetch(`/api/tides?location=${encodeURIComponent(location)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: hasTideSelected,
    placeholderData: (previousData) => previousData,
    // Note: uses global defaults for infinite cache
  });

  // Fetch fishing forecast data for daily cards
  const { data: fishingForecastData } = useQuery<{ forecast: DayFishingForecast[] }>({
    queryKey: ['fishingForecast', 'v3-daytime-only', location, provider],
    queryFn: async () => {
      const timestamp = Date.now();
      const url = `/api/forecast/fishing?location=${encodeURIComponent(location)}&provider=${provider}&_t=${timestamp}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) return { forecast: [] };
      return response.json();
    },
    enabled: !!location,
    placeholderData: (previousData) => previousData,
  });

  // Removed auto-expand - user must manually open bite forecast
  
  // Disabled: Auto-sync fishing forecast panel with selected day when scrolling
  // This was causing annoying page shifts while users tried to look at the chart
  // useEffect(() => {
  //   if (selectedDateIndex !== null && expandedFishingDay !== null) {
  //     setExpandedFishingDay(selectedDateIndex);
  //   }
  // }, [selectedDateIndex]);

  // Fetch moon phase data when tide, solunar, or sun is selected
  // Include lat/lon for solunar calculations (moon overhead/underfoot times)
  const hasSolunarSelected = selectedMetrics.includes('solunar');
  const hasSunSelected = selectedMetrics.includes('sun');
  const { data: moonResponse } = useQuery({
    queryKey: ['moon', weatherData?.location, weatherData?.latitude, weatherData?.longitude],
    queryFn: async () => {
      // Use weatherData.location (not URL location) to ensure location and coordinates match
      const locationName = weatherData?.location!;
      const lat = weatherData?.latitude!;
      const lon = weatherData?.longitude!;
      const res = await fetch(`/api/moon-phases?location=${encodeURIComponent(locationName)}&lat=${lat}&lon=${lon}`, {
        // Disable browser cache to ensure fresh data for each location
        cache: 'no-cache'
      });
      if (!res.ok) return null;
      return res.json();
    },
    // Only enable after weather data has FINISHED loading for current location with valid coordinates
    // This prevents cache poisoning from using old coordinates with new location name
    enabled: (hasTideSelected || hasSolunarSelected || hasSunSelected) && 
             !isWeatherFetching &&
             !!weatherData && 
             weatherData.location !== undefined &&
             weatherData.latitude !== undefined && 
             weatherData.longitude !== undefined,
    // Don't use placeholder data - show loading state instead to avoid stale timezone
    staleTime: 0,
  });
  
  // Extract moon data and timezone from response
  const moonData = moonResponse?.phases || moonResponse; // Support both old and new format
  const moonTimezone = moonResponse?.timezone || weatherData?.timezone || 'UTC';

  // Fetch solunar data for moon altitude curve and feeding periods
  const { data: solunarData } = useQuery<SolunarData[]>({
    queryKey: ['solunar', weatherData?.location, weatherData?.latitude, weatherData?.longitude],
    queryFn: async () => {
      // Use weatherData.location to ensure location and coordinates match
      const locationName = weatherData?.location || location;
      const lat = weatherData?.latitude || 0;
      const lon = weatherData?.longitude || 0;
      const res = await fetch(`/api/solunar?location=${encodeURIComponent(locationName)}&lat=${lat}&lon=${lon}&days=15`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: hasSolunarSelected && !!weatherData,
    placeholderData: (previousData) => previousData,
  });

  // Apply freemium restriction: limit to 5 days for free users
  const displayDays = isPremium ? weatherData?.days : weatherData?.days?.slice(0, 5);
  
  // Memoize best fishing windows for ALL days to highlight on chart
  // Filter to only show windows during daylight hours (sunrise to sunset)
  const bestFishingWindows = useMemo(() => {
    if (!fishingForecastData?.forecast || !moonData || !Array.isArray(moonData)) return [];
    
    // Collect all windows from all days in the fishing forecast
    const allWindows: any[] = [];
    fishingForecastData.forecast.forEach(day => {
      if (day.windows && day.windows.length > 0) {
        // Find sunrise/sunset for this day from moonData
        const dayDate = new Date(day.date);
        const moonDay = moonData.find((m: any) => 
          new Date(m.date).toDateString() === dayDate.toDateString()
        );
        
        if (!moonDay || !moonDay.sunrise || !moonDay.sunset) {
          // Skip this day if we don't have sunrise/sunset data
          return;
        }
        
        // Parse sunrise/sunset in the location's timezone
        const dateStr = day.date.split('T')[0];
        const sunriseDt = DateTime.fromISO(`${dateStr}T${moonDay.sunrise}`, { zone: moonTimezone });
        const sunsetDt = DateTime.fromISO(`${dateStr}T${moonDay.sunset}`, { zone: moonTimezone });
        const sunriseTs = sunriseDt.toMillis();
        const sunsetTs = sunsetDt.toMillis();
        
        day.windows.forEach(window => {
          // Parse window times in UTC (as returned from API)
          const windowStart = DateTime.fromISO(window.startTime, { zone: 'utc' }).toMillis();
          const windowEnd = DateTime.fromISO(window.endTime, { zone: 'utc' }).toMillis();
          
          // Check if window overlaps with daylight hours
          if (windowEnd < sunriseTs || windowStart > sunsetTs) {
            // Window is entirely at night - skip it
            return;
          }
          
          // Clamp window to daylight hours
          const clampedStart = Math.max(windowStart, sunriseTs);
          const clampedEnd = Math.min(windowEnd, sunsetTs);
          
          // Convert back to ISO strings for the chart
          const clampedStartISO = DateTime.fromMillis(clampedStart, { zone: 'utc' }).toISO();
          const clampedEndISO = DateTime.fromMillis(clampedEnd, { zone: 'utc' }).toISO();
          
          allWindows.push({
            startTime: clampedStartISO,
            endTime: clampedEndISO,
            score: window.score,
            triggers: window.triggers,
            date: day.date
          });
        });
      }
    });
    
    console.log('[BestWindows] Collected', allWindows.length, 'daylight fishing windows from', fishingForecastData.forecast.length, 'days');
    console.log('[BestWindows] Windows:', allWindows.map(w => ({
      date: w.date,
      start: w.startTime,
      end: w.endTime,
      triggers: w.triggers
    })));
    
    return allWindows;
  }, [fishingForecastData, moonData, moonTimezone]);
  
  // Memoize tidal coefficient chart data for performance
  const tideCoeffChartData = useMemo(() => {
    if (!tideData?.forecast) return [];
    return tideData.forecast.map((day: any) => {
      const date = new Date(day.date);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      const coefficient = day.avgCoefficient || 0;
      const minCoeff = day.minCoefficient || coefficient;
      const maxCoeff = day.maxCoefficient || coefficient;
      const displayCoeff = minCoeff !== maxCoeff ? `${minCoeff}-${maxCoeff}` : String(coefficient);
      return {
        day: dayName,
        coefficient,
        displayCoeff,
        fill: 
          coefficient >= 95 ? '#22c55e' :
          coefficient >= 70 ? '#84cc16' :
          coefficient >= 55 ? '#eab308' :
          '#f97316'
      };
    });
  }, [tideData]);
  
  // Memoize day boundaries (hour indices) accounting for truncated first day
  const dayBoundaries = useMemo(() => {
    if (!displayDays || displayDays.length === 0) return [];
    
    const now = new Date();
    const currentHour = now.getHours();
    const firstDayHours = 24 - currentHour;
    
    const boundaries: { dayIndex: number; startHour: number; endHour: number }[] = [];
    let cumulativeHours = 0;
    
    // First day (truncated)
    boundaries.push({
      dayIndex: 0,
      startHour: 0,
      endHour: firstDayHours
    });
    cumulativeHours += firstDayHours;
    
    // Subsequent days (full 24-hour days)
    for (let i = 1; i < displayDays.length; i++) {
      boundaries.push({
        dayIndex: i,
        startHour: cumulativeHours,
        endHour: cumulativeHours + 24
      });
      cumulativeHours += 24;
    }
    
    return boundaries;
  }, [displayDays]);
  
  // Handle chart scroll to sync day selector and fishing forecast panel
  const handleChartScroll = useCallback(() => {
    // Skip if this is a programmatic scroll (prevent feedback loop)
    if (isProgrammaticScrollRef.current) return;
    
    if (!chartScrollRef.current || !displayDays || dayBoundaries.length === 0) return;
    
    const scrollContainer = chartScrollRef.current;
    const scrollLeft = scrollContainer.scrollLeft;
    const containerWidth = scrollContainer.clientWidth;
    const scrollWidth = scrollContainer.scrollWidth;
    
    // Calculate viewport center position as a fraction of total scroll width
    const viewportCenter = scrollLeft + containerWidth / 2;
    const centerFraction = viewportCenter / scrollWidth;
    
    // Total hours in chart
    const totalHours = dayBoundaries[dayBoundaries.length - 1].endHour;
    
    // Translate center fraction to hour index
    const centerHourIndex = centerFraction * totalHours;
    
    // Find which day this hour belongs to
    let detectedDayIndex = 0;
    for (const boundary of dayBoundaries) {
      if (centerHourIndex >= boundary.startHour && centerHourIndex < boundary.endHour) {
        detectedDayIndex = boundary.dayIndex;
        break;
      }
    }
    
    // Update selected day if changed
    if (detectedDayIndex !== selectedDateIndex) {
      setSelectedDateIndex(detectedDayIndex);
    }
  }, [displayDays, dayBoundaries, selectedDateIndex]);
  
  // Scroll to selected day when day card is clicked
  const scrollToDay = useCallback((dayIndex: number) => {
    if (!chartScrollRef.current || !displayDays || !displayDays[dayIndex]) return;
    
    const scrollContainer = chartScrollRef.current;
    const containerWidth = scrollContainer.clientWidth;
    const scrollWidth = scrollContainer.scrollWidth;
    
    // Set flag to prevent handleChartScroll from firing during programmatic scroll
    isProgrammaticScrollRef.current = true;
    
    // Calculate actual hours shown in chart for each day
    // The first day is usually truncated (starts from current hour, not midnight)
    const now = new Date();
    const currentHour = now.getHours();
    
    // First day hours: from current hour to midnight (24 - currentHour)
    const firstDayHours = 24 - currentHour;
    
    // Total hours in the chart
    let totalHours = firstDayHours;
    for (let i = 1; i < displayDays.length; i++) {
      totalHours += 24;
    }
    
    // Calculate the start hour and span of the selected day
    let startHourOfDay = 0;
    let hoursInDay = 0;
    
    if (dayIndex === 0) {
      startHourOfDay = 0;
      hoursInDay = firstDayHours;
    } else {
      startHourOfDay = firstDayHours;
      for (let i = 1; i < dayIndex; i++) {
        startHourOfDay += 24;
      }
      hoursInDay = 24;
    }
    
    // Calculate the center hour of the selected day
    const centerHourOfDay = startHourOfDay + (hoursInDay / 2);
    
    // Convert center hour to pixel position
    const hourWidth = scrollWidth / totalHours;
    const centerPixel = centerHourOfDay * hourWidth;
    
    // Calculate scroll position to center this day in the viewport
    const targetScroll = centerPixel - (containerWidth / 2);
    
    // Clamp to prevent overscroll
    const maxScroll = scrollWidth - containerWidth;
    const clampedOffset = Math.max(0, Math.min(targetScroll, maxScroll));
    
    scrollContainer.scrollTo({ left: clampedOffset, behavior: 'smooth' });
    setSelectedDateIndex(dayIndex);
    
    // Clear flag after scroll animation completes
    setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 1000);
  }, [displayDays]);

  // Helper to toggle metric selection with freemium restriction
  const toggleMetric = (metric: MetricType) => {
    setSelectedMetrics(prev => {
      if (prev.includes(metric)) {
        // Remove this metric
        const filtered = prev.filter(m => m !== metric);
        // If all metrics are removed, default back to precip
        return filtered.length === 0 ? ['precip'] : filtered;
      } else {
        // Free users can select different metrics, just not more than one at a time
        if (!isPremium) {
          // Replace current selection with new metric (only one metric allowed)
          return [metric];
        }
        // Premium users can add multiple metrics
        return [...prev, metric];
      }
    });
  };

  // Helper to clear all metrics back to precip
  const clearAllMetrics = () => {
    setSelectedMetrics(['precip']);
  };

  // Normalize metrics when premium status changes (always reset to precip for free users)
  useEffect(() => {
    if (!isPremium) {
      setSelectedMetrics(['precip']);
    }
  }, [isPremium]);

  // Check if current location is a favorite
  const isCurrentLocationFavorite = favoriteLocations.includes(location);

  // Add location to favorites
  const addToFavorites = async (loc?: string) => {
    if (!isAuthenticated) {
      window.location.href = '/login';
      return;
    }
    setIsSavingFavorite(true);
    try {
      await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationQuery: loc || location }),
      });
      refreshUser();
    } catch (error) {
      console.error('Failed to add favorite:', error);
    } finally {
      setIsSavingFavorite(false);
    }
  };

  // Remove location from favorites
  const removeFromFavorites = async (loc: string) => {
    if (!isAuthenticated) {
      window.location.href = '/login';
      return;
    }
    setIsSavingFavorite(true);
    try {
      await fetch(`/api/favorites/${encodeURIComponent(loc)}`, {
        method: 'DELETE',
      });
      refreshUser();
    } catch (error) {
      console.error('Failed to remove favorite:', error);
    } finally {
      setIsSavingFavorite(false);
    }
  };

  // Toggle current location as favorite
  const toggleFavorite = () => {
    if (isCurrentLocationFavorite) {
      removeFromFavorites(location);
    } else {
      addToFavorites();
    }
  };

  // Helper to convert wind direction degrees to compass
  const degToCompass = (deg: number) => {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(deg / 22.5) % 16;
    return directions[index];
  };

  // Helper to format pressure trend
  const formatPressureTrend = (trend: string) => {
    const trends: { [key: string]: { label: string; icon: string } } = {
      'sharp_fall': { label: 'Falling rapidly', icon: '↓↓' },
      'falling': { label: 'Falling', icon: '↓' },
      'steady': { label: 'Steady', icon: '→' },
      'rising': { label: 'Rising', icon: '↑' },
      'sharp_rise': { label: 'Rising rapidly', icon: '↑↑' }
    };
    return trends[trend] || { label: 'Steady', icon: '→' };
  };

  // Helper to format time from timestamp
  const formatTime = (timestamp: number | null, timezone: string = 'UTC'): string => {
    if (!timestamp) return '';
    return DateTime.fromMillis(timestamp).setZone(timezone).toFormat('h:mm a');
  };

  // Helper to convert mb to inHg
  const mbToInhg = (mb: number): number => {
    return mb * 0.02953;
  };

  // Helper to determine pressure trend
  const getPressureTrend = (currentPressure: number, todayHours: HourlyForecast[]): 'rising' | 'falling' | 'steady' => {
    if (todayHours.length < 2) return 'steady';
    
    const now = new Date();
    const currentHour = now.getHours();
    const previousHourData = todayHours.find(h => {
      const hourTime = new Date(h.datetime).getHours();
      return hourTime === currentHour - 1;
    });
    
    if (!previousHourData || !previousHourData.pressure) return 'steady';
    
    const diff = currentPressure - previousHourData.pressure;
    if (diff > 1) return 'rising';
    if (diff < -1) return 'falling';
    return 'steady';
  };

  // Helper to normalize metric values to 0-100 scale for display
  const getNormalizedValue = (value: number, metric: MetricType): number => {
    const ranges = {
      precip: { min: 0, max: 100 },
      temp: { min: 0, max: 110 },
      wind: { min: 0, max: 40 },
      humidity: { min: 0, max: 100 },
      dewpoint: { min: 0, max: 100 },
      cloudcover: { min: 0, max: 100 },
      pressure: { min: 950, max: 1050 },
      tide: { min: -2, max: 6 },
      moon: { min: 0, max: 100 },
      solunar: { min: 0, max: 100 },
      sun: { min: 0, max: 100 }
    };
    
    const range = ranges[metric];
    return ((value - range.min) / (range.max - range.min)) * 100;
  };

  // Helper to get metric configuration
  const getMetricConfig = (metric: MetricType) => {
    const configs = {
      precip: {
        leftKey: 'precipProb',
        rightKey: 'precipAmount',
        leftLabel: 'Rain Chance',
        rightLabel: 'Rain Amount (this hr)',
        leftUnit: '%',
        rightUnit: '"',
        leftDomain: [0, 100] as [number, number],
        rightDomain: [0, (max: number) => Math.max(max, 1)] as any,
        leftColor: '#60a5fa',
        rightColor: '#22d3ee'
      },
      temp: {
        leftKey: 'temp',
        rightKey: null,
        leftLabel: 'Temperature',
        rightLabel: '',
        leftUnit: '°',
        rightUnit: '',
        leftDomain: [(min: number) => Math.floor(min - 5), (max: number) => Math.ceil(max + 5)] as any,
        rightDomain: [0, 1] as [number, number],
        leftColor: '#f97316',
        rightColor: '#f97316'
      },
      wind: {
        leftKey: 'windSpeed',
        rightKey: 'windGust',
        leftLabel: 'Wind Speed',
        rightLabel: 'Gusts',
        leftUnit: ' mph',
        rightUnit: ' mph',
        leftDomain: [0, (max: number) => Math.ceil(Math.max(max * 1.3, 10))] as any,
        rightDomain: [0, (max: number) => Math.ceil(Math.max(max * 1.3, 10))] as any,
        leftColor: '#34d399',
        rightColor: '#e2e8f0'
      },
      humidity: {
        leftKey: 'humidity',
        rightKey: null,
        leftLabel: 'Humidity',
        rightLabel: '',
        leftUnit: '%',
        rightUnit: '',
        leftDomain: [0, 100] as [number, number],
        rightDomain: [0, 1] as [number, number],
        leftColor: '#ec4899',
        rightColor: '#ec4899'
      },
      dewpoint: {
        leftKey: 'dewPoint',
        rightKey: null,
        leftLabel: 'Dew Point',
        rightLabel: '',
        leftUnit: '°',
        rightUnit: '',
        leftDomain: [(min: number) => Math.floor(min - 5), (max: number) => Math.ceil(max + 5)] as any,
        rightDomain: [0, 1] as [number, number],
        leftColor: '#facc15',
        rightColor: '#facc15'
      },
      cloudcover: {
        leftKey: 'cloudCover',
        rightKey: null,
        leftLabel: 'Cloud Cover',
        rightLabel: '',
        leftUnit: '%',
        rightUnit: '',
        leftDomain: [0, 100] as [number, number],
        rightDomain: [0, 1] as [number, number],
        leftColor: '#94a3b8',
        rightColor: '#94a3b8'
      },
      pressure: {
        leftKey: 'pressure',
        rightKey: null,
        leftLabel: 'Pressure',
        rightLabel: '',
        leftUnit: ' in',
        rightUnit: '',
        leftDomain: [980, 1040] as [number, number], // Tighter range to show changes more clearly
        rightDomain: [0, 1] as [number, number],
        leftColor: '#a78bfa',
        rightColor: '#a78bfa'
      },
      tide: {
        leftKey: 'tideHeight',
        rightKey: null,
        leftLabel: 'Tide Height',
        rightLabel: '',
        leftUnit: ' ft',
        rightUnit: '',
        leftDomain: [-2, 6] as [number, number],
        rightDomain: [0, 1] as [number, number],
        leftColor: '#0ea5e9',
        rightColor: '#0ea5e9'
      },
      solunar: {
        leftKey: 'moonAltitude',
        rightKey: null,
        leftLabel: 'Moon Altitude',
        rightLabel: '',
        leftUnit: '%',
        rightUnit: '',
        leftDomain: [0, 100] as [number, number],
        rightDomain: [0, 1] as [number, number],
        leftColor: '#a855f7',
        rightColor: '#a855f7'
      },
      sun: {
        leftKey: null,
        rightKey: null,
        leftLabel: 'Sunrise/Sunset',
        rightLabel: '',
        leftUnit: '',
        rightUnit: '',
        leftDomain: [0, 1] as [number, number],
        rightDomain: [0, 1] as [number, number],
        leftColor: '#f59e0b',
        rightColor: '#f59e0b'
      }
    };
    return configs[metric];
  };

  // Helper to get fishing forecast for a specific day
  const getFishingForecastForDay = (fullDate: string): DayFishingForecast | null => {
    if (!fishingForecastData?.forecast) return null;
    const dateOnly = fullDate.split('T')[0];
    return fishingForecastData.forecast.find(f => f.date.startsWith(dateOnly)) || null;
  };

  // Helper to render star rating
  const renderStarRating = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Star
        key={i}
        className={`w-3 h-3 ${i < rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600'}`}
      />
    ));
  };

  // Convert score (0-100) to star rating (1-5)
  const scoreToStars = (score: number): number => {
    if (score >= 85) return 5;
    if (score >= 70) return 4;
    if (score >= 50) return 3;
    if (score >= 30) return 2;
    return 1;
  };

  // Helper to generate dynamic daily summary
  const generateDaySummary = (day: DailyForecast) => {
    if (!day) return "Loading weather data...";

    let precipDesc = "";
    let skyDesc = "";

    // Precipitation logic
    if (day.precipProb >= 60) {
      if (day.precipAmount > 1.0) precipDesc = "Expect heavy downpours";
      else if (day.precipAmount > 0.5) precipDesc = "Expect rain";
      else if (day.precipAmount > 0.1) precipDesc = "Expect light rain";
      else precipDesc = "Expect drizzle";
    } else if (day.precipProb >= 30) {
      precipDesc = "Chance of rain";
    }

    // Sky condition fallback
    if (!precipDesc) {
      if (day.icon === 'sun') skyDesc = "Mostly sunny skies";
      else if (day.icon === 'cloud') skyDesc = "Cloudy skies";
      else if (day.icon === 'storm') skyDesc = "Storms possible";
      else if (day.icon === 'rain') skyDesc = "Rain possible";
      else skyDesc = "Partly cloudy skies";
    }

    const mainDesc = precipDesc || skyDesc;
    return `${mainDesc} with a high of ${day.high}° and low of ${day.low}°.`;
  };

  // Reset selection when location changes or data updates
  useEffect(() => {
    if (displayDays && selectedDateIndex >= displayDays.length) {
      setSelectedDateIndex(0);
    }
  }, [weatherData, selectedDateIndex]);
  
  // Recalculate scroll position on window resize (important for mobile orientation changes)
  useEffect(() => {
    const handleResize = () => {
      // Re-center on the currently selected day after layout changes
      // This maintains the correct day selection when viewport width changes
      if (chartScrollRef.current && displayDays && selectedDateIndex >= 0) {
        scrollToDay(selectedDateIndex);
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [scrollToDay, displayDays, selectedDateIndex]);
  
  // DISABLED: Auto-scroll to current time on page load
  // User feedback: This causes confusing jumps to future days on load/reload
  // Default behavior now: always start at day 0 (today) with chart at left edge
  // Users can manually scroll to see current time if desired
  const hasAutoScrolledRef = useRef(false);
  
  useEffect(() => {
    // Reset auto-scroll flag when location changes
    hasAutoScrolledRef.current = false;
  }, [location]);
  
  // Removed auto-scroll logic - chart now defaults to left edge (current date/time)
  
  const [recentSearches, setRecentSearches] = useState<Location[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem("recent_searches");
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem("recent_searches", JSON.stringify(recentSearches));
    }
  }, [recentSearches]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setLocation(searchQuery);
      const newLocation = {
        id: Date.now(), // Simple client-side ID
        name: searchQuery,
        query: searchQuery,
        lat: 0,
        lon: 0,
        isFavorite: false
      };
      setRecentSearches(prev => {
        // Deduplicate
        const map = new Map(prev.map(item => [item.name, item]));
        map.delete(newLocation.name); // Remove if exists (to add to top)
        return [newLocation, ...Array.from(map.values())].slice(0, 10);
      });
      setShowSuggestions(false);
    }
  };

  const handleSuggestionClick = (suggestion: any) => {
    const query = `${suggestion.name}, ${suggestion.region}`;
    setSearchQuery(query);
    setLocation(query);
    
    const newLocation = {
      id: Date.now(),
      name: query,
      query: query,
      lat: 0,
      lon: 0,
      isFavorite: false
    };
    setRecentSearches(prev => {
        const map = new Map(prev.map(item => [item.name, item]));
        map.delete(newLocation.name);
        return [newLocation, ...Array.from(map.values())].slice(0, 10);
    });
    
    setShowSuggestions(false);
  };

  const handleLocateMe = async () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }

    setIsLocating(true);

    // iOS PWA Fix: Use race condition to detect when permission prompt doesn't show
    const GEOLOCATION_TIMEOUT = 8000; // 8 seconds
    const DETECTION_BUFFER = 2000; // 2 seconds extra
    
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('IOS_PERMISSION_TIMEOUT'));
        }, GEOLOCATION_TIMEOUT + DETECTION_BUFFER);
      });

      const geoPromise = new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (position) => resolve(position),
          (error) => reject(error),
          { 
            timeout: GEOLOCATION_TIMEOUT,
            enableHighAccuracy: true,
            maximumAge: 0
          }
        );
      });

      const position = await Promise.race([geoPromise, timeoutPromise]);
      
      // Successfully got location - now fetch the address
      const { latitude, longitude } = position.coords;
      const res = await fetch(`/api/geolocate?lat=${latitude}&lon=${longitude}`);
      if (!res.ok) throw new Error("Failed to geolocate");
      
      const data: { location?: string } = await res.json();
      if (data.location) {
        setLocation(data.location);
        setSearchQuery(data.location);
        
        // Add to recent searches
        const newLocation = {
          id: Date.now(),
          name: data.location,
          query: data.location,
          lat: 0,
          lon: 0,
          isFavorite: false
        };
        setRecentSearches(prev => {
          const map = new Map(prev.map(item => [item.name, item]));
          map.delete(newLocation.name);
          return [newLocation, ...Array.from(map.values())].slice(0, 10);
        });
      }
    } catch (error: any) {
      console.error(error);
      
      let errorMessage = "Unable to retrieve your location";
      
      if (error.message === 'IOS_PERMISSION_TIMEOUT') {
        // iOS PWA permission issue
        errorMessage = "Location access is not enabled. On iOS, please:\n\n1. Open Settings\n2. Go to Safari → Location Services\n3. Enable 'While Using the App' or 'Allow'\n\nThen reopen this app and try again.";
      } else if (error.code === 1) {
        // Permission denied
        errorMessage = "Location permission denied. Please enable location access in your browser or device settings.";
      } else if (error.code === 2) {
        // Position unavailable
        errorMessage = "Location information is unavailable. Please check your device's location services.";
      } else if (error.code === 3) {
        // Timeout
        errorMessage = "Location request timed out. Please try again.";
      } else if (error.message?.includes('Failed to geolocate') || error.message?.includes('fetch')) {
        // Network or API error
        errorMessage = "Unable to find your location. Please try again.";
      }
      
      alert(errorMessage);
    } finally {
      // Always clear the timeout to prevent spurious errors
      if (timeoutId !== null) clearTimeout(timeoutId);
      setIsLocating(false);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-red-400">
        <div className="text-center space-y-4">
          <p>Failed to load weather data.</p>
          <Button variant="outline" onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }

  if (isLoading || !weatherData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // Determine Warning Status (only show warnings, not watches)
  const activeAlerts = weatherData?.alerts || [];
  const showFloodWatch = activeAlerts.length > 0;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-blue-500/30 flex flex-col">
      <AppHeader 
        location={weatherData?.location || location} 
        currentPage="weather"
        onUpgrade={() => setShowUpgradeDialog(true)}
        onHelp={() => tourRef.current?.restart()}
      />
      <FreePreviewBanner />
      
      <div className="flex-1 px-4 py-2 md:p-8">
        <div className="w-full mx-auto space-y-3 md:space-y-4">

        {/* Weather Warning Alert (only warnings, not watches) */}
        {showFloodWatch && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg overflow-hidden animate-in fade-in slide-in-from-top-2">
            <button 
              onClick={() => setIsAlertExpanded(!isAlertExpanded)}
              className="w-full p-4 flex items-center justify-between hover:bg-red-500/5 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                <h3 className="font-bold text-red-400">
                  {activeAlerts[0]?.event || activeAlerts[0]?.headline || "Weather Warning in Effect"}
                </h3>
              </div>
              {isAlertExpanded ? (
                <ChevronUp className="w-4 h-4 text-red-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-red-400" />
              )}
            </button>
            
            {isAlertExpanded && (
              <div className="px-4 pb-4 pt-0 pl-12">
                <p className="text-sm text-red-400/80 animate-in slide-in-from-top-1 whitespace-pre-line">
                  {activeAlerts[0]?.description || activeAlerts[0]?.headline || "Severe weather conditions reported."}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Search Bar Section */}
        <div className="relative flex-1 md:w-full z-30 flex gap-2">
          <div className="relative flex-1">
            <form onSubmit={handleSearch} className="relative w-full">
              <Input 
                data-testid="input-city-search"
                placeholder={location || "Search city..."} 
                className="bg-white dark:bg-white/5 border-2 border-slate-300 dark:border-white/20 pr-12 focus:bg-white dark:focus:bg-white/10 focus:border-amber-400 dark:focus:border-amber-500 transition-colors disabled:opacity-50 h-[44px] text-base shadow-sm"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => {
                  if (searchQuery === location) {
                    setSearchQuery('');
                  }
                  setShowSuggestions(true);
                }}
                onBlur={() => {
                  // Restore location to search query when blurring if empty
                  if (!searchQuery) {
                    setSearchQuery(location);
                  }
                }}
                disabled={isLoading}
              />
              <button 
                type="submit" 
                disabled={isLoading}
                data-testid="button-search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors disabled:opacity-50 p-2"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Search className="w-5 h-5" />
                )}
              </button>
            </form>
            
            {/* Autosuggest Dropdown with Recent Searches */}
            {showSuggestions && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-white/10 rounded-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 z-[60]">
                {/* Search Suggestions */}
                {suggestions && suggestions.length > 0 && (
                  <>
                    {suggestions.map((item: any) => {
                      const suggestionQuery = `${item.name}, ${item.region}, ${item.country}`;
                      const isFavorite = favoriteLocations.includes(suggestionQuery);
                      return (
                        <div
                          key={item.id}
                          className="flex items-center px-3 py-2.5 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors group"
                        >
                          <button
                            className="flex-1 text-left text-sm"
                            onClick={() => handleSuggestionClick(item)}
                          >
                            <span className="text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white">{item.name}</span>
                            <span className="text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-400">, {item.region}, {item.country}</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isFavorite) {
                                removeFromFavorites(suggestionQuery);
                              } else {
                                addToFavorites(suggestionQuery);
                              }
                            }}
                            className={`ml-2 p-1.5 rounded-full transition-colors ${
                              isAuthenticated && isFavorite 
                                ? 'text-yellow-400 hover:text-yellow-500' 
                                : 'text-slate-400 hover:text-yellow-400 opacity-60 hover:opacity-100'
                            }`}
                            title={isAuthenticated ? (isFavorite ? "Remove from favorites" : "Add to favorites") : "Sign in to save favorites"}
                            data-testid={`button-favorite-suggestion-${item.id}`}
                          >
                            <Star className={`w-4 h-4 ${isAuthenticated && isFavorite ? 'fill-current' : ''}`} />
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}
                
                {/* Recent Searches - show when no search query or no suggestions */}
                {(!searchQuery || (suggestions && suggestions.length === 0)) && recentSearches && recentSearches.length > 0 && (
                  <>
                    {suggestions && suggestions.length > 0 && (
                      <div className="border-t border-slate-200 dark:border-white/10"></div>
                    )}
                    <div className="px-3 py-2 text-xs text-muted-foreground uppercase tracking-wider">Recent</div>
                    {Array.from(new Map(recentSearches.map(item => [item.name, item])).values())
                      .slice(0, 5)
                      .map((loc) => (
                        <button
                          key={loc.id}
                          className="w-full text-left px-4 py-3 text-sm hover:bg-slate-100 dark:hover:bg-white/5 transition-colors group"
                          onClick={() => {
                            setLocation(loc.query);
                            setSearchQuery(loc.query);
                            setShowSuggestions(false);
                          }}
                        >
                          <span className="text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white">{loc.name}</span>
                        </button>
                      ))}
                  </>
                )}
              </div>
            )}
            
            {/* Click outside handler (simple overlay) - Lower z-index than dropdown */}
            {showSuggestions && (
              <div 
                className="fixed inset-0 z-40 bg-transparent" 
                onClick={() => setShowSuggestions(false)} 
              />
            )}
          </div>

          {/* Locate Me Button - Map themed with red pin */}
          <Button
            variant="outline"
            onClick={handleLocateMe}
            disabled={isLocating || isLoading}
            className="bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-600/40 hover:bg-amber-200 dark:hover:bg-amber-800/40 shrink-0 min-h-[44px] px-3 py-2 gap-1.5"
            title="Find weather at my location"
          >
            {isLocating ? (
              <Loader2 className="w-5 h-5 animate-spin text-amber-600 dark:text-amber-400" />
            ) : (
              <MapPin className="w-5 h-5 text-red-500 dark:text-red-400" />
            )}
            <span className="text-xs font-medium text-amber-700 dark:text-amber-300 sm:hidden">My Location</span>
          </Button>

          {/* Favorites Dropdown - only show when logged in and has favorites */}
          {isAuthenticated && favoriteLocations.length > 0 && (
            <div className="relative">
              <Button
                variant="outline"
                onClick={() => setShowFavorites(!showFavorites)}
                className="bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white text-muted-foreground shrink-0 gap-1.5 min-w-[44px] min-h-[44px] px-3 py-2"
                data-testid="button-favorites-dropdown"
              >
                <Star className="w-5 h-5 text-yellow-400" />
                <span className="hidden sm:inline text-sm">Favorites</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showFavorites ? 'rotate-180' : ''}`} />
              </Button>

              {showFavorites && (
                <>
                  <div 
                    className="fixed inset-0 z-40 bg-transparent" 
                    onClick={() => setShowFavorites(false)} 
                  />
                  <div className="absolute top-full right-0 mt-2 w-64 bg-white dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-white/10 rounded-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 z-[60]">
                    <div className="px-3 py-2 text-xs text-muted-foreground uppercase tracking-wider border-b border-slate-200 dark:border-white/10">
                      Saved Locations
                    </div>
                    {favoriteLocations.map((fav, idx) => (
                      <div 
                        key={idx}
                        className="flex items-center justify-between px-2 py-1 hover:bg-slate-100 dark:hover:bg-white/5 group"
                      >
                        <button
                          className="flex-1 text-left px-2 py-2 text-sm text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition-colors"
                          onClick={() => {
                            setLocation(fav);
                            setSearchQuery(fav);
                            setShowFavorites(false);
                          }}
                          data-testid={`button-favorite-${idx}`}
                        >
                          {fav}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromFavorites(fav);
                          }}
                          className="p-1.5 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                          title="Remove from favorites"
                          data-testid={`button-remove-favorite-${idx}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Status banner - for trial and expired users */}
        {isInTrial && trialDaysRemaining > 0 && (
          <div className="mx-2 mb-2 px-4 py-2 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-lg flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                {trialDaysRemaining} day{trialDaysRemaining !== 1 ? 's' : ''} left in your free trial
              </span>
            </div>
            <button 
              onClick={() => setShowUpgradeDialog(true)}
              className="text-xs text-amber-600 dark:text-amber-400 font-semibold hover:underline"
              data-testid="button-trial-upgrade"
            >
              Upgrade now
            </button>
          </div>
        )}
        {isTrialExpired && (
          <div className="mx-2 mb-2 px-4 py-2 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-lg flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                Your free trial has ended
              </span>
            </div>
            <button 
              onClick={() => setShowUpgradeDialog(true)}
              className="text-xs text-amber-600 dark:text-amber-400 font-semibold hover:underline"
              data-testid="button-expired-upgrade"
            >
              Upgrade to Pro
            </button>
          </div>
        )}


        {/* Removed Prime Fishing Times - replaced by Expert Fishing Forecast above */}
        {false && hasSolunarSelected && solunarData && moonData && weatherData && (() => {
          // Analyze next 7 days for prime fishing conditions
          const primeTimes: any[] = [];
          
          solunarData!.forEach((dayData: SolunarData, dayIndex: number) => {
            // Get weather data for this day
            const dayDate = new Date(dayData.date);
            const weatherDay = weatherData!.days.find((d: any) => 
              new Date(d.fullDate).toDateString() === dayDate.toDateString()
            );
            
            if (!weatherDay) return;
            
            // Get sunrise/sunset for this day
            const moonDay = moonData.find((m: any) => 
              new Date(m.date).toDateString() === dayDate.toDateString()
            );
            
            if (!moonDay || !moonDay.sunrise || !moonDay.sunset) return;
            
            // Combine date with time to create full timestamps
            const dateStr = dayData.date; // e.g., "2025-12-01"
            const sunriseTs = new Date(`${dateStr}T${moonDay.sunrise}`).getTime();
            const sunsetTs = new Date(`${dateStr}T${moonDay.sunset}`).getTime();
            
            // Analyze each major feeding period
            dayData.feedingPeriods
              .filter((period: FeedingPeriod) => period.type === 'major')
              .forEach((period: FeedingPeriod) => {
                // Check if period is during daylight hours using timestamps
                const isDaytime = period.centerTimestamp >= sunriseTs && period.centerTimestamp <= sunsetTs;
                if (!isDaytime) return;
                
                // Find closest hourly weather data (within 90 minutes)
                let hourData: any = null;
                let minDiff = Infinity;
                weatherDay.hours.forEach((h: any) => {
                  const hourTs = new Date(h.datetime).getTime();
                  const diff = Math.abs(hourTs - period.centerTimestamp);
                  if (diff < minDiff && diff < 5400000) { // Within 90 min
                    minDiff = diff;
                    hourData = h;
                  }
                });
                
                if (!hourData) return;
                
                // Check weather conditions
                const lowPrecip = (hourData.precipProb || 0) < 50 && (hourData.precipAmount || 0) < 0.1;
                const safeWinds = (hourData.windSpeed || 0) < 15; // Below small craft advisory
                
                // Get tide coefficient if available
                let tideCoeff = null;
                if (tideData && tideData.forecast) {
                  const tideDay = tideData.forecast.find((td: any) => 
                    new Date(td.date).toDateString() === dayDate.toDateString()
                  );
                  if (tideDay) {
                    // Find closest high tide to this feeding period
                    const closestHighTide = tideDay.highTides?.reduce((closest: any, tide: any) => {
                      const tideTime = new Date(tide.time).getTime();
                      const closestTime = closest ? new Date(closest.time).getTime() : Infinity;
                      return Math.abs(tideTime - period.centerTimestamp) < Math.abs(closestTime - period.centerTimestamp)
                        ? tide : closest;
                    }, null);
                    
                    tideCoeff = closestHighTide?.coefficient || tideDay.avgCoefficient || null;
                  }
                }
                
                const goodTide = tideCoeff === null || tideCoeff >= 70;
                
                // Calculate score based on number of conditions met
                let score = 0;
                if (lowPrecip) score += 30;
                if (safeWinds) score += 30;
                if (goodTide) score += 20;
                if (tideCoeff && tideCoeff >= 95) score += 20; // Bonus for excellent tides
                
                // Only include if at least 2 out of 3 main conditions are met
                const conditionsMet = (lowPrecip ? 1 : 0) + (safeWinds ? 1 : 0) + (goodTide ? 1 : 0);
                
                if (conditionsMet >= 2) {
                  primeTimes.push({
                    date: dayDate,
                    dayName: dayDate.toLocaleDateString('en-US', { weekday: 'short' }),
                    dayNum: dayDate.getDate(),
                    period: period,
                    tideCoeff: tideCoeff,
                    weather: {
                      precipProb: hourData.precipProb || 0,
                      windSpeed: hourData.windSpeed || 0,
                      windDir: hourData.windDir,
                      temp: hourData.temp
                    },
                    score: score
                  });
                }
              });
          });
          
          // Sort by score (best first) and limit to top 5
          primeTimes.sort((a, b) => b.score - a.score);
          const topPrimeTimes = primeTimes.slice(0, 5);
          
          if (topPrimeTimes.length === 0) return null;
          
          return (
            <div className="mx-2 mb-3">
              <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 border-amber-500/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-amber-400 flex items-center gap-2">
                    <Star className="w-4 h-4 fill-amber-400" />
                    Prime Fishing Times (Next 7 Days)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {topPrimeTimes.map((prime, idx) => {
                    const startTime = new Date(prime.period.startTimestamp);
                    const endTime = new Date(prime.period.endTimestamp);
                    
                    const formatTime = (date: Date) => {
                      const h = date.getHours();
                      const m = date.getMinutes();
                      const ampm = h >= 12 ? 'pm' : 'am';
                      const hour12 = h % 12 || 12;
                      return `${hour12}:${m.toString().padStart(2, '0')}${ampm}`;
                    };
                    
                    const eventLabel = prime.period.event === 'overhead' ? 'Moon Overhead' : 'Moon Underfoot';
                    
                    return (
                      <div 
                        key={idx}
                        className="flex items-center justify-between p-2 bg-slate-900/40 rounded-lg border border-amber-500/20"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-amber-300">
                              {prime.dayName} {prime.dayNum}
                            </span>
                            <span className="text-xs text-amber-400">
                              {formatTime(startTime)} - {formatTime(endTime)}
                            </span>
                          </div>
                          <div className="text-[10px] text-amber-400/70 mt-0.5">
                            {eventLabel}
                            {prime.tideCoeff && (
                              <span className="ml-2">• Tide: {prime.tideCoeff}%</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-amber-300/80">
                          <span>{Math.round(prime.weather.temp)}°</span>
                          <span>•</span>
                          <span>
                            {prime.weather.windDir !== undefined && `${degToCompass(prime.weather.windDir)} `}
                            {Math.round(prime.weather.windSpeed)} mph
                          </span>
                          <span>•</span>
                          <span>{Math.round(prime.weather.precipProb)}%</span>
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-[10px] text-amber-400/60 mt-2">
                    Based on: Major moon activity • Good tides • Daylight • Low precipitation • Safe winds
                  </p>
                </CardContent>
              </Card>
            </div>
          );
        })()}

        {/* Daily Grid - Square Cards with Side Bars */}
        <section 
          ref={dayCardsRef}
          className="overflow-x-auto py-2 scroll-smooth"
          style={{ scrollBehavior: 'smooth' }}
          data-tour="day-cards"
        >
          <div className="flex gap-2 min-w-max px-2">
            {(displayDays || []).map((day, idx) => {
              const isLocked = !isPremium && idx >= 5;
              const fishingForecast = getFishingForecastForDay(day.fullDate);
              return (
              <div key={day.fullDate + idx} className="flex flex-col gap-1 shrink-0">
                <Card 
                  onClick={() => {
                    if (isLocked) {
                      setShowUpgradeDialog(true);
                    } else {
                      scrollToDay(idx);
                    }
                  }}
                  className={`w-[120px] transition-all duration-300 cursor-pointer group hover:translate-y-[-2px] relative ${
                    isLocked 
                      ? 'bg-slate-100 dark:bg-white/5 opacity-60 border-slate-200 dark:border-white/5'
                      : idx === selectedDateIndex 
                        ? 'bg-transparent ring-2 ring-amber-400 shadow-lg shadow-amber-400/20 border-amber-300 dark:border-amber-400' 
                        : 'bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 border-slate-200 dark:border-white/5'
                  }`}
                  data-testid={isLocked ? `card-locked-day-${idx}` : `card-day-${idx}`}
                >
                  {isLocked && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg z-10">
                      <Lock className="w-6 h-6 text-yellow-500" />
                    </div>
                  )}
                  <CardContent className="p-0 h-[120px] flex flex-col">
                    {/* Fishing Rating - Top Bar */}
                    {fishingForecast && (
                      <div className="flex items-center justify-center gap-1 py-1 border-b border-slate-200 dark:border-white/10">
                        <Fish className="w-3 h-3 text-emerald-500" />
                        <div className="flex gap-0.5">
                          {renderStarRating(fishingForecast.rating)}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-1">
                      {/* Left Bar - Amount */}
                      <div className="w-6 relative flex flex-col justify-start items-center pt-2 pb-6">
                        <div className="w-2 bg-muted dark:bg-slate-800 rounded-full overflow-hidden flex-1 flex flex-col justify-end">
                          <div 
                            className="w-full bg-gradient-to-t from-cyan-400 to-cyan-500 rounded-full" 
                            style={{ height: `${Math.min((day.precipAmount / 1.0) * 100, 100)}%` }}
                          />
                        </div>
                        <div className="absolute bottom-1 left-0 right-0 text-center text-[9px] text-cyan-400 font-medium">
                          {Number((day.precipAmount || 0).toFixed(2))}"
                        </div>
                      </div>

                      {/* Center Content */}
                      <div className="flex-1 flex flex-col items-center justify-center text-center space-y-1.5 py-2">
                        <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 tracking-wide">
                          {day.day} {day.date}
                        </div>
                        
                        <div className="p-1.5 rounded-full bg-slate-100 dark:bg-white/5 group-hover:bg-slate-200 dark:group-hover:bg-white/10 transition-colors">
                           <WeatherIcon type={day.icon} className="w-6 h-6" />
                        </div>
                        
                        <div className="flex items-baseline gap-1 font-mono">
                          <span className="text-sm font-bold">{day.high}°</span>
                          <span className="text-[10px] text-muted-foreground">{day.low}°</span>
                        </div>
                      </div>

                      {/* Right Bar - Probability */}
                      <div className="w-6 relative flex flex-col justify-start items-center pt-2 pb-6">
                        <div className="w-2 bg-muted dark:bg-slate-800 rounded-full overflow-hidden flex-1 flex flex-col justify-end">
                          <div 
                            className="w-full bg-gradient-to-t from-blue-400 to-blue-500 rounded-full" 
                            style={{ height: `${Math.round(day.precipProb)}%` }}
                          />
                        </div>
                        <div className="absolute bottom-1 left-0 right-0 text-center text-[9px] text-blue-400 font-medium">
                          {Math.round(day.precipProb)}%
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                {/* Fishing Forecast Modal Button */}
                {fishingForecast && !isLocked && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedModalDay(idx);
                      setBiteModalOpen(true);
                    }}
                    className="w-full px-2 py-1.5 text-[11px] font-semibold rounded transition-all flex flex-col items-center gap-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50"
                    data-testid={`button-toggle-fishing-${idx}`}
                  >
                    <span className="flex items-center gap-0.5">
                      <span>🎣</span>
                      <span>BiteWeather</span>
                    </span>
                    <span className="flex items-center gap-0.5">
                      <span>Forecast</span>
                      <span>▶</span>
                    </span>
                  </button>
                )}
              </div>
            );
            })}
            
            {/* Upgrade/Signup prompt - show for users not subscribed */}
            {!hasActiveSubscription && (
              isAuthenticated ? (
                <Card 
                  onClick={() => setShowUpgradeDialog(true)}
                  className="w-[120px] border-2 border-dashed border-yellow-500/30 bg-yellow-500/5 transition-all duration-300 cursor-pointer group hover:translate-y-[-2px] hover:border-yellow-500/50 shrink-0"
                  data-testid="card-upgrade-prompt"
                >
                  <CardContent className="p-0 h-[120px] flex flex-col items-center justify-center gap-2">
                    <Crown className="w-8 h-8 text-yellow-500" />
                    <div className="text-center">
                      <div className="text-xs font-semibold text-yellow-500">Go Pro</div>
                      <div className="text-[9px] text-muted-foreground">$5/month</div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <a href="/login">
                  <Card 
                    className="w-[120px] border-2 border-dashed border-blue-500/30 bg-blue-500/5 transition-all duration-300 cursor-pointer group hover:translate-y-[-2px] hover:border-blue-500/50 shrink-0"
                    data-testid="card-signup-prompt"
                  >
                    <CardContent className="p-0 h-[120px] flex flex-col items-center justify-center gap-2">
                      <Crown className="w-8 h-8 text-blue-500" />
                      <div className="text-center">
                        <div className="text-xs font-semibold text-blue-500">Free Trial</div>
                        <div className="text-[9px] text-muted-foreground">14 days free</div>
                      </div>
                    </CardContent>
                  </Card>
                </a>
              )
            )}
          </div>
        </section>


        {/* Main Visualization: The Solution */}
        <section className="animate-in fade-in slide-in-from-bottom-4 duration-700">
          <Card className="border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/5 backdrop-blur-xl shadow-2xl overflow-hidden">
            <CardContent className="p-0 pt-3">
              {/* Feature Highlight */}
              <div className="text-center px-4 pb-2">
                {isPremium ? (
                  <p className="text-xs text-blue-600 dark:text-cyan-400/90 font-medium">
                    ✨ Compare multiple weather metrics side-by-side — tap to overlay and discover patterns
                  </p>
                ) : isAuthenticated ? (
                  <button 
                    onClick={() => setShowUpgradeDialog(true)}
                    className="text-xs text-amber-600 dark:text-amber-400/90 font-medium hover:underline cursor-pointer"
                    data-testid="button-upgrade-overlay-hint"
                  >
                    🔓 Upgrade to Pro to overlay multiple metrics and discover patterns
                  </button>
                ) : (
                  <a 
                    href="/login"
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full hover:from-blue-600 hover:to-cyan-600 shadow-lg shadow-blue-500/25 transition-all hover:scale-105 active:scale-95"
                    data-testid="button-signup-overlay-hint"
                  >
                    🎁 Sign up free to unlock metric overlays
                    <span className="text-white/80">→</span>
                  </a>
                )}
              </div>
              {/* Metric Selector - Large touch targets for mobile */}
              {/* Order: Solunar, Tide, Wind, Precip, Temp (fishing-focused first) */}
              <div className="flex flex-wrap gap-1.5 md:gap-2 px-4 pb-3 justify-center items-center" data-tour="metric-buttons">
                {/* Solunar - first for fishing focus */}
                {(() => {
                  const config = getMetricConfig('solunar');
                  const isSelected = selectedMetrics.includes('solunar');
                  return (
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <button
                          key="solunar"
                          onClick={() => toggleMetric('solunar')}
                          className="px-2 py-1 md:px-3 md:py-2 min-h-[36px] md:min-h-[44px] text-xs md:text-sm rounded-lg transition text-white font-medium active:scale-95"
                          style={{
                            backgroundColor: isSelected ? config.leftColor : 'rgba(255,255,255,0.05)',
                            color: isSelected ? '#fff' : '#94a3b8',
                            borderWidth: '1px',
                            borderStyle: 'solid',
                            borderColor: isSelected ? config.leftColor : '#475569'
                          }}
                          data-testid="button-metric-solunar"
                        >
                          Solunar
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isSelected ? 'Moon altitude curve & fishing periods' : 'View solunar feeding times for fishing'}
                      </TooltipContent>
                    </UITooltip>
                  );
                })()}
                {/* Tide - second for fishing focus */}
                {weatherData.tideAvailable && (() => {
                  const config = getMetricConfig('tide');
                  const isSelected = selectedMetrics.includes('tide');
                  return (
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <button
                          key="tide"
                          onClick={() => toggleMetric('tide')}
                          className="px-2 py-1 md:px-3 md:py-2 min-h-[36px] md:min-h-[44px] text-xs md:text-sm rounded-lg transition text-white font-medium active:scale-95"
                          style={{
                            backgroundColor: isSelected ? config.leftColor : 'rgba(255,255,255,0.05)',
                            color: isSelected ? '#fff' : '#94a3b8',
                            borderWidth: '1px',
                            borderStyle: 'solid',
                            borderColor: isSelected ? config.leftColor : '#475569'
                          }}
                          data-testid="button-metric-tide"
                        >
                          Tide
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isSelected ? 'Tide chart active' : 'View tide predictions & coefficients'}
                      </TooltipContent>
                    </UITooltip>
                  );
                })()}
                {/* Wind, Precip - core weather metrics */}
                {(['wind', 'precip'] as MetricType[]).map(metric => {
                  const config = getMetricConfig(metric);
                  const isSelected = selectedMetrics.includes(metric);
                  return (
                    <button
                      key={metric}
                      onClick={() => toggleMetric(metric)}
                      className="px-2 py-1 md:px-3 md:py-2 min-h-[36px] md:min-h-[44px] text-xs md:text-sm rounded-lg transition text-white font-medium active:scale-95"
                      style={{
                        backgroundColor: isSelected ? config.leftColor : 'rgba(255,255,255,0.05)',
                        color: isSelected ? '#fff' : '#94a3b8',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: isSelected ? config.leftColor : '#475569'
                      }}
                      data-testid={`button-metric-${metric}`}
                    >
                      {metric === 'precip' ? 'Precip' : 'Wind'}
                    </button>
                  );
                })}
                {/* Sun - sunrise/sunset indicators */}
                {(() => {
                  const config = getMetricConfig('sun');
                  const isSelected = selectedMetrics.includes('sun');
                  return (
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <button
                          key="sun"
                          onClick={() => toggleMetric('sun')}
                          className="px-2 py-1 md:px-3 md:py-2 min-h-[36px] md:min-h-[44px] text-xs md:text-sm rounded-lg transition text-white font-medium active:scale-95"
                          style={{
                            backgroundColor: isSelected ? config.leftColor : 'rgba(255,255,255,0.05)',
                            color: isSelected ? '#fff' : '#94a3b8',
                            borderWidth: '1px',
                            borderStyle: 'solid',
                            borderColor: isSelected ? config.leftColor : '#475569'
                          }}
                          data-testid="button-metric-sun"
                        >
                          Sun
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isSelected ? 'Showing sunrise/sunset times & daylight' : 'View sunrise/sunset & daylight hours'}
                      </TooltipContent>
                    </UITooltip>
                  );
                })()}
                {/* Cloud %, Temp, Pressure, Humidity, Dew Pt - additional weather metrics */}
                {(['cloudcover', 'temp', 'pressure', 'humidity', 'dewpoint'] as MetricType[]).map(metric => {
                  const config = getMetricConfig(metric);
                  const isSelected = selectedMetrics.includes(metric);
                  return (
                    <button
                      key={metric}
                      onClick={() => toggleMetric(metric)}
                      className="px-2 py-1 md:px-3 md:py-2 min-h-[36px] md:min-h-[44px] text-xs md:text-sm rounded-lg transition text-white font-medium active:scale-95"
                      style={{
                        backgroundColor: isSelected ? config.leftColor : 'rgba(255,255,255,0.05)',
                        color: isSelected ? '#fff' : '#94a3b8',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: isSelected ? config.leftColor : '#475569'
                      }}
                      data-testid={`button-metric-${metric}`}
                    >
                      {metric === 'cloudcover' ? 'Cloud %' :
                       metric === 'pressure' ? 'Pres' :
                       metric === 'humidity' ? 'Hum %' : 
                       metric === 'dewpoint' ? 'Dew Pt' : 
                       'Temp'}
                    </button>
                  );
                })}
                {selectedMetrics.length > 1 && (
                  <button onClick={clearAllMetrics} className="px-2 py-1 md:px-3 md:py-2 min-h-[36px] md:min-h-[44px] text-xs md:text-sm rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 active:scale-95 transition" data-testid="button-clear-metrics">Clear</button>
                )}
              </div>
              {/* Data availability help text */}
              <div className="px-4 pb-2 text-center">
                <p className="text-[10px] md:text-xs text-muted-foreground/70">
                  Solunar & Tide: 15 days • Weather metrics: 15 days
                </p>
              </div>
              <div className={`w-full ${isMobile ? '-mx-4 px-0 h-[280px]' : 'px-0 h-[320px]'} relative group`}>
                {/* Horizontally scrollable chart container */}
                <div 
                  ref={chartScrollRef}
                  className="w-full h-full overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent"
                  data-tour="hourly-chart"
                  style={{ 
                    WebkitOverflowScrolling: 'touch',
                    overscrollBehaviorX: 'contain',
                    scrollSnapType: 'none'
                  }}
                  onScroll={() => {
                    handleChartScroll();
                    if (isMobile) setTooltipVisible(false);
                  }}
                  onMouseLeave={() => setTooltipVisible(false)}
                  onMouseEnter={() => setTooltipVisible(true)}
                  onTouchStart={() => setTooltipVisible(true)}
                >
                  {(() => {
                    // Show days based on premium status (5 days for free, all for premium)
                    const daysToShow = displayDays || [];
                    const totalDays = daysToShow.length;
                    let allHours: any[] = [];
                    
                    // Track which day each hour belongs to for labeling
                    for (let i = 0; i < totalDays; i++) {
                      const dayData = daysToShow[i];
                      const dayHours = (dayData?.hours || []).map((hour: any, hourIdx: number) => ({
                        ...hour,
                        dayIndex: i,
                        dayLabel: `${dayData.day} ${dayData.date}`,
                        isFirstHourOfDay: hourIdx === 0
                      }));
                      allHours = allHours.concat(dayHours);
                    }
                    
                    const sortedHours = allHours.slice().sort((a, b) => {
                      return new Date(a.datetime).getTime() - new Date(b.datetime).getTime();
                    });
                    
                    // Calculate chart width based on total hours
                    const pixelsPerHour = isMobile ? 14 : 28;
                    const chartWidth = Math.max(sortedHours.length * pixelsPerHour, isMobile ? 336 : 800);
                    
                    // Create display time labels - show day at 12pm (middle of day) for each day
                    // Also add seqIndex for numeric x-axis positioning
                    // First pass: identify which indices are the start of each new day
                    // Include 0 for the first day so it also gets a label
                    const dayStartIndices: number[] = [0];
                    for (let idx = 1; idx < sortedHours.length; idx++) {
                      const prevHour = sortedHours[idx - 1];
                      const currentDate = new Date(sortedHours[idx].datetime).getDate();
                      const prevDate = new Date(prevHour.datetime).getDate();
                      if (currentDate !== prevDate) {
                        dayStartIndices.push(idx);
                      }
                    }
                    
                    // Find the 12pm hour index for each day (including first day)
                    const noonIndices = new Map<number, number>();
                    dayStartIndices.forEach((startIdx, dayNum) => {
                      // Find the hour closest to 12pm within this day's range
                      let bestIdx = startIdx;
                      let bestDiff = Infinity;
                      
                      const endIdx = dayNum + 1 < dayStartIndices.length ? dayStartIndices[dayNum + 1] : sortedHours.length;
                      for (let idx = startIdx; idx < endIdx; idx++) {
                        const hour = sortedHours[idx];
                        const hourOfDay = new Date(hour.datetime).getHours();
                        const diff = Math.abs(hourOfDay - 12);
                        if (diff < bestDiff) {
                          bestDiff = diff;
                          bestIdx = idx;
                        }
                      }
                      
                      noonIndices.set(dayNum, bestIdx);
                    });
                    
                    // Convert noonIndices Map to a Set for easy lookup
                    const noonIndexSet = new Set<number>();
                    noonIndices.forEach((noonIdx) => {
                      noonIndexSet.add(noonIdx);
                    });
                    
                    const hoursWithDisplayTime = sortedHours.map((hour, idx) => {
                      let displayTime = hour.time;
                      let isMidnight = false;
                      
                      // Don't override noon labels anymore - they'll show regular time (12p)
                      // Day labels will be shown as large background text instead
                      
                      // For vertical separator lines, use day boundaries (midnight)
                      if (idx > 0) {
                        const prevHour = sortedHours[idx - 1];
                        const currentDate = new Date(hour.datetime).getDate();
                        const prevDate = new Date(prevHour.datetime).getDate();
                        if (currentDate !== prevDate) {
                          isMidnight = true;
                        }
                      }
                      
                      // Add UTC timestamp for time-domain X-axis
                      const timestamp = new Date(hour.datetime).getTime();
                      
                      return { ...hour, displayTime, seqIndex: idx, timestamp, isMidnight, solunarBaseline: 50 };
                    });
                      
                      // Calculate peak precipitation hour for each day (only if there's rain)
                      // First pass: find max precipitation AMOUNT per day
                      const maxPrecipByDay = new Map<number, number>();
                      hoursWithDisplayTime.forEach(hour => {
                        const dayIdx = hour.dayIndex;
                        const precipAmount = hour.precipAmount || 0;
                        const currentMaxAmount = maxPrecipByDay.get(dayIdx) || 0;
                        if (precipAmount > currentMaxAmount) {
                          maxPrecipByDay.set(dayIdx, precipAmount);
                        }
                      });
                      
                      // Second pass: find the FIRST index that matches the max AMOUNT for each day
                      // Both amount and chance indicators will appear at this same hour
                      const peakPrecipIdx = new Map<number, number>();
                      hoursWithDisplayTime.forEach((hour, idx) => {
                        const dayIdx = hour.dayIndex;
                        const precipAmount = hour.precipAmount || 0;
                        const maxPrecipForDay = maxPrecipByDay.get(dayIdx) || 0;
                        
                        // Only mark the first hour that matches the max amount
                        if (precipAmount > 0 && precipAmount === maxPrecipForDay && !peakPrecipIdx.has(dayIdx)) {
                          peakPrecipIdx.set(dayIdx, idx);
                        }
                      });
                      
                      // Convert to Set for fast lookup
                      const peakPrecipIdxSet = new Set<number>();
                      peakPrecipIdx.forEach((val) => peakPrecipIdxSet.add(val));
                      
                      // Check if tide metric is selected
                      const hasTide = selectedMetrics.includes('tide');
                      
                      // Add normalized values for display - use hoursWithDisplayTime which includes display labels
                      const normalizedData = hoursWithDisplayTime.map((hour, idx) => {
                        // Mark this hour as peak only if it's THE peak AMOUNT index for its day
                        // Both amount and chance will show at the same hour
                        const isPeakPrecip = peakPrecipIdxSet.has(idx);
                        
                        return {
                          ...hour,
                          isPeakPrecip,
                          normalized_precipProb: hour.precipProb || 0,
                          normalized_temp: getNormalizedValue(hour.temp || 70, 'temp'),
                          normalized_windSpeed: getNormalizedValue(hour.windSpeed || 0, 'wind'),
                          normalized_humidity: hour.humidity || 0,
                          normalized_dewPoint: getNormalizedValue(hour.dewPoint || hour.temp || 70, 'dewpoint'),
                          normalized_cloudCover: hour.cloudCover || 0,
                          normalized_pressure: getNormalizedValue(hour.pressure || 1013, 'pressure')
                        };
                      });
                      
                      // Find day boundary indices for vertical separator lines
                      const dayBoundaryIndices: number[] = [];
                      hoursWithDisplayTime.forEach((hour, idx) => {
                        if (idx > 0) {
                          const prevHour = hoursWithDisplayTime[idx - 1];
                          const currentDate = new Date(hour.datetime).getDate();
                          const prevDate = new Date(prevHour.datetime).getDate();
                          if (currentDate !== prevDate) {
                            dayBoundaryIndices.push(idx);
                          }
                        }
                      });
                      
                      const configs = selectedMetrics.map(m => ({ metric: m, ...getMetricConfig(m) }));
                      const hasPrecip = selectedMetrics.includes('precip');
                      
                      // Fixed precipitation scale: 0-1" unless precip exceeds 1"/hr
                      const precipAmounts = sortedHours.map(h => h.precipAmount || 0);
                      const maxPrecip = Math.max(...precipAmounts);
                      const precipDomain: [number, number] = maxPrecip > 1 ? [0, Math.ceil(maxPrecip)] : [0, 1];
                      
                      // Chart data for precipitation and other metrics
                      // Filter to show only from current time forward (not full days from midnight)
                      // Use location timezone for accurate comparison
                      const locationTimezone = weatherData?.timezone || 'UTC';
                      const nowInLocation = DateTime.now().setZone(locationTimezone);
                      // Subtract 2 hours to keep recent hours visible (handles late evening when API's last hour has passed)
                      const filterCutoff = nowInLocation.startOf('hour').minus({ hours: 2 });
                      const chartData = normalizedData.filter(hour => {
                        if (!hour.datetime) return false;
                        // Parse hour datetime in location timezone
                        const hourInLocation = DateTime.fromISO(hour.datetime).setZone(locationTimezone);
                        // Include hours from 2 hours ago forward to prevent empty dataset at end of day
                        return hourInLocation >= filterCutoff;
                      });
                      
                      // Guard against empty results (e.g., clock skew) - only use fallback if truly no data
                      const finalChartData = chartData.length > 0 ? chartData : normalizedData.slice(0, Math.min(3, normalizedData.length));
                      
                      // Build day segments for background date labels using timestamps
                      // Use location timezone for all date calculations to avoid timezone mismatch
                      // Ignore any hours from yesterday that the relaxed filter may have included
                      const filterDayStart = filterCutoff.startOf('day');
                      const daySegments: Array<{ start: number; end: number; label: string }> = [];
                      const uniqueDays = new Map<string, { start: number; end: number; label: string }>();
                      finalChartData.forEach(hour => {
                        if (hour.datetime) {
                          // Use location timezone for all date operations to avoid viewer timezone issues
                          const hourDt = DateTime.fromISO(hour.datetime, { zone: locationTimezone });
                          const hourDayStart = hourDt.startOf('day');
                          
                          // Only include hours from the filter's start day forward
                          if (hourDayStart >= filterDayStart) {
                            const dateKey = hourDt.toISODate() || hourDt.toFormat('yyyy-MM-dd');
                            if (!uniqueDays.has(dateKey)) {
                              const weekday = hourDt.toFormat('EEE').toUpperCase();
                              const monthName = hourDt.toFormat('MMM').toUpperCase();
                              const dayOfMonth = hourDt.day;
                              const label = `${weekday} ${monthName} ${dayOfMonth}`;
                              uniqueDays.set(dateKey, { start: hour.timestamp, end: hour.timestamp, label });
                            } else {
                              const segment = uniqueDays.get(dateKey)!;
                              segment.end = hour.timestamp;
                            }
                          }
                        }
                      });
                      // Use Array.from to avoid TypeScript iteration error
                      daySegments.push(...Array.from(uniqueDays.values()));
                      
                      // Build tide chart data for overlay - match weather chart time range
                      let tideCurveData: any[] = [];
                      let tideMarkers: any[] = [];
                      let coefficientData: any[] = [];
                      let tideStartTime = 0;
                      let tideEndTime = 0;
                      
                      // Helper function to get coefficient color based on value
                      const getCoeffColor = (coeff: number) => {
                        if (coeff >= 95) return '#22c55e'; // Excellent - green
                        if (coeff >= 70) return '#84cc16'; // Good - lime
                        if (coeff >= 55) return '#facc15'; // Fair - amber/yellow
                        return '#f97316'; // Poor - orange
                      };
                      
                      const getCoeffLabel = (coeff: number) => {
                        if (coeff >= 95) return 'Excellent';
                        if (coeff >= 70) return 'Good';
                        if (coeff >= 55) return 'Fair';
                        return 'Poor';
                      };
                      
                      if (hasTide && tideData?.forecast && finalChartData.length > 0) {
                        // Match tide data time range to weather chart (current hour forward)
                        const weatherStartTime = new Date(finalChartData[0].datetime).getTime();
                        const weatherEndTime = new Date(finalChartData[finalChartData.length - 1].datetime).getTime();
                        
                        // Flatten all predictions and filter to match weather chart time range
                        const allPredictions = tideData.forecast.flatMap((day: any) => 
                          day.predictions.map((p: any) => ({
                            timestamp: new Date(p.time).getTime(),
                            time: new Date(p.time),
                            height: parseFloat(p.height),
                          }))
                        ).filter((p: any) => p.timestamp >= weatherStartTime && p.timestamp <= weatherEndTime);
                        
                        // Sort chronologically
                        allPredictions.sort((a: any, b: any) => a.timestamp - b.timestamp);
                        tideCurveData = allPredictions;
                        
                        if (tideCurveData.length > 0) {
                          tideStartTime = weatherStartTime;
                          tideEndTime = weatherEndTime;
                          
                          // Build tide markers from high/low tide arrays - match weather time range
                          // Also collect coefficient data points
                          const coeffPoints: any[] = [];
                          
                          // Build coefficient data for each day that overlaps the chart time range
                          // This ensures continuous coefficient coverage from chart start to end
                          tideData.forecast.forEach((day: any) => {
                            // Use location timezone to determine day boundaries
                            const dayDt = DateTime.fromISO(day.date + 'T00:00:00', { zone: locationTimezone });
                            const dayStart = dayDt.toMillis();
                            const dayEnd = dayStart + 24 * 60 * 60 * 1000;
                            const coeff = day.avgCoefficient || 0;
                            
                            // Check if this day overlaps with our chart time range
                            if (dayEnd >= weatherStartTime && dayStart <= weatherEndTime) {
                              // Add coefficient point at start of day or chart start, whichever is later
                              const startPoint = Math.max(dayStart, weatherStartTime);
                              coeffPoints.push({
                                timestamp: startPoint,
                                coefficient: coeff,
                                color: getCoeffColor(coeff),
                                label: getCoeffLabel(coeff)
                              });
                              
                              // Add coefficient point at end of day or chart end, whichever is earlier
                              const endPoint = Math.min(dayEnd, weatherEndTime);
                              coeffPoints.push({
                                timestamp: endPoint,
                                coefficient: coeff,
                                color: getCoeffColor(coeff),
                                label: getCoeffLabel(coeff)
                              });
                            }
                            
                            // Build tide markers
                            day.highTides?.forEach((tide: any) => {
                              const ts = new Date(tide.time).getTime();
                              if (ts >= weatherStartTime && ts <= weatherEndTime) {
                                tideMarkers.push({
                                  timestamp: ts,
                                  time: new Date(tide.time),
                                  height: parseFloat(tide.height),
                                  isHigh: true,
                                  coefficient: coeff
                                });
                              }
                            });
                            day.lowTides?.forEach((tide: any) => {
                              const ts = new Date(tide.time).getTime();
                              if (ts >= weatherStartTime && ts <= weatherEndTime) {
                                tideMarkers.push({
                                  timestamp: ts,
                                  time: new Date(tide.time),
                                  height: parseFloat(tide.height),
                                  isHigh: false,
                                  coefficient: coeff
                                });
                              }
                            });
                          });
                          
                          // Sort coefficient points chronologically
                          coeffPoints.sort((a, b) => a.timestamp - b.timestamp);
                          
                          // Build granular coefficient data by interpolating between tide events
                          // This creates smooth coefficient transitions on the chart
                          if (coeffPoints.length >= 2) {
                            for (let i = 0; i < coeffPoints.length - 1; i++) {
                              const current = coeffPoints[i];
                              const next = coeffPoints[i + 1];
                              const timeDiff = next.timestamp - current.timestamp;
                              const coeffDiff = next.coefficient - current.coefficient;
                              
                              // Add the starting point
                              coefficientData.push({
                                timestamp: current.timestamp,
                                coefficient: current.coefficient,
                                color: current.color,
                                label: current.label
                              });
                              
                              // Add interpolated points every 30 minutes for smooth gradient
                              const intervalMs = 30 * 60 * 1000; // 30 minutes
                              for (let t = current.timestamp + intervalMs; t < next.timestamp; t += intervalMs) {
                                const progress = (t - current.timestamp) / timeDiff;
                                const interpCoeff = Math.round(current.coefficient + coeffDiff * progress);
                                coefficientData.push({
                                  timestamp: t,
                                  coefficient: interpCoeff,
                                  color: getCoeffColor(interpCoeff),
                                  label: getCoeffLabel(interpCoeff)
                                });
                              }
                            }
                            // Add the last point
                            const lastPoint = coeffPoints[coeffPoints.length - 1];
                            coefficientData.push({
                              timestamp: lastPoint.timestamp,
                              coefficient: lastPoint.coefficient,
                              color: lastPoint.color,
                              label: lastPoint.label
                            });
                          } else if (coeffPoints.length === 1) {
                            coefficientData = coeffPoints;
                          }
                        }
                      }
                      
                      // Merge tide height into finalChartData for tooltip activation when tide is only metric
                      if (hasTide && tideCurveData.length > 0) {
                        finalChartData.forEach((hour: any) => {
                          const hourTimestamp = new Date(hour.datetime).getTime();
                          
                          // Find closest tide prediction or interpolate between two
                          let tideHeight = null;
                          
                          // Find bracketing tide predictions
                          let beforeTide = null;
                          let afterTide = null;
                          
                          for (let i = 0; i < tideCurveData.length; i++) {
                            const tide = tideCurveData[i];
                            if (tide.timestamp <= hourTimestamp) {
                              beforeTide = tide;
                            }
                            if (tide.timestamp >= hourTimestamp && !afterTide) {
                              afterTide = tide;
                              break;
                            }
                          }
                          
                          // Interpolate or use closest value
                          if (beforeTide && afterTide) {
                            const ratio = (hourTimestamp - beforeTide.timestamp) / (afterTide.timestamp - beforeTide.timestamp);
                            tideHeight = beforeTide.height + ratio * (afterTide.height - beforeTide.height);
                          } else if (beforeTide) {
                            tideHeight = beforeTide.height;
                          } else if (afterTide) {
                            tideHeight = afterTide.height;
                          }
                          
                          hour.tideHeight = tideHeight;
                        });
                      }
                      
                      // Build moon markers for both tide and solunar charts
                      const moonMarkers: any[] = [];
                      const dailyMoonPhases: any[] = [];
                      const hasSolunar = selectedMetrics.includes('solunar');
                      
                      if ((hasTide || hasSolunar) && moonData && finalChartData.length > 0) {
                        const weatherStartTime = new Date(finalChartData[0].datetime).getTime();
                        const weatherEndTime = new Date(finalChartData[finalChartData.length - 1].datetime).getTime();
                        
                        moonData.forEach((dayMoon: any) => {
                          // Build daily moon phase array for top-of-chart display
                          const dayDate = new Date(dayMoon.date);
                          const dayStartTs = dayDate.getTime();
                          
                          // Find the corresponding day segment - segments now use timestamps
                          const matchingSegment = daySegments.find(seg => {
                            // seg.start and seg.end are now timestamps
                            // Check if this segment's timestamp range includes this day
                            const segStartDate = new Date(seg.start);
                            return segStartDate.toDateString() === dayDate.toDateString();
                          });
                          
                          if (matchingSegment) {
                            dailyMoonPhases.push({
                              date: dayMoon.date,
                              phaseName: dayMoon.phaseName,
                              moonphase: dayMoon.moonphase,
                              illumination: dayMoon.illumination,
                              segmentStart: matchingSegment.start,
                              segmentEnd: matchingSegment.end,
                              segmentLabel: matchingSegment.label
                            });
                          }
                          
                          // Add moonrise marker
                          if (dayMoon.moonrise) {
                            const [hours, minutes, seconds] = dayMoon.moonrise.split(':').map(Number);
                            const moonriseDate = new Date(dayMoon.date + 'T00:00:00');
                            moonriseDate.setHours(hours, minutes, seconds || 0, 0);
                            const moonriseTs = moonriseDate.getTime();
                            
                            if (moonriseTs >= weatherStartTime && moonriseTs <= weatherEndTime) {
                              moonMarkers.push({
                                timestamp: moonriseTs,
                                time: dayMoon.moonrise,
                                type: 'rise',
                                phaseName: dayMoon.phaseName,
                                moonphase: dayMoon.moonphase,
                                illumination: dayMoon.illumination
                              });
                            }
                          }
                          
                          // Add moonset marker - check both same day and next day (for early morning moonsets)
                          if (dayMoon.moonset) {
                            const [hours, minutes, seconds] = dayMoon.moonset.split(':').map(Number);
                            
                            // Try same day first
                            const moonsetDate = new Date(dayMoon.date + 'T00:00:00');
                            moonsetDate.setHours(hours, minutes, seconds || 0, 0);
                            let moonsetTs = moonsetDate.getTime();
                            
                            // If moonset is very early (before 6 AM), it likely occurred next day
                            if (hours < 6) {
                              const nextDayMoonset = new Date(moonsetDate);
                              nextDayMoonset.setDate(nextDayMoonset.getDate() + 1);
                              const nextDayTs = nextDayMoonset.getTime();
                              
                              // Use next day if it's closer to the weather time range
                              if (Math.abs(nextDayTs - weatherStartTime) < Math.abs(moonsetTs - weatherStartTime)) {
                                moonsetTs = nextDayTs;
                              }
                            }
                            
                            if (moonsetTs >= weatherStartTime && moonsetTs <= weatherEndTime) {
                              moonMarkers.push({
                                timestamp: moonsetTs,
                                time: dayMoon.moonset,
                                type: 'set',
                                phaseName: dayMoon.phaseName,
                                moonphase: dayMoon.moonphase,
                                illumination: dayMoon.illumination
                              });
                            }
                          }
                          
                          // Add moon overhead marker (Major period - moon directly above)
                          if (dayMoon.moonOverhead) {
                            const [hours, minutes, seconds] = dayMoon.moonOverhead.split(':').map(Number);
                            const overheadDate = new Date(dayMoon.date + 'T00:00:00');
                            overheadDate.setHours(hours, minutes, seconds || 0, 0);
                            const overheadTs = overheadDate.getTime();
                            
                            if (overheadTs >= weatherStartTime && overheadTs <= weatherEndTime) {
                              moonMarkers.push({
                                timestamp: overheadTs,
                                time: dayMoon.moonOverhead,
                                type: 'overhead',
                                phaseName: dayMoon.phaseName,
                                moonphase: dayMoon.moonphase,
                                illumination: dayMoon.illumination
                              });
                            }
                          }
                          
                          // Add moon underfoot marker (Major period - moon directly below)
                          if (dayMoon.moonUnderfoot) {
                            const [hours, minutes, seconds] = dayMoon.moonUnderfoot.split(':').map(Number);
                            const underfootDate = new Date(dayMoon.date + 'T00:00:00');
                            underfootDate.setHours(hours, minutes, seconds || 0, 0);
                            let underfootTs = underfootDate.getTime();
                            
                            // Underfoot time might be next day if overhead was in the evening
                            if (hours < 12 && dayMoon.moonOverhead) {
                              const [ovH] = dayMoon.moonOverhead.split(':').map(Number);
                              if (ovH > 12) {
                                underfootDate.setDate(underfootDate.getDate() + 1);
                                underfootTs = underfootDate.getTime();
                              }
                            }
                            
                            if (underfootTs >= weatherStartTime && underfootTs <= weatherEndTime) {
                              moonMarkers.push({
                                timestamp: underfootTs,
                                time: dayMoon.moonUnderfoot,
                                type: 'underfoot',
                                phaseName: dayMoon.phaseName,
                                moonphase: dayMoon.moonphase,
                                illumination: dayMoon.illumination
                              });
                            }
                          }
                        });
                        
                        // CRITICAL: Sort moonMarkers chronologically after all timestamps (including adjusted moonsets) are finalized
                        moonMarkers.sort((a, b) => a.timestamp - b.timestamp);
                        
                        console.log('[Moon] Rendering', moonMarkers.length, 'moon rise/set markers (sorted) and', dailyMoonPhases.length, 'daily moon phases');
                      }
                      
                      // Build daylight periods for background shading (ALWAYS - independent of metric selection)
                      const daylightPeriods: any[] = [];
                      
                      if (moonData && finalChartData.length > 0) {
                        // Use timezone from moon phases API (Visual Crossing returns sunrise/sunset in local time)
                        const sunTimezone = moonTimezone;
                        
                        // Compute chart bounds using Luxon with UTC zone for consistent comparison
                        const weatherStartTime = DateTime.fromISO(finalChartData[0].datetime, { zone: 'utc' }).toMillis();
                        const weatherEndTime = DateTime.fromISO(finalChartData[finalChartData.length - 1].datetime, { zone: 'utc' }).toMillis();
                        
                        moonData.forEach((dayMoon: any) => {
                          const dayDate = dayMoon.date; // e.g., "2025-12-01"
                          const dateStr = dayDate.split('T')[0]; // Ensure we have just the date part
                          
                          // Build daylight period for background shading (sunrise to sunset)
                          if (dayMoon.sunrise && dayMoon.sunset) {
                            // Parse both times in location's timezone, convert to UTC milliseconds
                            const sunriseDt = DateTime.fromISO(`${dateStr}T${dayMoon.sunrise}`, { zone: sunTimezone });
                            const sunsetDt = DateTime.fromISO(`${dateStr}T${dayMoon.sunset}`, { zone: sunTimezone });
                            const sunriseTs = sunriseDt.toMillis();
                            const sunsetTs = sunsetDt.toMillis();
                            
                            // Only add if it overlaps with our chart time range
                            if (sunsetTs >= weatherStartTime && sunriseTs <= weatherEndTime) {
                              // Clamp to chart bounds
                              const clampedStart = Math.max(sunriseTs, weatherStartTime);
                              const clampedEnd = Math.min(sunsetTs, weatherEndTime);
                              
                              // Use timestamps directly for time-domain X-axis
                              daylightPeriods.push({
                                date: dayDate,
                                startTs: clampedStart,
                                endTs: clampedEnd,
                                sunriseTs,
                                sunsetTs
                              });
                            }
                          }
                        });
                      }
                      
                      // Build sunrise/sunset markers ONLY when sun metric is selected
                      const sunMarkers: any[] = [];
                      const hasSunSelected = selectedMetrics.includes('sun');
                      
                      if (hasSunSelected && moonData && finalChartData.length > 0) {
                        // Use timezone from moon phases API
                        const sunTimezone = moonTimezone;
                        
                        // Compute chart bounds using Luxon with UTC zone for consistent comparison
                        const weatherStartTime = DateTime.fromISO(finalChartData[0].datetime, { zone: 'utc' }).toMillis();
                        const weatherEndTime = DateTime.fromISO(finalChartData[finalChartData.length - 1].datetime, { zone: 'utc' }).toMillis();
                        
                        moonData.forEach((dayMoon: any) => {
                          const dayDate = dayMoon.date;
                          const dateStr = dayDate.split('T')[0];
                          
                          // Add sunrise marker - parse in location's timezone, convert to UTC ISO string
                          if (dayMoon.sunrise) {
                            const sunriseDt = DateTime.fromISO(`${dateStr}T${dayMoon.sunrise}`, { zone: sunTimezone });
                            const sunriseUtcIso = sunriseDt.toUTC().toISO();
                            const sunriseTs = sunriseDt.toMillis();
                            
                            if (sunriseTs >= weatherStartTime && sunriseTs <= weatherEndTime) {
                              sunMarkers.push({
                                timestamp: sunriseUtcIso,
                                time: dayMoon.sunrise,
                                type: 'sunrise',
                                date: dayDate
                              });
                            }
                          }
                          
                          // Add sunset marker - parse in location's timezone, convert to UTC ISO string
                          if (dayMoon.sunset) {
                            const sunsetDt = DateTime.fromISO(`${dateStr}T${dayMoon.sunset}`, { zone: sunTimezone });
                            const sunsetUtcIso = sunsetDt.toUTC().toISO();
                            const sunsetTs = sunsetDt.toMillis();
                            
                            if (sunsetTs >= weatherStartTime && sunsetTs <= weatherEndTime) {
                              sunMarkers.push({
                                timestamp: sunsetUtcIso,
                                time: dayMoon.sunset,
                                type: 'sunset',
                                date: dayDate
                              });
                            }
                          }
                        });
                        
                        // Sort sun markers chronologically
                        sunMarkers.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
                        
                        console.log('[Sun] Rendering', sunMarkers.length, 'sunrise/sunset markers and', daylightPeriods.length, 'daylight periods');
                      }
                      
                      // Build solunar data (moon altitude curve & feeding periods) when solunar metric is selected
                      let feedingPeriodBands: any[] = [];
                      
                      if (hasSolunar && solunarData && moonData && Array.isArray(moonData) && finalChartData.length > 0) {
                        const weatherStartTime = new Date(finalChartData[0].datetime).getTime();
                        const weatherEndTime = new Date(finalChartData[finalChartData.length - 1].datetime).getTime();
                        
                        // Flatten all moon altitude samples from all days and sort by timestamp
                        let allSamples: MoonAltitudeSample[] = [];
                        solunarData.forEach((day: SolunarData) => {
                          allSamples = allSamples.concat(day.moonAltitudes);
                        });
                        allSamples.sort((a, b) => a.timestamp - b.timestamp);
                        
                        // Interpolate moon altitude for EVERY hour in finalChartData
                        finalChartData.forEach((hour: any, idx: number) => {
                          const hourTs = new Date(hour.datetime).getTime();
                          
                          // Find bracketing samples for interpolation
                          let before: MoonAltitudeSample | null = null;
                          let after: MoonAltitudeSample | null = null;
                          
                          for (const sample of allSamples) {
                            if (sample.timestamp <= hourTs) {
                              before = sample;
                            }
                            if (sample.timestamp >= hourTs && !after) {
                              after = sample;
                              break;
                            }
                          }
                          
                          // Interpolate between before and after samples
                          if (before && after && before.timestamp !== after.timestamp) {
                            const ratio = (hourTs - before.timestamp) / (after.timestamp - before.timestamp);
                            hour.moonAltitude = before.altitude + ratio * (after.altitude - before.altitude);
                          } else if (before) {
                            hour.moonAltitude = before.altitude;
                          } else if (after) {
                            hour.moonAltitude = after.altitude;
                          } else {
                            hour.moonAltitude = 0;
                          }
                        });
                        
                        // Build feeding period bands using timestamps for time-domain X-axis
                        // Filter to only show periods during daylight hours (sunrise to sunset)
                        solunarData.forEach((daySolunar: SolunarData) => {
                          // Find sunrise/sunset for this day from moonData
                          const dayDate = new Date(daySolunar.date);
                          const moonDay = moonData.find((m: any) => 
                            new Date(m.date).toDateString() === dayDate.toDateString()
                          );
                          
                          if (!moonDay || !moonDay.sunrise || !moonDay.sunset) {
                            // Skip this day if we don't have sunrise/sunset data
                            return;
                          }
                          
                          // Parse sunrise/sunset in the location's timezone
                          const dateStr = daySolunar.date.split('T')[0];
                          const sunriseDt = DateTime.fromISO(`${dateStr}T${moonDay.sunrise}`, { zone: moonTimezone });
                          const sunsetDt = DateTime.fromISO(`${dateStr}T${moonDay.sunset}`, { zone: moonTimezone });
                          const sunriseTs = sunriseDt.toMillis();
                          const sunsetTs = sunsetDt.toMillis();
                          
                          daySolunar.feedingPeriods.forEach((period: FeedingPeriod) => {
                            // Only show bands that overlap with our chart time range
                            if (period.endTimestamp >= weatherStartTime && period.startTimestamp <= weatherEndTime) {
                              // Show ALL periods on the chart (day or night)
                              // Clamp only to chart time bounds (not daylight hours)
                              const clampedStart = Math.max(
                                period.startTimestamp, 
                                weatherStartTime
                              );
                              const clampedEnd = Math.min(
                                period.endTimestamp, 
                                weatherEndTime
                              );
                              
                              // Use timestamps directly for time-domain X-axis
                              feedingPeriodBands.push({
                                ...period,
                                date: daySolunar.date, // Add date for matching with fishing windows
                                startTs: clampedStart,
                                endTs: clampedEnd,
                                // Include sunrise/sunset for visual reference if needed
                                sunriseTs,
                                sunsetTs
                              });
                            }
                          });
                        });
                        
                        console.log('[Solunar] Loaded', feedingPeriodBands.length, 'feeding period bands, altitude samples:', allSamples.length);
                        console.log('[Solunar] Feeding periods:', feedingPeriodBands.map((p: any) => ({
                          type: p.type,
                          event: p.event,
                          startTs: p.startTs,
                          endTs: p.endTs,
                          centerTime: p.centerTime
                        })));
                      }
                      
                      // Chart configuration - responsive margins
                      // Add left margin on mobile to accommodate NOW label
                      // Increased bottom margin to prevent solunar curve from overlapping timeline
                      const chartMargin = isMobile 
                        ? { top: 3, right: 10, bottom: 25, left: 35 }
                        : { top: 10, right: 5, bottom: 30, left: 40 };
                      const chartHeight = isMobile ? 280 : 320;
                      
                      return (
                        <div className="relative" style={{ width: chartWidth, height: chartHeight }}>
                          {/* Main weather metrics chart - fixed width for horizontal scrolling */}
                          <ResponsiveContainer width={chartWidth} height="100%">
                            <ComposedChart data={finalChartData} margin={chartMargin}>
                              <defs>
                            {configs.map(config => (
                              <linearGradient key={`gradient-${config.metric}`} id={`gradient-${config.metric}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={config.leftColor} stopOpacity={0.3}/>
                                <stop offset="95%" stopColor={config.leftColor} stopOpacity={0}/>
                              </linearGradient>
                            ))}
                            {hasPrecip && (
                              <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#22d3ee" stopOpacity={1}/>
                                <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.5}/>
                              </linearGradient>
                            )}
                          </defs>
                          
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                          
                          {/* Background date labels - one centered label per day */}
                          {(() => {
                            // Calculate Y axis range for positioning ReferenceAreas
                            const leftAxisMin = 0;
                            const leftAxisMax = 100;
                            
                            return daySegments.map((segment, idx) => (
                              <ReferenceArea
                                key={`day-label-${idx}`}
                                x1={segment.start}
                                x2={segment.end}
                                y1={leftAxisMin}
                                y2={leftAxisMax}
                                yAxisId="left"
                                fillOpacity={0}
                                strokeOpacity={0}
                                ifOverflow="extendDomain"
                              >
                                <Label
                                  value={segment.label.toUpperCase()}
                                  position="center"
                                  fill="rgba(148, 163, 184, 0.65)"
                                  fontSize={isMobile ? 22 : 32}
                                  fontWeight="bold"
                                />
                              </ReferenceArea>
                            ));
                          })()}
                          
                          {/* Day separator lines at day boundaries */}
                          {daySegments.slice(1).map((segment, idx) => (
                            <ReferenceLine
                              key={`day-sep-${idx}`}
                              x={segment.start}
                              stroke="rgba(148, 163, 184, 0.5)"
                              strokeWidth={2}
                              yAxisId="left"
                              ifOverflow="extendDomain"
                            />
                          ))}
                          
                          {/* Daylight background shading - lighter area between sunrise and sunset */}
                          {daylightPeriods.map((period, idx) => (
                            <ReferenceArea
                              key={`daylight-${idx}`}
                              x1={period.startTs}
                              x2={period.endTs}
                              y1={0}
                              y2={100}
                              yAxisId="left"
                              fill="rgba(148, 163, 184, 0.15)"
                              fillOpacity={1}
                              strokeOpacity={0}
                            />
                          ))}
                          
                          <XAxis 
                            dataKey="timestamp"
                            type="number"
                            scale="time"
                            domain={[finalChartData[0]?.timestamp || 0, finalChartData[finalChartData.length - 1]?.timestamp || 0]}
                            stroke="#94a3b8" 
                            tickLine={false} 
                            axisLine={false}
                            interval={0}
                            ticks={(() => {
                              // Show all even hours (0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22)
                              return finalChartData.filter((d: any) => {
                                if (!d.datetime) return false;
                                const hour = new Date(d.datetime).getHours();
                                return hour % 2 === 0;
                              }).map((d: any) => d.timestamp);
                            })()}
                            tick={(props: any) => {
                              const { x, y, payload } = props;
                              // Find the hour that matches this timestamp
                              const hour = finalChartData.find((d: any) => d.timestamp === payload.value);
                              if (!hour) return <g />;
                              
                              const displayTime = hour.displayTime || '';
                              
                              return (
                                <text
                                  x={x}
                                  y={y + (isMobile ? 12 : 16)}
                                  textAnchor="middle"
                                  fill="#94a3b8"
                                  fontSize={isMobile ? 11 : 11}
                                  fontWeight="normal"
                                >
                                  {displayTime}
                                </text>
                              );
                            }}
                          />
                          
                          <YAxis 
                            yAxisId="left" 
                            orientation="left" 
                            stroke="#94a3b8"
                            fontSize={isMobile ? 8 : 12}
                            tickLine={false} 
                            axisLine={false}
                            width={isMobile ? 18 : 40}
                            domain={[0, 100]}
                            hide={true}
                            ticks={isMobile ? [0, 50, 100] : undefined}
                          />
                          
                          <YAxis 
                            yAxisId="right" 
                            orientation="right" 
                            stroke="#22d3ee" 
                            fontSize={isMobile ? 8 : 12}
                            tickFormatter={(val) => isMobile ? `${val}"` : `${val}"`}
                            tickLine={false} 
                            axisLine={false}
                            domain={precipDomain}
                            allowDataOverflow={false}
                            hide={true}
                            width={isMobile ? 0 : 50}
                            label={!isMobile && hasPrecip ? { value: 'Amount', angle: 90, position: 'insideRight', fill: '#22d3ee', fontSize: 10, dy: 40 } : undefined}
                          />
                          
                          {/* Solunar Y-axis for moon altitude curve and feeding periods */}
                          <YAxis 
                            yAxisId="solunar"
                            orientation="right"
                            domain={[0, 100]}
                            hide={true}
                          />
                          
                          {/* Tide Y-axis for tide height line */}
                          <YAxis 
                            yAxisId="tide"
                            orientation="right"
                            hide={true}
                          />
                          
                          <Tooltip 
                            wrapperStyle={{ zIndex: 1000, outline: 'none', pointerEvents: 'auto' }}
                            cursor={tooltipVisible ? { stroke: '#475569', strokeWidth: 1, strokeDasharray: '3 3' } : false}
                            isAnimationActive={false}
                            allowEscapeViewBox={{ x: true, y: false }}
                            content={({ active, payload, coordinate }) => {
                              if (!tooltipVisible || !active || !payload || payload.length === 0) {
                                return null;
                              }
                              
                              const hour = payload[0]?.payload;
                                
                                // Format the datetime nicely: "11/29 Tue 3pm"
                                let formattedTime = '';
                                if (hour.datetime) {
                                  const date = new Date(hour.datetime);
                                  const month = date.getMonth() + 1;
                                  const day = date.getDate();
                                  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
                                  const hourNum = date.getHours();
                                  const ampm = hourNum >= 12 ? 'pm' : 'am';
                                  const hour12 = hourNum % 12 || 12;
                                  formattedTime = `${month}/${day} ${weekday} ${hour12}${ampm}`;
                                }
                                
                                // Look up tide height from tideCurveData if tide is selected
                                let tideHeightFt: number | null = null;
                                let isTideHigh: boolean = false;
                                let isTideLow: boolean = false;
                                let tideCoefficient: number | null = null;
                                let coeffLabel: string | null = null;
                                let coeffColor: string | null = null;
                                
                                // Look up moon rise/set times if tide is selected
                                let nearbyMoonRise: string | null = null;
                                let nearbyMoonSet: string | null = null;
                                let moonPhaseName: string | null = null;
                                
                                if (hasTide && hour.datetime && tideCurveData.length > 0) {
                                  const hourTs = new Date(hour.datetime).getTime();
                                  
                                  // Find the closest tide prediction within 30 minutes
                                  let closestTide: any = null;
                                  let minDiff = Infinity;
                                  
                                  for (const tide of tideCurveData) {
                                    const diff = Math.abs(tide.timestamp - hourTs);
                                    if (diff < minDiff && diff < 30 * 60 * 1000) {
                                      minDiff = diff;
                                      closestTide = tide;
                                    }
                                  }
                                  
                                  if (closestTide) {
                                    tideHeightFt = closestTide.height;
                                    
                                    // Check if this is a high/low tide marker
                                    for (const marker of tideMarkers) {
                                      if (Math.abs(marker.timestamp - hourTs) < 30 * 60 * 1000) {
                                        if (marker.isHigh) isTideHigh = true;
                                        else isTideLow = true;
                                        break;
                                      }
                                    }
                                  }
                                  
                                  // Find the closest coefficient data point
                                  if (coefficientData.length > 0) {
                                    let closestCoeff: any = null;
                                    let minCoeffDiff = Infinity;
                                    
                                    for (const coeff of coefficientData) {
                                      const diff = Math.abs(coeff.timestamp - hourTs);
                                      if (diff < minCoeffDiff) {
                                        minCoeffDiff = diff;
                                        closestCoeff = coeff;
                                      }
                                    }
                                    
                                    if (closestCoeff) {
                                      tideCoefficient = closestCoeff.coefficient;
                                      coeffLabel = closestCoeff.label;
                                      coeffColor = closestCoeff.color;
                                    }
                                  }
                                  
                                  // Find moon rise/set times for today (within 12 hours before or after)
                                  for (const marker of moonMarkers) {
                                    const timeDiff = marker.timestamp - hourTs;
                                    if (Math.abs(timeDiff) < 12 * 60 * 60 * 1000) {
                                      if (marker.type === 'rise' && !nearbyMoonRise) {
                                        nearbyMoonRise = marker.time;
                                        moonPhaseName = marker.phaseName;
                                      } else if (marker.type === 'set' && !nearbyMoonSet) {
                                        nearbyMoonSet = marker.time;
                                        if (!moonPhaseName) moonPhaseName = marker.phaseName;
                                      }
                                    }
                                  }
                                }
                                
                                // Smart tooltip positioning to prevent cutoff on either edge
                                // When showing precipitation 15-min button, center tooltip over the hour
                                // Otherwise, position to the side of selection
                                const hasPrecipButton = selectedMetrics.includes('precip');
                                const tooltipWidth = isMobile ? 160 : 220;
                                const scrollLeft = chartScrollRef.current?.scrollLeft || 0;
                                const containerWidth = chartScrollRef.current?.clientWidth || 400;
                                const xPos = coordinate?.x || 0;
                                
                                // Calculate position relative to visible viewport
                                const visibleXPos = xPos - scrollLeft;
                                const centerOfView = containerWidth / 2;
                                
                                // Determine tooltip position
                                let tooltipTransform: string;
                                let tooltipMargin: string;
                                let connectorLeft: string;
                                
                                if (hasPrecipButton) {
                                  // Center tooltip over the selected hour when showing precipitation detail button
                                  tooltipTransform = 'translateX(-50%)';
                                  tooltipMargin = '0';
                                  connectorLeft = '50%';
                                } else {
                                  // Default to side placement
                                  tooltipTransform = 'translateX(20px)'; // Default: right side
                                  tooltipMargin = '0';
                                  connectorLeft = '0';
                                  
                                  // Check if we're in the right half of the screen
                                  if (visibleXPos > centerOfView) {
                                    // Show tooltip on LEFT side
                                    tooltipTransform = 'translateX(-100%)';
                                    tooltipMargin = '-20px';
                                    connectorLeft = '100%';
                                  } else {
                                    // Show tooltip on RIGHT side
                                    tooltipTransform = 'translateX(20px)';
                                    tooltipMargin = '0';
                                    connectorLeft = '0';
                                  }
                                  
                                  // Edge case: if too close to left edge, force right side
                                  if (visibleXPos < 50) {
                                    tooltipTransform = 'translateX(20px)';
                                    tooltipMargin = '0';
                                    connectorLeft = '0';
                                  }
                                  // Edge case: if too close to right edge, force left side
                                  else if (visibleXPos > containerWidth - 50) {
                                    tooltipTransform = 'translateX(-100%)';
                                    tooltipMargin = '-20px';
                                    connectorLeft = '100%';
                                  }
                                }
                                
                                return (
                                  <div className="relative">
                                    {/* Connector line from tooltip to chart point */}
                                    <div 
                                      className="absolute w-0.5 bg-gradient-to-b from-slate-500 to-transparent"
                                      style={{
                                        left: connectorLeft,
                                        top: '100%',
                                        height: '25px',
                                        transform: 'translateX(-50%)'
                                      }}
                                    />
                                    {/* Tooltip content */}
                                    <div 
                                      className={`border border-slate-600 rounded-lg shadow-2xl ${isMobile ? 'p-1.5 text-[10px]' : 'p-3 text-xs'} relative`}
                                      style={{
                                        transform: tooltipTransform,
                                        marginLeft: tooltipMargin,
                                        backgroundColor: '#0f172a',
                                        opacity: 1,
                                        pointerEvents: 'auto'
                                      }}
                                    >
                                      {/* Close button for mobile */}
                                      {isMobile && (
                                        <button
                                          className="absolute -top-2 -right-2 w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center text-slate-300 text-lg font-bold pointer-events-auto shadow-lg border-2 border-slate-600"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            e.preventDefault();
                                            setTooltipVisible(false);
                                          }}
                                          onTouchEnd={(e) => {
                                            e.stopPropagation();
                                            e.preventDefault();
                                            setTooltipVisible(false);
                                          }}
                                          style={{ touchAction: 'none' }}
                                        >
                                          ×
                                        </button>
                                      )}
                                      <p className={`font-bold ${isMobile ? 'mb-1.5 text-base' : 'mb-2 text-sm'}`}>
                                        <span className="text-slate-200">{formattedTime.split(' ').slice(0, 2).join(' ')} </span>
                                        <span className="text-yellow-400 text-lg">{formattedTime.split(' ')[2]}</span>
                                      </p>
                                    <div className={isMobile ? 'space-y-0' : 'space-y-1'}>
                                      {/* Always show tide data when available */}
                                      {hasTide && tideHeightFt !== null && (
                                        <div>
                                          <p style={{ color: '#3b82f6' }} className={`flex justify-between ${isMobile ? 'gap-2' : 'gap-4'}`}>
                                            <span>Tide Height:</span>
                                            <span className="font-mono font-bold">
                                              {tideHeightFt.toFixed(2)}ft
                                              {isTideHigh && <span className="ml-1 text-green-400">H</span>}
                                              {isTideLow && <span className="ml-1 text-amber-400">L</span>}
                                            </span>
                                          </p>
                                          {tideCoefficient !== null && (
                                            <p style={{ color: coeffColor || '#888' }} className={`flex justify-between ${isMobile ? 'gap-2' : 'gap-4'}`}>
                                              <span>Coefficient:</span>
                                              <span className="font-mono font-bold">
                                                {tideCoefficient} <span className="text-xs opacity-80">({coeffLabel})</span>
                                              </span>
                                            </p>
                                          )}
                                        </div>
                                      )}
                                      {/* Solunar feeding periods when selected */}
                                      {hasSolunar && feedingPeriodBands.length > 0 && hour.datetime && (() => {
                                        const hourTs = new Date(hour.datetime).getTime();
                                        
                                        // Find all feeding periods that contain this hour
                                        const activePeriodsAtHour = feedingPeriodBands.filter((period: any) => 
                                          hourTs >= period.startTs && hourTs <= period.endTs
                                        );
                                        
                                        // Also find next upcoming periods (within 6 hours)
                                        const sixHoursLater = hourTs + (6 * 60 * 60 * 1000);
                                        const upcomingPeriods = feedingPeriodBands.filter((period: any) => 
                                          period.startTs > hourTs && period.startTs <= sixHoursLater
                                        ).slice(0, 2);
                                        
                                        // Format timestamp to 12-hour format
                                        const formatTimestamp12h = (ts: number) => {
                                          const date = new Date(ts);
                                          const h = date.getHours();
                                          const m = date.getMinutes();
                                          const ampm = h >= 12 ? 'pm' : 'am';
                                          const hour12 = h % 12 || 12;
                                          return `${hour12}:${m.toString().padStart(2, '0')}${ampm}`;
                                        };
                                        
                                        // Get event label (short version for start/end display)
                                        const getEventLabel = (event: string) => {
                                          switch (event) {
                                            case 'overhead': return 'Moon Overhead';
                                            case 'underfoot': return 'Moon Underfoot';
                                            case 'rise': return 'Moonrise';
                                            case 'set': return 'Moonset';
                                            default: return event;
                                          }
                                        };
                                        
                                        // Get moon illumination for the current hour
                                        let moonIllumination: number | null = null;
                                        if (moonData && moonData.length > 0) {
                                          const hourDate = new Date(hour.datetime);
                                          const matchingDay = moonData.find((day: any) => {
                                            const dayDate = new Date(day.date);
                                            return dayDate.toDateString() === hourDate.toDateString();
                                          });
                                          if (matchingDay && matchingDay.moonphase !== undefined) {
                                            // moonphase is 0-1, convert to illumination %
                                            // 0 = new moon (0%), 0.5 = full moon (100%), 1 = new moon again
                                            const phase = matchingDay.moonphase;
                                            moonIllumination = Math.round(Math.abs(Math.sin(phase * Math.PI)) * 100);
                                          }
                                        }
                                        
                                        if (activePeriodsAtHour.length === 0 && upcomingPeriods.length === 0) {
                                          return null;
                                        }
                                        
                                        return (
                                          <div className="pt-1 border-t border-slate-800 mt-1">
                                            {/* Moon illumination */}
                                            {moonIllumination !== null && (
                                              <p style={{ color: '#a78bfa' }} className={`flex justify-between ${isMobile ? 'gap-2' : 'gap-4'} text-[10px] mb-1`}>
                                                <span>Moon Illumination:</span>
                                                <span className="font-mono font-bold">{moonIllumination}%</span>
                                              </p>
                                            )}
                                            {activePeriodsAtHour.map((period: any, idx: number) => {
                                              const isMajor = period.type === 'major';
                                              const color = isMajor ? '#22c55e' : '#fbbf24';
                                              return (
                                                <div key={`active-${idx}`} className="mb-1">
                                                  <p style={{ color }} className={`flex justify-between ${isMobile ? 'gap-2' : 'gap-4'} font-semibold text-sm`}>
                                                    <span>{isMajor ? 'MAJOR' : 'minor'}:</span>
                                                    <span>{getEventLabel(period.event)}</span>
                                                  </p>
                                                  <p style={{ color }} className={`flex justify-between ${isMobile ? 'gap-2' : 'gap-4'} text-sm font-semibold`}>
                                                    <span>Start:</span>
                                                    <span className="font-mono font-bold">{formatTimestamp12h(period.startTimestamp)}</span>
                                                  </p>
                                                  <p style={{ color }} className={`flex justify-between ${isMobile ? 'gap-2' : 'gap-4'} text-sm font-semibold`}>
                                                    <span>End:</span>
                                                    <span className="font-mono font-bold">{formatTimestamp12h(period.endTimestamp)}</span>
                                                  </p>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        );
                                      })()}
                                      {selectedMetrics.map(metric => {
                                        const config = getMetricConfig(metric);
                                        
                                        // Skip tide and solunar metrics since we show them separately above
                                        if (metric === 'tide' || metric === 'solunar') {
                                          return null;
                                        }
                                        
                                        return (
                                          <div key={metric}>
                                            {config.leftKey && (
                                              <p style={{ color: config.leftColor }} className={`flex justify-between ${isMobile ? 'gap-2' : 'gap-4'}`}>
                                                <span>{config.leftLabel}:</span>
                                                <span className="font-mono font-bold">
                                                  {config.leftKey === 'precipProb' 
                                                    ? Math.round(hour[config.leftKey])
                                                    : metric === 'pressure' 
                                                      ? mbToInhg(hour[config.leftKey]).toFixed(2)
                                                      : hour[config.leftKey]}{config.leftUnit}
                                                  {/* Show wind direction next to speed */}
                                                  {metric === 'wind' && hour.windDir !== undefined && (
                                                    <span className="ml-1 text-amber-400">{degToCompass(hour.windDir)}</span>
                                                  )}
                                                </span>
                                              </p>
                                            )}
                                            {config.rightKey && metric === 'precip' && (
                                              <>
                                                <p style={{ color: config.rightColor }} className={`flex justify-between ${isMobile ? 'gap-2' : 'gap-4'}`}>
                                                  <span>{config.rightLabel}:</span>
                                                  <span className="font-mono font-bold">
                                                    {typeof hour[config.rightKey] === 'number' 
                                                      ? hour[config.rightKey].toFixed(2) 
                                                      : hour[config.rightKey]}{config.rightUnit}
                                                  </span>
                                                </p>
                                                {hour.datetime && (
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      e.preventDefault();
                                                      setSelected15MinDatetime(hour.datetime);
                                                      setSelected15MinHourData({
                                                        precip: hour.precipAmount || 0,
                                                        prob: hour.precipProb || 0
                                                      });
                                                      setShow15MinModal(true);
                                                      setTooltipVisible(false);
                                                    }}
                                                    className="mt-1 w-full px-2 py-1 text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded border border-blue-500/30 transition pointer-events-auto"
                                                    data-testid="button-view-15min-detail"
                                                  >
                                                    💧 View 15-min detail
                                                  </button>
                                                )}
                                              </>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  </div>
                                );
                            }}
                          />

                          {hasPrecip && (
                            <Bar 
                              yAxisId="right" 
                              dataKey="precipAmount" 
                              maxBarSize={20} 
                              radius={[4, 4, 0, 0]}
                              fill="url(#barGradient)"
                              animationDuration={1500}
                            />
                          )}

                          {/* Peak precipitation amount markers - show highest rain hour for each day */}
                          {hasPrecip && (
                            <Scatter
                              yAxisId="right"
                              dataKey="precipAmount"
                              shape={(props: any) => {
                                const { cx, cy, payload } = props;
                                
                                // Only render for peak precipitation hours
                                if (!payload.isPeakPrecip) {
                                  return <g />;
                                }
                                
                                const amount = payload.precipAmount || 0;
                                
                                return (
                                  <g>
                                    {/* Outer glow circle */}
                                    <circle cx={cx} cy={cy} r={8} fill="#22d3ee" opacity={0.3} />
                                    {/* Main marker circle */}
                                    <circle cx={cx} cy={cy} r={5} fill="#22d3ee" stroke="#fff" strokeWidth={2} />
                                    {/* Amount label above the marker */}
                                    <text
                                      x={cx}
                                      y={cy - 12}
                                      textAnchor="middle"
                                      fill="#22d3ee"
                                      fontSize={10}
                                      fontWeight="bold"
                                    >
                                      {amount.toFixed(2)}"
                                    </text>
                                  </g>
                                );
                              }}
                            />
                          )}

                          {/* Peak precipitation chance markers - show at same hour as peak amount */}
                          {hasPrecip && (
                            <Scatter
                              yAxisId="left"
                              dataKey="normalized_precipProb"
                              shape={(props: any) => {
                                const { cx, cy, payload } = props;
                                
                                // Only render at peak precipitation amount hour (same as amount marker)
                                if (!payload.isPeakPrecip) {
                                  return <g />;
                                }
                                
                                const chance = payload.precipProb || 0;
                                
                                return (
                                  <g>
                                    {/* Outer glow circle */}
                                    <circle cx={cx} cy={cy} r={8} fill="#60a5fa" opacity={0.3} />
                                    {/* Main marker circle */}
                                    <circle cx={cx} cy={cy} r={5} fill="#60a5fa" stroke="#fff" strokeWidth={2} />
                                    {/* Chance label above the marker */}
                                    <text
                                      x={cx}
                                      y={cy - 12}
                                      textAnchor="middle"
                                      fill="#60a5fa"
                                      fontSize={10}
                                      fontWeight="bold"
                                    >
                                      {Math.round(chance)}%
                                    </text>
                                  </g>
                                );
                              }}
                            />
                          )}
                          
                          {configs.filter(config => config.metric !== 'tide').map((config, idx) => {
                            const normalizedKey = `normalized_${config.leftKey}`;
                            return (
                              <Area 
                                key={config.metric}
                                yAxisId="left" 
                                type="monotone" 
                                dataKey={normalizedKey} 
                                stroke={config.leftColor} 
                                strokeWidth={2}
                                fillOpacity={config.metric === 'precip' ? 0.3 : 0.1} 
                                fill={`url(#gradient-${config.metric})`}
                                animationDuration={1500}
                              />
                            );
                          })}
                          
                          {/* Invisible line to activate tooltips when tide is the only selected metric */}
                          {hasTide && (
                            <Line 
                              yAxisId="left" 
                              type="monotone" 
                              dataKey="tideHeight" 
                              stroke="transparent"
                              strokeWidth={2}
                              dot={false}
                              activeDot={false}
                              animationDuration={1500}
                            />
                          )}
                          
                          {/* Invisible line to activate tooltips when solunar is the only selected metric */}
                          {hasSolunar && (
                            <Line 
                              yAxisId="left" 
                              type="monotone" 
                              dataKey="solunarBaseline" 
                              stroke="transparent"
                              strokeWidth={0}
                              dot={false}
                              activeDot={false}
                              animationDuration={0}
                            />
                          )}
                          
                          {selectedMetrics.includes('wind') && (
                            <Scatter
                              yAxisId="left"
                              dataKey="normalized_windSpeed"
                              fill="#3b82f6"
                              shape={(props: any) => {
                                const { cx, cy, payload } = props;
                                if (!payload.windDir) return <g />;
                                
                                // Add 180° so arrow points in direction wind is coming FROM (meteorological convention)
                                const rotation = (payload.windDir + 180) % 360;
                                const arrowY = cy - 20;
                                
                                return (
                                  <g transform={`translate(${cx},${arrowY})`}>
                                    <g transform={`rotate(${rotation})`}>
                                      <path
                                        d="M 0,-8 L 3,-3 L 1,-3 L 1,4 L -1,4 L -1,-3 L -3,-3 Z"
                                        fill="#3b82f6"
                                        stroke="#1e3a8a"
                                        strokeWidth="0.5"
                                      />
                                    </g>
                                  </g>
                                );
                              }}
                            />
                          )}

                          {/* Temperature High/Low Markers on the line - one H and one L per day */}
                          {selectedMetrics.includes('temp') && (() => {
                            const hours = sortedHours;
                            if (!hours || hours.length === 0) return null;
                            
                            // Find high and low temperatures for EACH day (24-hour period)
                            const highLowByDay = new Map<number, { maxTemp: number; minTemp: number; maxTempDatetime: string; minTempDatetime: string }>();
                            
                            hours.forEach(hour => {
                              const dayIdx = hour.dayIndex;
                              if (!highLowByDay.has(dayIdx)) {
                                highLowByDay.set(dayIdx, {
                                  maxTemp: -Infinity,
                                  minTemp: Infinity,
                                  maxTempDatetime: '',
                                  minTempDatetime: ''
                                });
                              }
                              
                              const dayData = highLowByDay.get(dayIdx)!;
                              if (hour.temp > dayData.maxTemp) {
                                dayData.maxTemp = hour.temp;
                                dayData.maxTempDatetime = hour.datetime;
                              }
                              if (hour.temp < dayData.minTemp) {
                                dayData.minTemp = hour.temp;
                                dayData.minTempDatetime = hour.datetime;
                              }
                            });
                            
                            // Build a Set of datetimes that should show H or L markers
                            const highDatetimes = new Set<string>();
                            const lowDatetimes = new Set<string>();
                            highLowByDay.forEach(data => {
                              highDatetimes.add(data.maxTempDatetime);
                              lowDatetimes.add(data.minTempDatetime);
                            });
                            
                            return (
                              <Scatter
                                yAxisId="left"
                                dataKey="normalized_temp"
                                shape={(props: any) => {
                                  const { cx, cy, payload } = props;
                                  const datetime = payload.datetime;
                                  
                                  // Only render for high and low points
                                  const isHigh = highDatetimes.has(datetime);
                                  const isLow = lowDatetimes.has(datetime);
                                  
                                  if (!isHigh && !isLow) {
                                    return <g />;
                                  }
                                  
                                  const color = isHigh ? '#ef4444' : '#3b82f6';
                                  
                                  return (
                                    <g>
                                      <circle cx={cx} cy={cy} r={5} fill={color} stroke="#fff" strokeWidth={1.5} />
                                      <text
                                        x={cx}
                                        y={isHigh ? cy - 10 : cy + 16}
                                        textAnchor="middle"
                                        fill={color}
                                        fontSize={9}
                                        fontWeight="bold"
                                      >
                                        {isHigh ? 'H' : 'L'}
                                      </text>
                                    </g>
                                  );
                                }}
                              />
                            );
                          })()}

                          {/* Sunrise/Sunset Indicators - sun icons with times */}
                          {sunMarkers.map((marker, idx) => {
                            // Convert marker timestamp (UTC ISO string) to milliseconds for time-domain X-axis
                            const markerTs = DateTime.fromISO(marker.timestamp, { zone: 'utc' }).toMillis();
                            
                            const isSunrise = marker.type === 'sunrise';
                            const color = '#f59e0b'; // Amber/orange color for sun
                            
                            // Format time as "7:03a" or "5:23p"
                            const [hours, minutes] = marker.time.split(':').map(Number);
                            const ampm = hours >= 12 ? 'p' : 'a';
                            const hour12 = hours % 12 || 12;
                            const timeLabel = `${hour12}:${minutes.toString().padStart(2, '0')}${ampm}`;
                            
                            return (
                              <ReferenceLine
                                key={`sun-marker-${idx}`}
                                x={markerTs}
                                stroke={color}
                                strokeWidth={1.5}
                                strokeDasharray="3 3"
                                yAxisId="left"
                                label={(props: any) => {
                                  const { viewBox } = props;
                                  const x = viewBox?.x || 0;
                                  const y = viewBox?.y || 0;
                                  const chartHeight = viewBox?.height || 300;
                                  
                                  return (
                                    <g>
                                      {/* Sun icon */}
                                      <circle
                                        cx={x}
                                        cy={y + 8}
                                        r={6}
                                        fill={color}
                                        stroke="#fff"
                                        strokeWidth={1}
                                      />
                                      {/* Sun rays */}
                                      <g stroke={color} strokeWidth={1.5} strokeLinecap="round">
                                        <line x1={x} y1={y + 2} x2={x} y2={y - 1} />
                                        <line x1={x} y1={y + 14} x2={x} y2={y + 17} />
                                        <line x1={x - 6} y1={y + 8} x2={x - 9} y2={y + 8} />
                                        <line x1={x + 6} y1={y + 8} x2={x + 9} y2={y + 8} />
                                        <line x1={x - 4} y1={y + 4} x2={x - 6.5} y2={y + 1.5} />
                                        <line x1={x + 4} y1={y + 4} x2={x + 6.5} y2={y + 1.5} />
                                        <line x1={x - 4} y1={y + 12} x2={x - 6.5} y2={y + 14.5} />
                                        <line x1={x + 4} y1={y + 12} x2={x + 6.5} y2={y + 14.5} />
                                      </g>
                                      {/* Time label */}
                                      <text
                                        x={x}
                                        y={y + 30}
                                        textAnchor="middle"
                                        fill={color}
                                        fontSize={isMobile ? 9 : 10}
                                        fontWeight="bold"
                                      >
                                        {timeLabel}
                                      </text>
                                    </g>
                                  );
                                }}
                              />
                            );
                          })}

                          {/* Solunar feeding period bands - integrated into main chart */}
                          {hasSolunar && feedingPeriodBands.map((period: any, idx: number) => {
                            const isAtPeak = period.event === 'overhead' || period.event === 'underfoot';
                            const isBestWindow = bestFishingWindows.some((window: any) => {
                              // Compare using full timestamps to preserve date information
                              const windowStartTs = DateTime.fromISO(window.startTime, { zone: 'utc' }).toMillis();
                              const windowEndTs = DateTime.fromISO(window.endTime, { zone: 'utc' }).toMillis();
                              
                              // Check if the solunar period overlaps with the fishing window
                              // Period overlaps window if: period starts before window ends AND period ends after window starts
                              return period.startTs < windowEndTs && period.endTs > windowStartTs;
                            });
                            const bandColor = isAtPeak 
                              ? (isBestWindow ? 'rgba(34, 197, 94, 0.4)' : 'rgba(34, 197, 94, 0.2)')
                              : (isBestWindow ? 'rgba(251, 191, 36, 0.3)' : 'rgba(251, 191, 36, 0.15)');
                            const strokeColor = isAtPeak ? '#22c55e' : '#fbbf24';
                            const strokeOpacity = isBestWindow ? 0.8 : 0.5;
                            const strokeWidth = isBestWindow ? 2 : 1;
                            return (
                              <ReferenceArea
                                key={`feeding-band-${idx}`}
                                yAxisId="solunar"
                                x1={period.startTs}
                                x2={period.endTs}
                                y1={0}
                                y2={100}
                                fill={bandColor}
                                stroke={strokeColor}
                                strokeOpacity={strokeOpacity}
                                strokeWidth={strokeWidth}
                                strokeDasharray={isAtPeak ? undefined : '4 2'}
                              />
                            );
                          })}

                          {/* Moon altitude curve - integrated into main chart */}
                          {hasSolunar && (
                            <Line 
                              yAxisId="solunar" 
                              type="natural"
                              dataKey="moonAltitude"
                              stroke="#a855f7"
                              strokeWidth={2}
                              strokeDasharray="6 4"
                              dot={false}
                              isAnimationActive={false}
                              connectNulls={false}
                            />
                          )}

                          {/* Moon phase indicators at overhead positions (peaks) */}
                          {(() => {
                            if (!hasSolunar || !moonMarkers || moonMarkers.length === 0) return null;
                            
                            const overheadMarkers = moonMarkers.filter((marker: any) => marker.type === 'overhead');
                            console.log('[MoonPhase] Total moonMarkers:', moonMarkers.length, 'Overhead markers:', overheadMarkers.length);
                            
                            if (overheadMarkers.length > 0) {
                              console.log('[MoonPhase] First overhead marker:', overheadMarkers[0]);
                            }
                            
                            return null;
                          })()}

                          {/* Tide height curve - integrated into main chart using tideHeight merged data */}
                          {hasTide && (
                            <Line 
                              yAxisId="tide" 
                              type="natural"
                              dataKey="tideHeight"
                              stroke="#3b82f6"
                              strokeWidth={2.5}
                              dot={false}
                              isAnimationActive={false}
                              connectNulls={true}
                            />
                          )}

                          {/* High/Low Tide Markers - integrated into main chart */}
                          {hasTide && tideMarkers.map((marker: any, idx: number) => (
                            <ReferenceDot
                              key={`tide-marker-${idx}`}
                              yAxisId="tide"
                              x={marker.timestamp}
                              y={marker.height}
                              r={6}
                              fill={marker.isHigh ? '#10b981' : '#f59e0b'}
                              stroke="#fff"
                              strokeWidth={2}
                              label={{
                                value: marker.isHigh ? 'H' : 'L',
                                position: marker.isHigh ? 'top' : 'bottom',
                                fill: marker.isHigh ? '#10b981' : '#f59e0b',
                                fontSize: 9,
                                fontWeight: 'bold',
                                dy: marker.isHigh ? -4 : 4
                              }}
                            />
                          ))}

                          {/* "Now" indicator line - find current hour in chart data */}
                          {(() => {
                            const now = new Date();
                            const nowTime = now.getTime();
                            
                            // Find the closest hour to now in finalChartData
                            let closestTimestamp = -1;
                            let minDiff = Infinity;
                            
                            finalChartData.forEach((hour: any) => {
                              if (!hour.datetime) return;
                              const hourTime = new Date(hour.datetime).getTime();
                              const diff = Math.abs(hourTime - nowTime);
                              if (diff < minDiff && diff < 30 * 60 * 1000) { // Within 30 min
                                minDiff = diff;
                                closestTimestamp = hour.timestamp;
                              }
                            });
                            
                            if (closestTimestamp === -1) return null;
                            
                            return (
                              <ReferenceLine
                                x={closestTimestamp}
                                stroke="#ef4444"
                                strokeWidth={2}
                                strokeDasharray="4 4"
                                yAxisId="left"
                                label={(props: any) => {
                                  const { viewBox } = props;
                                  const x = viewBox?.x || 0;
                                  const y = viewBox?.y || 0;
                                  return (
                                    <text
                                      x={x + 3}
                                      y={y + 12}
                                      fill="#ef4444"
                                      fontSize={isMobile ? 10 : 12}
                                      fontWeight="bold"
                                    >
                                      NOW
                                    </text>
                                  );
                                }}
                              />
                            );
                          })()}
                        </ComposedChart>
                      </ResponsiveContainer>
                      
                      {/* Tidal Coefficient overlay chart - color-coded bar showing fishing quality */}
                      {hasTide && coefficientData.length > 1 && (
                        <div className="absolute left-0 right-0 pointer-events-none" style={{ top: '8px', height: '24px' }}>
                          <ResponsiveContainer width={chartWidth} height={24}>
                            <AreaChart data={coefficientData} margin={{ ...chartMargin, top: 2, bottom: 2 }}>
                              <defs>
                                <linearGradient id="coeffGradient" x1="0" y1="0" x2="1" y2="0">
                                  {coefficientData.map((point: any, idx: number) => (
                                    <stop 
                                      key={`coeff-stop-${idx}`}
                                      offset={`${(idx / (coefficientData.length - 1)) * 100}%`} 
                                      stopColor={point.color} 
                                      stopOpacity={0.7}
                                    />
                                  ))}
                                </linearGradient>
                              </defs>
                              <XAxis 
                                dataKey="timestamp" 
                                type="number"
                                domain={[tideStartTime, tideEndTime]}
                                hide={true}
                              />
                              <YAxis 
                                yAxisId="coeff"
                                orientation="right"
                                domain={[0, 150]}
                                hide={true}
                              />
                              <Area 
                                yAxisId="coeff"
                                type="monotone"
                                dataKey="coefficient"
                                stroke="url(#coeffGradient)"
                                strokeWidth={2}
                                fill="url(#coeffGradient)"
                                isAnimationActive={false}
                              />
                              {/* Add coefficient value labels at peaks and valleys */}
                              {(() => {
                                // Find local peaks and valleys to show labels
                                const labelPoints: any[] = [];
                                for (let i = 0; i < coefficientData.length; i++) {
                                  const curr = coefficientData[i];
                                  const prev = coefficientData[i - 1];
                                  const next = coefficientData[i + 1];
                                  
                                  // Always show first and last
                                  if (i === 0 || i === coefficientData.length - 1) {
                                    labelPoints.push({ ...curr, index: i });
                                  }
                                  // Show peaks (higher than both neighbors)
                                  else if (prev && next && curr.coefficient > prev.coefficient && curr.coefficient > next.coefficient) {
                                    labelPoints.push({ ...curr, index: i, isPeak: true });
                                  }
                                  // Show valleys (lower than both neighbors)
                                  else if (prev && next && curr.coefficient < prev.coefficient && curr.coefficient < next.coefficient) {
                                    labelPoints.push({ ...curr, index: i, isValley: true });
                                  }
                                }
                                
                                return labelPoints.map((point: any, idx: number) => (
                                  <text
                                    key={`coeff-label-${idx}`}
                                    x={point.timestamp}
                                    y={point.isPeak ? 8 : 20}
                                    textAnchor="middle"
                                    fill="#fff"
                                    fontSize="8"
                                    fontWeight="bold"
                                    style={{ textShadow: '0 0 3px rgba(0,0,0,0.8)' }}
                                  >
                                    {Math.round(point.coefficient)}%
                                  </text>
                                ));
                              })()}
                            </AreaChart>
                          </ResponsiveContainer>
                          {/* Coefficient legend */}
                          <div className="absolute -top-1 right-2 flex items-center gap-1 text-[7px] font-medium bg-background/80 px-1 rounded">
                            <span className="text-muted-foreground">Tide Coeff:</span>
                            <span style={{ color: '#22c55e' }}>●Exc</span>
                            <span style={{ color: '#84cc16' }}>●Good</span>
                            <span style={{ color: '#facc15' }}>●Fair</span>
                            <span style={{ color: '#f97316' }}>●Poor</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
                </div>
              </div>
              
              {/* Legend - Condensed for mobile */}
              {selectedMetrics.length > 0 && (
                <div className="px-2 md:px-4 py-1 md:pb-2 flex flex-wrap gap-1.5 md:gap-3 justify-center items-center text-[9px] md:text-[10px]">
                  {selectedMetrics.map(metric => {
                    const config = getMetricConfig(metric);
                    return (
                      <div key={metric} className="flex items-center gap-0.5 md:gap-1">
                        <div className="w-2 h-0.5 rounded" style={{ backgroundColor: config.leftColor }}></div>
                        <span className="text-muted-foreground whitespace-nowrap">{config.leftLabel}</span>
                        {metric === 'precip' && config.rightKey && (
                          <>
                            <div className="w-1.5 h-1.5 rounded-sm ml-1" style={{ backgroundColor: config.rightColor }}></div>
                            <span className="text-muted-foreground whitespace-nowrap">{config.rightLabel}</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              
              {/* Solunar Legend - Fishing Major/Minor periods */}
              {(selectedMetrics.includes('tide') || selectedMetrics.includes('solunar')) && (
                <div className="px-2 md:px-4 py-1 flex flex-wrap gap-2 md:gap-4 justify-center items-center text-[9px] md:text-[10px] border-t border-white/5 pt-2">
                  <span className="text-slate-500 font-medium">Fishing:</span>
                  <div className="flex items-center gap-1">
                    <div className="w-4 h-3 rounded" style={{ backgroundColor: 'rgba(34, 197, 94, 0.3)', border: '1px solid #22c55e' }}></div>
                    <span className="text-green-400 font-semibold">MAJOR</span>
                    <span className="text-slate-400">(±1hr)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-4 h-3 rounded" style={{ backgroundColor: 'rgba(251, 191, 36, 0.25)', border: '1px solid #fbbf24' }}></div>
                    <span className="text-yellow-400">minor</span>
                    <span className="text-slate-400">(±30min)</span>
                  </div>
                  {selectedMetrics.includes('solunar') && (
                    <div className="flex items-center gap-1 ml-2">
                      <div className="w-4 h-0.5" style={{ background: 'repeating-linear-gradient(90deg, #a855f7, #a855f7 4px, transparent 4px, transparent 8px)' }}></div>
                      <span className="text-purple-400">Moon altitude</span>
                    </div>
                  )}
                </div>
              )}
              
              {/* Tide Source Attribution */}
              {selectedMetrics.includes('tide') && weatherData.tideStation && weatherData.tideStationName && (
                <div className="px-4 pb-2 text-center text-[10px] text-slate-400">
                  Tide data from{' '}
                  <a 
                    href={`https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=${weatherData.tideStation}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 hover:text-cyan-300 underline"
                  >
                    {weatherData.tideStationName} (NOAA Station {weatherData.tideStation})
                  </a>
                </div>
              )}
              
              {/* Insight Strip */}
              <div className="bg-amber-100 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-500/10 p-4 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-200">
                   <span className="bg-amber-500 w-2 h-2 rounded-full animate-pulse"></span>
                   {displayDays?.[selectedDateIndex] && generateDaySummary(displayDays[selectedDateIndex])}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Radar Map */}
        <section className="animate-in fade-in slide-in-from-bottom-5 duration-700 px-4 sm:px-0" data-tour="radar-map">
          <RadarMap 
            latitude={weatherData.latitude} 
            longitude={weatherData.longitude} 
            isPremium={isPremium}
            isAuthenticated={isAuthenticated}
            onUpgradeClick={() => setShowUpgradeDialog(true)}
          />
        </section>

        {/* Explanation / Legend */}
        <section className="text-center text-sm text-muted-foreground max-w-2xl mx-auto space-y-4">
          <p>
            Visualizing rain probability vs. intensity allows you to distinguish between a 
            <span className="text-blue-400 mx-1">high chance of drizzle</span> and a 
            <span className="text-cyan-400 mx-1">low chance of flooding</span>.
          </p>
          
          <p className="text-xs opacity-60">
            Weather data by <a href="https://www.visualcrossing.com/" target="_blank" rel="noreferrer" className="underline hover:text-white">Visual Crossing</a>
          </p>
        </section>
        </div>
      </div>

      <Footer />

      <UpgradeDialog open={showUpgradeDialog} onOpenChange={setShowUpgradeDialog} />
      <PrecipitationDetailModal
        open={show15MinModal}
        onOpenChange={setShow15MinModal}
        datetime={selected15MinDatetime}
        lat={weatherData?.latitude || 0}
        lon={weatherData?.longitude || 0}
        timezone={weatherData?.timezone}
        hourlyPrecip={selected15MinHourData?.precip}
        hourlyProb={selected15MinHourData?.prob}
      />
      <BiteWeatherModal
        open={biteModalOpen}
        onOpenChange={setBiteModalOpen}
        forecastData={displayDays && displayDays[selectedModalDay] 
          ? getFishingForecastForDay(displayDays[selectedModalDay].fullDate)
          : null}
        onNavigate={(direction) => {
          if (direction === 'prev' && selectedModalDay > 0) {
            setSelectedModalDay(selectedModalDay - 1);
          } else if (direction === 'next' && displayDays && selectedModalDay < displayDays.length - 1) {
            setSelectedModalDay(selectedModalDay + 1);
          }
        }}
        canNavigatePrev={selectedModalDay > 0}
        canNavigateNext={displayDays ? selectedModalDay < displayDays.length - 1 : false}
        timezone={weatherData?.timezone}
      />
      <WelcomeTour ref={tourRef} />
    </div>
  );
}
