import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, X, Droplets } from "lucide-react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from "recharts";
import { format } from "date-fns";

interface PrecipitationDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datetime: string | null;
  lat: number;
  lon: number;
  timezone?: string;
  hourlyPrecip?: number;
  hourlyProb?: number;
}

interface MinutelyData {
  time: string;
  precipitation: number;
  precipProbability: number;
  timestamp: number;
}

interface ApiResponse {
  requestedTime: string;
  windowStart: string;
  windowEnd: string;
  data: MinutelyData[];
  summary: {
    total15min: number;
    maxChance: number;
  };
  timezone: string;
}

export function PrecipitationDetailModal({
  open,
  onOpenChange,
  datetime,
  lat,
  lon,
  timezone = "UTC",
  hourlyPrecip,
  hourlyProb
}: PrecipitationDetailModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  useEffect(() => {
    if (!open || !datetime) {
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const params = new URLSearchParams({
          lat: lat.toString(),
          lon: lon.toString(),
          datetime: datetime,
          timezone: timezone
        });
        
        if (hourlyPrecip !== undefined) {
          params.append('hourlyPrecip', hourlyPrecip.toString());
        }
        
        if (hourlyProb !== undefined) {
          params.append('hourlyProb', hourlyProb.toString());
        }

        const response = await fetch(`/api/weather/precipitation/15min?${params}`);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch data: ${response.statusText}`);
        }

        const result: ApiResponse = await response.json();
        setData(result);
      } catch (err: any) {
        console.error("Error fetching 15-min precipitation:", err);
        setError(err.message || "Failed to load precipitation detail");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [open, datetime, lat, lon, timezone, hourlyPrecip, hourlyProb]);

  if (!datetime) {
    return null;
  }

  const requestedDate = new Date(datetime);
  const dateStr = format(requestedDate, "EEEE, MMM d");
  const clickedTime = format(requestedDate, "h:mma");

  // Use fixed 1" scale for consistent visualization across all forecasts
  const precipDomain: [number, number] = [0, 1];

  // Format chart data
  const chartData = data?.data.map(item => {
    const itemDate = new Date(item.time);
    return {
      time: format(itemDate, "h:mma"),
      fullTime: item.time,
      precipitation: item.precipitation,
      chance: item.precipProbability || 0
    };
  }) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Droplets className="w-5 h-5 text-blue-500" />
            15-Minute Precipitation Detail
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {dateStr}
          </p>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        )}

        {error && (
          <div className="text-center py-12">
            <p className="text-red-500">{error}</p>
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-4">
              <p className="text-sm font-medium mb-2">
                {format(new Date(data.windowStart), "h:mma")} - {format(new Date(data.windowEnd), "h:mma")}
                <span className="text-muted-foreground ml-2">(clicked: {clickedTime})</span>
              </p>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">15-min total:</span>
                  <span className="font-semibold ml-2" data-testid="text-15min-total">
                    {data.summary.total15min.toFixed(3)}"
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Max chance:</span>
                  <span className="font-semibold ml-2" data-testid="text-max-chance">
                    {data.summary.maxChance}%
                  </span>
                </div>
              </div>
            </div>

            <div className="h-[400px] w-full" data-testid="chart-15min-precipitation">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <defs>
                    <linearGradient id="precipBarGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22d3ee" stopOpacity={1} />
                      <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.5} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="time"
                    stroke="#64748b"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={{ stroke: '#475569' }}
                    interval="preserveStartEnd"
                    minTickGap={30}
                  />
                  <YAxis
                    yAxisId="left"
                    stroke="#64748b"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={{ stroke: '#475569' }}
                    label={{ value: 'Chance (%)', angle: -90, position: 'insideLeft', fill: '#94a3b8' }}
                    domain={[0, 100]}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#64748b"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={{ stroke: '#475569' }}
                    label={{ value: 'Amount (in)', angle: 90, position: 'insideRight', fill: '#94a3b8' }}
                    domain={precipDomain}
                    ticks={[0, 0.25, 0.5, 0.75, 1.0]}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      border: '1px solid #475569',
                      borderRadius: '8px',
                      padding: '8px 12px'
                    }}
                    formatter={(value: any, name: string) => {
                      if (name === 'chance') {
                        return [`${value}%`, 'Rain Chance'];
                      }
                      if (name === 'precipitation') {
                        return [`${Number(value).toFixed(3)}"`, 'Rain Amount'];
                      }
                      return [value, name];
                    }}
                    labelFormatter={(label) => {
                      const item = chartData.find(d => d.time === label);
                      if (item) {
                        return format(new Date(item.fullTime), "h:mm a");
                      }
                      return label;
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    formatter={(value) => {
                      if (value === 'chance') return 'Rain Chance';
                      if (value === 'precipitation') return 'Rain Amount';
                      return value;
                    }}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="chance"
                    stroke="#60a5fa"
                    strokeWidth={2}
                    dot={{ fill: '#60a5fa', r: 3 }}
                    name="chance"
                  />
                  <Bar
                    yAxisId="right"
                    dataKey="precipitation"
                    fill="url(#precipBarGradient)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={12}
                    name="precipitation"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              15-minute resolution precipitation forecast powered by Open-Meteo
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
