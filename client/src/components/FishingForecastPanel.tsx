import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Fish, Star } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface FishingWindow {
  startTime: string;
  endTime: string;
  triggers: string[];
  score: number;
  tideCoeff: number | null;
}

interface DayForecast {
  date: string;
  dayName: string;
  rating: number;
  score: number;
  windows: FishingWindow[];
  tideCoeff: number | null;
  weather: {
    temp: number;
    windSpeed: number;
    windDir?: number;
    clouds: number;
    precip: number;
  };
  note: string;
}

interface FishingForecastPanelProps {
  location: string;
  provider?: string;
}

// Helper to convert degrees to compass direction
const degToCompass = (deg: number) => {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(deg / 22.5) % 16;
  return directions[index];
};

// Helper to format time
const formatTime = (dateStr: string) => {
  const date = new Date(dateStr);
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour12 = h % 12 || 12;
  return `${hour12}:${m.toString().padStart(2, '0')} ${ampm}`;
};

// Helper to render star rating
const renderStars = (rating: number) => {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  const stars = [];
  
  for (let i = 0; i < 5; i++) {
    if (i < fullStars) {
      stars.push('★');
    } else if (i === fullStars && hasHalfStar) {
      stars.push('☆');
    } else {
      stars.push('☆');
    }
  }
  
  return stars.join('');
};

export function FishingForecastPanel({ location, provider = 'visualcrossing' }: FishingForecastPanelProps) {
  const { data, isLoading, error } = useQuery<{ forecast: DayForecast[] }>({
    queryKey: ['fishingForecast', 'v3-daytime-only', location, provider], // v3 = cache bust + daytime filtering
    queryFn: async () => {
      // Add timestamp to bypass ALL caches (Service Worker, HTTP cache, etc.)
      const timestamp = Date.now();
      const url = `/api/forecast/fishing?location=${encodeURIComponent(location)}&provider=${provider}&_t=${timestamp}`;
      console.log('[FishingForecast] Fetching from:', url);
      const response = await fetch(url, { cache: 'no-store' }); // Disable HTTP cache
      if (!response.ok) {
        throw new Error('Failed to fetch fishing forecast');
      }
      const result = await response.json();
      console.log('[FishingForecast] Received data:', result);
      return result;
    },
    placeholderData: (previousData) => previousData,
    enabled: !!location, // Only fetch if location exists
    refetchOnMount: true, // Always refetch on mount to get latest data
  });

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 border-amber-500/30">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-amber-400 flex items-center gap-2">
            <Fish className="w-4 h-4" />
            Expert Fishing Forecast
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-amber-400/70">Loading forecast...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 border-amber-500/30">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-amber-400 flex items-center gap-2">
            <Fish className="w-4 h-4" />
            Expert Fishing Forecast
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-amber-400/70">Unable to load forecast</p>
        </CardContent>
      </Card>
    );
  }

  if (!data?.forecast || data.forecast.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 border-amber-500/30">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-amber-400 flex items-center gap-2">
            <Fish className="w-4 h-4" />
            Expert Fishing Forecast
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-amber-400/70">Loading forecast data...</p>
        </CardContent>
      </Card>
    );
  }

  const forecast = data.forecast;
  
  // Find best day for quick reference
  const bestDay = forecast.reduce((best, day) => 
    day.score > best.score ? day : best
  , forecast[0]);

  // Color based on rating
  const getRatingColor = (rating: number) => {
    if (rating >= 4) return 'border-emerald-500/40 bg-emerald-900/20';
    if (rating >= 3) return 'border-amber-500/30 bg-slate-900/40';
    if (rating >= 2) return 'border-orange-500/20 bg-slate-900/30';
    return 'border-slate-500/20 bg-slate-900/20';
  };

  const getRatingLabel = (rating: number) => {
    if (rating >= 4) return 'Excellent';
    if (rating >= 3) return 'Good';
    if (rating >= 2) return 'Fair';
    return 'Tough';
  };

  return (
    <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 border-amber-500/30">
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-amber-400 flex items-center gap-2">
          <Fish className="w-4 h-4" />
          Expert Fishing Forecast (Next 7 Days)
        </CardTitle>
        {bestDay && bestDay.score >= 55 && (
          <p className="text-[10px] text-emerald-400/80 mt-1">
            🎯 Best day: {bestDay.dayName} ({renderStars(bestDay.rating)} - {bestDay.score}/100)
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {forecast.map((day, idx) => (
          <div 
            key={day.date + idx}
            className={`p-3 rounded-lg border space-y-2 ${getRatingColor(day.rating)}`}
            data-testid={`forecast-day-${idx}`}
          >
            {/* Day Header with Rating */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-amber-300">
                  🗓️ {day.dayName}
                </span>
                <span className="text-xs text-amber-400">
                  {renderStars(day.rating)} ({day.score}/100)
                </span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                  day.rating >= 4 ? 'bg-emerald-500/20 text-emerald-300' :
                  day.rating >= 3 ? 'bg-amber-500/20 text-amber-300' :
                  day.rating >= 2 ? 'bg-orange-500/20 text-orange-300' :
                  'bg-slate-500/20 text-slate-400'
                }`}>
                  {getRatingLabel(day.rating)}
                </span>
              </div>
            </div>

            {/* Best Windows */}
            {day.windows.length > 0 ? (
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold text-amber-400/90">
                  🎯 Best windows:
                </div>
                {day.windows.map((window, widx) => (
                  <div 
                    key={widx}
                    className="ml-3 text-[10px] text-amber-300/80"
                    data-testid={`window-${idx}-${widx}`}
                  >
                    <span className="font-semibold">
                      • {formatTime(window.startTime)} – {formatTime(window.endTime)}
                    </span>
                    <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                      window.score >= 70 ? 'bg-emerald-500/30 text-emerald-300' :
                      window.score >= 50 ? 'bg-amber-500/30 text-amber-300' :
                      window.score >= 30 ? 'bg-orange-500/30 text-orange-300' :
                      'bg-slate-500/30 text-slate-400'
                    }`}>
                      {window.score}
                    </span>
                    {window.tideCoeff !== null && (
                      <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                        window.tideCoeff >= 95 ? 'bg-blue-500/30 text-blue-300' :
                        window.tideCoeff >= 70 ? 'bg-cyan-500/30 text-cyan-300' :
                        'bg-slate-500/30 text-slate-400'
                      }`} title={`Tide coefficient: ${window.tideCoeff >= 108 ? 'very strong' : window.tideCoeff >= 95 ? 'strong' : window.tideCoeff >= 70 ? 'good' : window.tideCoeff < 50 ? 'weak' : 'moderate'}`}>
                        🌊 {window.tideCoeff}
                      </span>
                    )}
                    <span className="text-amber-400/70 ml-2">
                      → {window.triggers.join(' + ')}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-slate-400/70 italic">
                No high-scoring windows detected
              </div>
            )}

            {/* Tide & Weather Summary */}
            <div className="space-y-0.5 text-[10px]">
              {day.tideCoeff !== null && (
                <div className="text-amber-400/80">
                  🌊 Tide coefficient: {day.tideCoeff}{' '}
                  {day.tideCoeff >= 108 ? '(very strong)' : 
                   day.tideCoeff >= 95 ? '(strong)' :
                   day.tideCoeff >= 70 ? '(good)' : 
                   day.tideCoeff < 50 ? '(weak)' : ''}
                </div>
              )}
              <div className="text-amber-400/80">
                ☀️ Weather: {day.weather.temp}° · {day.weather.windSpeed}{' '}
                {day.weather.windDir !== undefined && `${degToCompass(day.weather.windDir)} `}
                mph · {day.weather.clouds}% clouds{' '}
                {day.weather.precip > 0 && `· ${day.weather.precip}% rain`}
              </div>
            </div>

            {/* Expert Note */}
            <div className="text-[10px] text-amber-300 italic border-t border-amber-500/10 pt-2">
              {day.note}
            </div>
          </div>
        ))}

        {/* Footer Note */}
        <p className="text-[10px] text-amber-400/60 mt-3 pt-2 border-t border-amber-500/10">
          Expert analysis considers: Solunar periods · Sunrise/sunset ±1hr · Moonrise/moonset · Tide flow · Water temp trends · Barometric pressure · Weather conditions
        </p>
      </CardContent>
    </Card>
  );
}
