import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Wind,
  Waves,
  Loader2,
  AlertCircle,
  Search,
  Droplets,
  Compass,
  MapPin,
  Moon,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Cell,
  Label,
  LabelList,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AppHeader } from "@/components/AppHeader";
import { Footer } from "@/components/Footer";

interface TideDay {
  date: string;
  predictions: Array<{ time: string; height: number; type: string }>;
  highTides: Array<{ time: string; height: number; coefficient?: number }>;
  lowTides: Array<{ time: string; height: number }>;
  avgCoefficient?: number;
  minCoefficient?: number;
  maxCoefficient?: number;
}

export default function TidesPage() {
  // Read location from URL param or use default
  const [location, setLocation] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const urlLocation = params.get('location');
    if (urlLocation) return decodeURIComponent(urlLocation);
    return localStorage.getItem("weather_location") || "San Francisco,CA";
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [moonPhases, setMoonPhases] = useState<any[]>([]);

  // Fetch moon phase data
  useEffect(() => {
    fetch(`/api/moon-phases?location=${encodeURIComponent(location)}`)
      .then(res => res.json())
      .then(data => setMoonPhases(data))
      .catch(err => console.error("Failed to fetch moon phases:", err));
  }, [location]);

  const { data: suggestions } = useQuery({
    queryKey: ["tides-search", searchQuery],
    queryFn: async () => {
      if (searchQuery.length < 2) return [];
      const res = await fetch(`/api/tides/search?q=${encodeURIComponent(searchQuery)}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: tideData, isLoading, error } = useQuery({
    queryKey: ["tides", location],
    queryFn: async () => {
      const res = await fetch(`/api/tides?location=${encodeURIComponent(location)}`);
      if (!res.ok) throw new Error("Failed to fetch tides");
      return res.json();
    },
  });

  const { data: stationsData } = useQuery({
    queryKey: ["tides-stations"],
    queryFn: async () => {
      const res = await fetch(`/api/tides/stations`);
      if (!res.ok) return null;
      return res.json();
    },
  });

  const handleSearch = (suggestion: any) => {
    // For tide stations, use the station name directly
    setLocation(suggestion.name);
    setSearchQuery("");
    setShowSuggestions(false);
  };

  // Build chronological 7-day chart - flatten all predictions into one sorted array
  const sevenDayChart: any[] = [];
  const midnightTimestamps: number[] = [];
  const noonTicks: number[] = [];
  const tideMarkers: any[] = [];
  
  // Use actual first prediction timestamp as chart start (station timezone)
  const firstPrediction = tideData?.forecast?.[0]?.predictions?.[0];
  const chartStartTime = firstPrediction ? new Date(firstPrediction.time).getTime() : Date.now();
  
  // Calculate end time (7 days from start)
  const DAY_MS = 24 * 60 * 60 * 1000;
  const chartEndTime = chartStartTime + (7 * DAY_MS);
  
  if (tideData?.forecast) {
    // Build high/low tide markers from the dedicated high/low tide arrays
    tideData.forecast.forEach((day: TideDay) => {
      // Add high tides
      day.highTides?.forEach((tide: any) => {
        tideMarkers.push({
          timestamp: new Date(tide.time).getTime(),
          time: new Date(tide.time),
          height: parseFloat(tide.height),
          type: 'H',
          isHigh: true
        });
      });
      
      // Add low tides
      day.lowTides?.forEach((tide: any) => {
        tideMarkers.push({
          timestamp: new Date(tide.time).getTime(),
          time: new Date(tide.time),
          height: parseFloat(tide.height),
          type: 'L',
          isHigh: false
        });
      });
    });
    
    // Flatten all predictions from all days (6-minute data for smooth curve)
    const allPredictions = tideData.forecast.flatMap((day: TideDay) => 
      day.predictions.map((p: any) => ({
        timestamp: new Date(p.time).getTime(),
        time: new Date(p.time),
        height: parseFloat(p.height),
      }))
    );
    
    // Sort chronologically
    allPredictions.sort((a: any, b: any) => a.timestamp - b.timestamp);
    
    // Build chart data - NOAA now provides 6-minute data for smooth curves
    allPredictions.forEach((p: any) => {
      const timeStr = p.time.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      sevenDayChart.push({
        timestamp: p.timestamp,
        time: p.time,
        height: p.height,
        timeStr: timeStr,
      });
    });
    
    // Create uniform midnight separators and noon ticks for 7 days using arithmetic
    const HOUR_MS = 60 * 60 * 1000;
    
    for (let i = 0; i < 7; i++) {
      // Noon tick for day label (12 hours after each day's start)
      const noon = chartStartTime + (i * DAY_MS) + (12 * HOUR_MS);
      noonTicks.push(noon);
      
      // Midnight separator between days (starting after day 0)
      if (i > 0) {
        const midnight = chartStartTime + (i * DAY_MS);
        midnightTimestamps.push(midnight);
      }
    }
  }
  
  // Get user's current time for "Now" indicator
  const now = new Date();
  const currentTimestamp = now.getTime();


  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-blue-500/30 flex flex-col">
      <AppHeader 
        location={location} 
        currentPage="tides"
        onUpgrade={() => {}}
      />
      
      <div className="flex-1 p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-4">
          {/* Search Bar */}
          <Card className="bg-white/5">
            <CardContent className="p-4">
              <div className="relative z-20">
                <Input
                  placeholder="Search coastal location..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  className="pl-3"
                />
                {showSuggestions && suggestions && suggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                    {suggestions.map((suggestion: any) => (
                      <button
                        key={`${suggestion.lat}-${suggestion.lon}`}
                        type="button"
                        onClick={() => handleSearch(suggestion)}
                        className="w-full text-left px-4 py-3 hover:bg-slate-800 transition-colors text-sm border-b border-slate-700 last:border-b-0"
                      >
                        <div className="font-semibold">{suggestion.name}</div>
                        <div className="text-xs text-muted-foreground">{suggestion.region}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Loading/Error States */}
          {isLoading && (
            <Card className="bg-white/5">
              <CardContent className="p-8 flex items-center justify-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-cyan-500" />
                <span>Loading tide data...</span>
              </CardContent>
            </Card>
          )}

          {error && (
            <Card className="border-red-500/20 bg-red-500/5">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                <div>
                  <div className="font-semibold text-red-400">Unable to load tide data</div>
                  <div className="text-sm text-red-400/80">Please try a coastal area</div>
                </div>
              </CardContent>
            </Card>
          )}

          {tideData && !error && (
            <>
              {/* Station Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
                {/* Station */}
                <Card className="bg-gradient-to-br from-blue-500/15 to-cyan-500/10 border-blue-500/30">
                  <CardContent className="p-3">
                    <div className="flex gap-2">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0">
                        <MapPin className="w-4 h-4 text-blue-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-blue-400 uppercase tracking-wide">Station</div>
                        <div className="text-sm md:text-base font-bold text-white break-words mt-1">{tideData.stationName}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{tideData.stationId}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* High Tide */}
                <Card className="bg-gradient-to-br from-green-500/15 to-emerald-500/10 border-green-500/30">
                  <CardContent className="p-3">
                    <div className="flex gap-2">
                      <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center shrink-0">
                        <TrendingUp className="w-4 h-4 text-green-400" />
                      </div>
                      <div className="flex-1">
                        <div className="text-xs font-semibold text-green-400 uppercase tracking-wide">High Tide</div>
                        <div className="text-sm md:text-base font-bold text-green-300 mt-1">
                          {tideData.nextHighTide 
                            ? new Date(tideData.nextHighTide.time).toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit"})
                            : "N/A"}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {tideData.nextHighTide ? `${tideData.nextHighTide.height.toFixed(1)} ft` : ""}
                        </div>
                        {tideData.nextHighTide?.coefficient !== undefined && (
                          <div className="mt-2">
                            <div className="text-xs font-semibold text-green-400 uppercase tracking-wide">Coefficient</div>
                            <div className="text-lg font-bold text-green-300">{tideData.nextHighTide.coefficient}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Low Tide */}
                <Card className="bg-gradient-to-br from-orange-500/15 to-amber-500/10 border-orange-500/30">
                  <CardContent className="p-3">
                    <div className="flex gap-2">
                      <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center shrink-0">
                        <TrendingDown className="w-4 h-4 text-orange-400" />
                      </div>
                      <div className="flex-1">
                        <div className="text-xs font-semibold text-orange-400 uppercase tracking-wide">Low Tide</div>
                        <div className="text-sm md:text-base font-bold text-orange-300 mt-1">
                          {tideData.nextLowTide 
                            ? new Date(tideData.nextLowTide.time).toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit"})
                            : "N/A"}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {tideData.nextLowTide ? `${tideData.nextLowTide.height.toFixed(1)} ft` : ""}
                        </div>
                        {tideData.nextLowTide?.coefficient !== undefined && (
                          <div className="mt-2">
                            <div className="text-xs font-semibold text-orange-400 uppercase tracking-wide">Coefficient</div>
                            <div className="text-lg font-bold text-orange-300">{tideData.nextLowTide.coefficient}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Tide State */}
                <Card className={`bg-gradient-to-br ${tideData.currentTideState === "rising" ? "from-emerald-500/15 to-green-500/10 border-emerald-500/30" : "from-rose-500/15 to-orange-500/10 border-rose-500/30"}`}>
                  <CardContent className="p-3">
                    <div className="flex gap-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${tideData.currentTideState === "rising" ? "bg-green-500/20" : "bg-orange-500/20"}`}>
                        <div className={`w-4 h-4 rounded-full ${tideData.currentTideState === "rising" ? "bg-green-500" : "bg-orange-500"}`} />
                      </div>
                      <div className="flex-1">
                        <div className={`text-xs font-semibold uppercase tracking-wide ${tideData.currentTideState === "rising" ? "text-emerald-400" : "text-rose-400"}`}>Tide State</div>
                        <div className={`text-sm md:text-base font-bold mt-1 ${tideData.currentTideState === "rising" ? "text-emerald-300" : "text-rose-300"}`}>
                          {tideData.currentTideState === "rising" ? "Rising" : "Falling"}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {tideData.currentTideState === "rising" ? "Going up" : "Going down"}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* 7-Day Overview Chart */}
              {sevenDayChart.length > 0 && (
                <Card className="bg-gradient-to-b from-blue-500/10 to-cyan-500/5">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Waves className="w-5 h-5 text-blue-400" />
                      7-Day Tide Overview
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="w-full overflow-x-auto">
                    <ResponsiveContainer width="100%" height={300} minWidth={1800}>
                      <LineChart data={sevenDayChart}>
                        <defs>
                          <linearGradient id="sevenDayGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis 
                          dataKey="timestamp"
                          type="number"
                          domain={[chartStartTime, chartEndTime]}
                          stroke="rgba(255,255,255,0.5)" 
                          style={{ fontSize: "11px" }}
                          ticks={noonTicks.length > 0 ? noonTicks : undefined}
                          tickFormatter={(timestamp: number) => {
                            const date = new Date(timestamp);
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            const tomorrow = new Date(today);
                            tomorrow.setDate(tomorrow.getDate() + 1);
                            
                            const pointDate = new Date(date);
                            pointDate.setHours(0, 0, 0, 0);
                            
                            if (pointDate.getTime() === today.getTime()) {
                              return "Today";
                            } else if (pointDate.getTime() === tomorrow.getTime()) {
                              return "Tomorrow";
                            } else {
                              return date.toLocaleDateString("en-US", { weekday: "short" });
                            }
                          }}
                        />
                        <YAxis 
                          stroke="rgba(255,255,255,0.5)" 
                          style={{ fontSize: "10px" }}
                          width={35}
                          tick={{ fontSize: 10 }}
                          label={{ value: "ft", angle: -90, position: "insideLeft", offset: 5 }}
                        />
                        <Tooltip
                          content={(props: any) => {
                            const { active, payload, coordinate } = props;
                            if (!active || !payload || !payload.length || !coordinate) return null;
                            
                            const data = payload[0].payload;
                            const value = payload[0].value;
                            const date = new Date(data.timestamp);
                            
                            // Auto-flip tooltip to left when near right edge
                            const tooltipWidth = 180;
                            const windowWidth = window.innerWidth;
                            const wouldOverflow = coordinate.x + tooltipWidth > windowWidth - 20;
                            
                            return (
                              <div
                                style={{
                                  backgroundColor: "rgba(15, 23, 42, 0.95)",
                                  border: "1px solid rgba(255,255,255,0.2)",
                                  borderRadius: "8px",
                                  color: "#e2e8f0",
                                  padding: "8px 12px",
                                  fontSize: "12px",
                                  transform: wouldOverflow ? 'translateX(-100%)' : 'translateX(10px)',
                                  pointerEvents: 'none',
                                }}
                              >
                                <div style={{ fontWeight: "bold", marginBottom: "4px" }}>
                                  {date.toLocaleString("en-US", { 
                                    weekday: "short",
                                    month: "short", 
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit"
                                  })}
                                </div>
                                <div>
                                  <span style={{ color: "#94a3b8" }}>Tide Height: </span>
                                  <span style={{ color: "#3b82f6", fontWeight: "bold" }}>
                                    {value !== null ? `${value.toFixed(2)} ft` : 'N/A'}
                                  </span>
                                </div>
                              </div>
                            );
                          }}
                        />
                        {/* Midnight separators between days */}
                        {midnightTimestamps.map((midnight: number) => (
                          <ReferenceLine 
                            key={`midnight-${midnight}`}
                            x={midnight}
                            stroke="rgba(71, 85, 105, 0.9)"
                            strokeWidth={3}
                            strokeDasharray="0"
                          />
                        ))}
                        
                        {/* Current time indicator */}
                        {sevenDayChart.length > 0 && 
                         currentTimestamp >= sevenDayChart[0].timestamp && 
                         currentTimestamp <= sevenDayChart[sevenDayChart.length - 1].timestamp && (
                          <ReferenceLine
                            x={currentTimestamp}
                            stroke="#ef4444"
                            strokeWidth={2}
                            strokeDasharray="3 3"
                            label={{
                              value: 'Now',
                              position: 'top',
                              fill: '#ef4444',
                              fontSize: 11,
                              fontWeight: 'bold'
                            }}
                          />
                        )}
                        <Line
                          type="natural"
                          dataKey="height"
                          stroke="#3b82f6"
                          strokeWidth={2.5}
                          dot={false}
                          isAnimationActive={true}
                        />
                        {/* High/Low Tide Markers with smart label positioning */}
                        {tideMarkers.map((marker, idx) => {
                          const isHigh = marker.isHigh;
                          const color = isHigh ? '#10b981' : '#f59e0b';
                          
                          // Custom label component with offset and arrow for overlapping labels
                          const CustomLabel = (props: any) => {
                            const { x, y, viewBox } = props;
                            const baseOffset = isHigh ? -15 : 15;
                            
                            // Check if nearby markers exist (within 50px would overlap)
                            const nearbyMarkers = tideMarkers.filter((m, i) => {
                              if (i === idx) return false;
                              const timeDiff = Math.abs(m.timestamp - marker.timestamp);
                              return timeDiff < 6 * 3600000; // Within 6 hours
                            });
                            
                            // Alternate offset for nearby markers
                            const extraOffset = nearbyMarkers.length > 0 ? (idx % 2 === 0 ? 20 : 0) : 0;
                            const totalOffset = baseOffset + (isHigh ? -extraOffset : extraOffset);
                            const labelY = y + totalOffset;
                            
                            // Format time for label
                            const timeStr = marker.time.toLocaleTimeString("en-US", { 
                              hour: "numeric", 
                              minute: "2-digit"
                            });
                            
                            return (
                              <g>
                                {/* Arrow line connecting dot to label */}
                                {extraOffset > 0 && (
                                  <line
                                    x1={x}
                                    y1={y + (isHigh ? -8 : 8)}
                                    x2={x}
                                    y2={labelY + (isHigh ? 6 : -6)}
                                    stroke={color}
                                    strokeWidth={1}
                                    opacity={0.6}
                                  />
                                )}
                                {/* Height label */}
                                <text
                                  x={x}
                                  y={labelY}
                                  textAnchor="middle"
                                  fill={color}
                                  fontSize={11}
                                  fontWeight="bold"
                                >
                                  {marker.height.toFixed(2)}ft
                                </text>
                                {/* Time label below height */}
                                <text
                                  x={x}
                                  y={labelY + (isHigh ? 12 : -12)}
                                  textAnchor="middle"
                                  fill={color}
                                  fontSize={9}
                                  opacity={0.8}
                                >
                                  {timeStr}
                                </text>
                              </g>
                            );
                          };
                          
                          return (
                            <ReferenceDot
                              key={`tide-marker-${idx}`}
                              x={marker.timestamp}
                              y={marker.height}
                              r={6}
                              fill={color}
                              stroke="#fff"
                              strokeWidth={2}
                              label={<Label content={CustomLabel} />}
                            />
                          );
                        })}
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* 7-Day Tide Coefficient Chart */}
              {tideData?.forecast && tideData.forecast.length > 0 && (
                <Card className="bg-gradient-to-b from-yellow-500/10 to-amber-500/5">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Waves className="w-5 h-5 text-yellow-400" />
                      Tidal Coefficient
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Higher values = stronger tides & better fishing
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs">
                      <div className="flex items-center gap-2 bg-green-500/20 rounded px-2 py-1">
                        <div className="w-3 h-3 rounded bg-green-500"></div>
                        <span className="text-green-300 font-semibold">95-120: Excellent (Spring)</span>
                      </div>
                      <div className="flex items-center gap-2 bg-lime-500/20 rounded px-2 py-1">
                        <div className="w-3 h-3 rounded bg-lime-500"></div>
                        <span className="text-lime-300 font-semibold">70-94: Good</span>
                      </div>
                      <div className="flex items-center gap-2 bg-yellow-500/20 rounded px-2 py-1">
                        <div className="w-3 h-3 rounded bg-yellow-500"></div>
                        <span className="text-yellow-300 font-semibold">55-69: Average</span>
                      </div>
                      <div className="flex items-center gap-2 bg-orange-500/20 rounded px-2 py-1">
                        <div className="w-3 h-3 rounded bg-orange-500"></div>
                        <span className="text-orange-300 font-semibold">20-54: Fair (Neap)</span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <ComposedChart
                        data={tideData.forecast.slice(0, 7).map((day: TideDay, index: number) => {
                          // Use coefficient range from API response
                          const avgCoefficient = day.avgCoefficient || 0;
                          const minCoeff = day.minCoefficient || avgCoefficient;
                          const maxCoeff = day.maxCoefficient || avgCoefficient;
                          const displayCoeff = minCoeff !== maxCoeff ? `${minCoeff}-${maxCoeff}` : String(avgCoefficient);
                          
                          // Parse date in local timezone by adding time component
                          const date = new Date(day.date + 'T12:00:00');
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const tomorrow = new Date(today);
                          tomorrow.setDate(tomorrow.getDate() + 1);
                          
                          const pointDate = new Date(date);
                          pointDate.setHours(0, 0, 0, 0);
                          
                          let dayLabel = "";
                          if (pointDate.getTime() === today.getTime()) {
                            dayLabel = "Today";
                          } else {
                            // Always use weekday abbreviation for all other days (including tomorrow)
                            dayLabel = date.toLocaleDateString("en-US", { weekday: "short" });
                          }
                          
                          return {
                            day: dayLabel,
                            coefficient: avgCoefficient,
                            displayCoeff,
                            date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                          };
                        })}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis 
                          dataKey="day" 
                          stroke="rgba(255,255,255,0.5)" 
                          style={{ fontSize: "11px" }}
                        />
                        <YAxis 
                          stroke="rgba(255,255,255,0.5)" 
                          style={{ fontSize: "10px" }}
                          domain={[0, 120]}
                          ticks={[0, 30, 60, 90, 120]}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "rgba(15, 23, 42, 0.95)",
                            border: "1px solid rgba(255,255,255,0.2)",
                            borderRadius: "8px",
                            color: "#e2e8f0",
                          }}
                          formatter={(value: any, name: string, props: any) => {
                            const quality = value >= 95 ? "Excellent" : value >= 70 ? "Good" : value >= 55 ? "Average" : "Fair";
                            const display = props.payload.displayCoeff || value;
                            return [`${display} (${quality})`, "Coefficient"];
                          }}
                          labelFormatter={(label: string, payload: any) => {
                            if (payload && payload.length > 0) {
                              return `${label} - ${payload[0].payload.date}`;
                            }
                            return label;
                          }}
                        />
                        <Bar dataKey="coefficient" radius={[8, 8, 0, 0]}>
                          {tideData.forecast.slice(0, 7).map((day: TideDay, index: number) => {
                            const coefficients = day.predictions
                              .map((p: any) => p.coefficient)
                              .filter((c: number) => c !== undefined && !isNaN(c));
                            const avgCoefficient = coefficients.length > 0
                              ? Math.round(coefficients.reduce((a: number, b: number) => a + b, 0) / coefficients.length)
                              : 0;
                            
                            // Color based on coefficient value - green for excellent, orange for fair
                            let color = "#f97316"; // Orange for fair/neap tides
                            if (avgCoefficient >= 95) color = "#10b981"; // Green for excellent/spring tides
                            else if (avgCoefficient >= 70) color = "#84cc16"; // Lime for good
                            else if (avgCoefficient >= 55) color = "#eab308"; // Yellow for average
                            else color = "#f97316"; // Orange for fair/neap tides
                            
                            return <Cell key={`cell-${index}`} fill={color} />;
                          })}
                        </Bar>
                      </ComposedChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Moon Phase & Astronomy Section */}
              {moonPhases.length > 0 && (
                <Card className="bg-gradient-to-r from-purple-900/30 to-indigo-900/30 border border-purple-500/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Moon className="w-5 h-5 text-purple-400" />
                      7-Day Lunar & Astronomy
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {moonPhases.map((phase: any) => {
                        const dateObj = new Date(phase.date + 'T12:00:00');
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const tomorrow = new Date(today);
                        tomorrow.setDate(tomorrow.getDate() + 1);
                        const phaseDate = new Date(phase.date + 'T00:00:00');
                        phaseDate.setHours(0, 0, 0, 0);
                        
                        let dayLabel = phase.dayOfWeek;
                        if (phaseDate.getTime() === today.getTime()) {
                          dayLabel = "Today";
                        } else if (phaseDate.getTime() === tomorrow.getTime()) {
                          dayLabel = "Tomorrow";
                        }

                        return (
                          <div 
                            key={phase.date} 
                            className="bg-white/5 rounded-lg p-3 border border-purple-500/20 hover:bg-white/10 transition-colors"
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <div className="text-3xl">{phase.phaseName.split(' ')[0]}</div>
                              <div className="flex-1">
                                <div className="text-sm font-semibold text-purple-300">{dayLabel}</div>
                                <div className="text-xs text-muted-foreground">{dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                              </div>
                            </div>
                            
                            <div className="space-y-2 text-xs">
                              <div className="flex items-center justify-between bg-purple-500/20 rounded px-2 py-1">
                                <span className="text-muted-foreground">Phase:</span>
                                <span className="font-semibold text-purple-300">{phase.phaseName.split(' ').slice(1).join(' ')}</span>
                              </div>
                              
                              <div className="flex items-center justify-between bg-purple-500/20 rounded px-2 py-1">
                                <span className="text-muted-foreground">Illumination:</span>
                                <span className="font-bold text-purple-300">{phase.illumination}%</span>
                              </div>
                              
                              {phase.moonrise && (
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">🌙 Rise:</span>
                                  <span className="font-semibold text-purple-200">
                                    {new Date('2000-01-01T' + phase.moonrise).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                  </span>
                                </div>
                              )}
                              
                              {phase.moonset && (
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">🌙 Set:</span>
                                  <span className="font-semibold text-purple-200">
                                    {new Date('2000-01-01T' + phase.moonset).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                  </span>
                                </div>
                              )}
                              
                              {phase.sunrise && (
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">☀️ Rise:</span>
                                  <span className="font-semibold text-amber-200">
                                    {new Date('2000-01-01T' + phase.sunrise).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                  </span>
                                </div>
                              )}
                              
                              {phase.sunset && (
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">☀️ Set:</span>
                                  <span className="font-semibold text-amber-200">
                                    {new Date('2000-01-01T' + phase.sunset).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Fishing Tips */}
              <Card className="border-amber-500/20 bg-amber-500/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-amber-400">
                    <Wind className="w-5 h-5" />
                    Fishing Tips
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>💡 <strong>Best fishing:</strong> 1-2 hours before and after tide changes</p>
                  <p>💡 <strong>Slack water:</strong> When tides turn, baitfish concentrate</p>
                  <p>💡 <strong>Current strength:</strong> Stronger currents during larger tide ranges</p>
                  <p>💡 <strong>Morning sessions:</strong> Fish from 30 mins before sunrise</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
