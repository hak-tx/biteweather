import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { X, Fish, ChevronLeft, ChevronRight } from "lucide-react";

interface BiteWeatherWindow {
  startTime: string;
  endTime: string;
  score: number;
  tideCoeff: number | null;
  triggers: string[];
}

interface BiteWeatherData {
  date: string;
  dayName: string;
  rating: number;
  windows: BiteWeatherWindow[];
  tideCoeff: number | null;
  weather: {
    tempMax: number;
    tempMin: number;
    windSpeed: number;
    windDir?: number;
    clouds: number;
    precip: number;
    pressureTrend: string;
  };
  sunrise?: string;
  sunset?: string;
  note?: string;
}

interface BiteWeatherModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forecastData: BiteWeatherData | null;
  onNavigate: (direction: 'prev' | 'next') => void;
  canNavigatePrev: boolean;
  canNavigateNext: boolean;
  timezone?: string;
}

export function BiteWeatherModal({
  open,
  onOpenChange,
  forecastData,
  onNavigate,
  canNavigatePrev,
  canNavigateNext,
  timezone = 'UTC'
}: BiteWeatherModalProps) {
  
  if (!forecastData) return null;

  const formatWindowTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const formatTime = (isoString: string, tz?: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz });
  };

  const getRatingLabel = (rating: number) => {
    if (rating >= 4) return { label: 'Excellent', color: 'text-emerald-500' };
    if (rating >= 3) return { label: 'Good', color: 'text-blue-500' };
    if (rating >= 2) return { label: 'Fair', color: 'text-amber-500' };
    return { label: 'Poor', color: 'text-slate-500' };
  };

  const renderStarRating = (count: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <span key={i} className="text-base md:text-lg">
        {i < Math.floor(count) ? '⭐' : '☆'}
      </span>
    ));
  };

  const scoreToStars = (score: number): number => {
    if (score >= 80) return 5;
    if (score >= 60) return 4;
    if (score >= 40) return 3;
    if (score >= 20) return 2;
    return 1;
  };

  const degToCompass = (deg: number): string => {
    const val = Math.floor((deg / 22.5) + 0.5);
    const arr = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return arr[(val % 16)];
  };

  const formatPressureTrend = (trend: string) => {
    const trends: { [key: string]: { icon: string; label: string } } = {
      'sharp_rise': { icon: '↗↗', label: 'Rising rapidly' },
      'rising': { icon: '↗', label: 'Rising' },
      'steady': { icon: '→', label: 'Steady' },
      'falling': { icon: '↘', label: 'Falling' },
      'sharp_fall': { icon: '↘↘', label: 'Falling rapidly' }
    };
    return trends[trend] || { icon: '?', label: trend };
  };

  const ratingInfo = getRatingLabel(forecastData.rating);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900 dark:to-teal-900 border-emerald-300 dark:border-emerald-500/30">
        {/* Navigation Arrows - Positioned in middle */}
        <button
          onClick={() => onNavigate('prev')}
          disabled={!canNavigatePrev}
          className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-white/90 dark:bg-slate-800/90 hover:bg-emerald-100 dark:hover:bg-emerald-800 rounded-full transition disabled:opacity-30 disabled:cursor-not-allowed shadow-lg z-10"
          data-testid="button-prev-day"
        >
          <ChevronLeft className="w-6 h-6 md:w-7 md:h-7 text-slate-700 dark:text-slate-300" />
        </button>
        
        <button
          onClick={() => onNavigate('next')}
          disabled={!canNavigateNext}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white/90 dark:bg-slate-800/90 hover:bg-emerald-100 dark:hover:bg-emerald-800 rounded-full transition disabled:opacity-30 disabled:cursor-not-allowed shadow-lg z-10"
          data-testid="button-next-day"
        >
          <ChevronRight className="w-6 h-6 md:w-7 md:h-7 text-slate-700 dark:text-slate-300" />
        </button>

        {/* Header */}
        <div className="flex items-center justify-center gap-2 md:gap-3 -mt-2 mb-4">
          <Fish className="w-5 h-5 md:w-6 md:h-6 text-emerald-600 dark:text-emerald-500" />
          <h3 className="text-base md:text-xl font-bold text-slate-900 dark:text-slate-100">
            {forecastData.dayName}
          </h3>
          <div className="flex gap-0.5">
            {renderStarRating(forecastData.rating)}
          </div>
          <span className={`text-sm md:text-base font-semibold ${ratingInfo.color}`}>
            {ratingInfo.label}
          </span>
        </div>

        <div className="space-y-3 md:space-y-4">
          {/* Best Fishing Windows */}
          {forecastData.windows && forecastData.windows.length > 0 && (
            <div>
              <h4 className="text-sm md:text-base font-semibold text-emerald-700 dark:text-emerald-400 mb-2 flex items-center gap-1">
                🎣 Best windows:
              </h4>
              <div className="space-y-2">
                {forecastData.windows.map((window, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 p-2 md:p-3 bg-white/60 dark:bg-slate-900/40 border border-emerald-200 dark:border-emerald-500/20 rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm md:text-base font-semibold text-emerald-700 dark:text-emerald-400">
                          • {formatWindowTime(window.startTime)} – {formatWindowTime(window.endTime)}
                        </span>
                        <div className="flex gap-0.5">
                          {renderStarRating(scoreToStars(window.score))}
                        </div>
                        {window.tideCoeff !== null && window.tideCoeff !== undefined && (
                          <span className={`px-1.5 py-0.5 rounded text-xs md:text-sm font-semibold ${
                            window.tideCoeff >= 95 ? 'bg-blue-200 dark:bg-blue-500/30 text-blue-700 dark:text-blue-300' :
                            window.tideCoeff >= 70 ? 'bg-cyan-200 dark:bg-cyan-500/30 text-cyan-700 dark:text-cyan-300' :
                            'bg-slate-200 dark:bg-slate-500/30 text-slate-600 dark:text-slate-400'
                          }`} title={`Tide coefficient: ${window.tideCoeff >= 108 ? 'very strong' : window.tideCoeff >= 95 ? 'strong' : window.tideCoeff >= 70 ? 'good' : window.tideCoeff < 50 ? 'weak' : 'moderate'}`}>
                            🌊 {window.tideCoeff}
                          </span>
                        )}
                      </div>
                      <div className="text-xs md:text-sm text-slate-700 dark:text-slate-400 mt-0.5">
                        → {window.triggers.join(' + ')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tide Coefficient */}
          {forecastData.tideCoeff !== null && (
            <div className="flex items-center gap-2 text-sm md:text-base">
              <span className="font-semibold text-slate-800 dark:text-slate-300">🌊 Tide coefficient:</span>
              <span className={`font-bold ${
                forecastData.tideCoeff >= 70 ? 'text-blue-700 dark:text-blue-400' :
                forecastData.tideCoeff >= 40 ? 'text-blue-600 dark:text-blue-300' :
                'text-slate-600 dark:text-slate-400'
              }`}>
                {forecastData.tideCoeff}{forecastData.tideCoeff >= 70 ? ' (very strong)' : forecastData.tideCoeff >= 40 ? ' (weak)' : ''}
              </span>
            </div>
          )}

          {/* Weather Summary */}
          <div className="space-y-2">
            <div className="bg-slate-100/50 dark:bg-slate-800/30 rounded-lg p-2 md:p-4 border border-slate-200 dark:border-slate-700/50">
              <h4 className="text-xs md:text-base font-bold text-slate-700 dark:text-slate-300 mb-2 md:mb-3">📊 Daily Weather Overview</h4>
              <div className="grid grid-cols-2 gap-2 md:gap-3">
                {/* Temperature */}
                <div className="bg-white/60 dark:bg-slate-900/40 rounded-md p-2 md:p-3 border border-slate-200/50 dark:border-slate-700/50">
                  <div className="text-[10px] md:text-sm text-slate-500 dark:text-slate-400 font-medium mb-1">Temperature</div>
                  <div className="text-sm md:text-lg font-bold text-slate-800 dark:text-slate-100" data-testid="text-temp-modal">
                    {Math.round(forecastData.weather.tempMax)}° / {Math.round(forecastData.weather.tempMin)}°
                  </div>
                </div>
                
                {/* Wind */}
                <div className="bg-white/60 dark:bg-slate-900/40 rounded-md p-2 md:p-3 border border-slate-200/50 dark:border-slate-700/50">
                  <div className="text-[10px] md:text-sm text-slate-500 dark:text-slate-400 font-medium mb-1">Wind</div>
                  <div className="text-sm md:text-lg font-bold text-slate-800 dark:text-slate-100" data-testid="text-wind-modal">
                    {forecastData.weather.windDir !== undefined ? `${degToCompass(forecastData.weather.windDir)} ` : ''}{Math.round(forecastData.weather.windSpeed)} mph
                  </div>
                </div>
                
                {/* Clouds */}
                <div className="bg-white/60 dark:bg-slate-900/40 rounded-md p-2 md:p-3 border border-slate-200/50 dark:border-slate-700/50">
                  <div className="text-[10px] md:text-sm text-slate-500 dark:text-slate-400 font-medium mb-1">Cloud Cover</div>
                  <div className="text-sm md:text-lg font-bold text-slate-800 dark:text-slate-100" data-testid="text-clouds-modal">
                    {Math.round(forecastData.weather.clouds)}%
                  </div>
                </div>
                
                {/* Precipitation */}
                <div className="bg-white/60 dark:bg-slate-900/40 rounded-md p-2 md:p-3 border border-slate-200/50 dark:border-slate-700/50">
                  <div className="text-[10px] md:text-sm text-slate-500 dark:text-slate-400 font-medium mb-1">Rain Chance</div>
                  <div className="text-sm md:text-lg font-bold text-slate-800 dark:text-slate-100" data-testid="text-precip-modal">
                    {Math.round(forecastData.weather.precip)}%
                  </div>
                </div>
              </div>
              
              {/* Sun times and Pressure in a row */}
              <div className="mt-2 md:mt-3 pt-2 md:pt-3 border-t border-slate-200 dark:border-slate-700/50 space-y-1.5">
                {(forecastData.sunrise || forecastData.sunset) && (
                  <div className="flex items-center gap-2 text-xs md:text-sm">
                    <span className="text-slate-500 dark:text-slate-400">🌅</span>
                    {forecastData.sunrise && (
                      <span className="text-slate-700 dark:text-slate-300" data-testid="text-sunrise-modal">
                        Rise {formatTime(forecastData.sunrise, timezone)}
                      </span>
                    )}
                    {forecastData.sunrise && forecastData.sunset && <span className="text-slate-400">•</span>}
                    {forecastData.sunset && (
                      <span className="text-slate-700 dark:text-slate-300" data-testid="text-sunset-modal">
                        Set {formatTime(forecastData.sunset, timezone)}
                      </span>
                    )}
                  </div>
                )}
                
                <div className="flex items-center gap-2 text-xs md:text-sm">
                  <span className="text-slate-500 dark:text-slate-400">🌡️</span>
                  <span className="text-slate-600 dark:text-slate-400">Pressure:</span>
                  <span data-testid="text-pressure-modal" className={`font-semibold ${
                    forecastData.weather.pressureTrend === 'rising' || forecastData.weather.pressureTrend === 'sharp_rise' 
                      ? 'text-green-600 dark:text-green-400' 
                      : forecastData.weather.pressureTrend === 'falling' || forecastData.weather.pressureTrend === 'sharp_fall'
                      ? 'text-orange-600 dark:text-orange-400'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}>
                    {formatPressureTrend(forecastData.weather.pressureTrend).icon} {formatPressureTrend(forecastData.weather.pressureTrend).label}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Call to action to check hourly chart */}
            <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-2 md:p-3 border border-blue-200 dark:border-blue-500/20">
              <p className="text-xs md:text-sm text-blue-800 dark:text-blue-300 flex items-start gap-2">
                <span className="text-sm md:text-base">💡</span>
                <span>
                  <strong>Pro tip:</strong> Scroll down to the hourly chart to see detailed weather conditions at the specific times you're planning to fish.
                </span>
              </p>
            </div>
          </div>

          {/* Fishing Note */}
          {forecastData.note && (
            <p className="text-sm md:text-base italic text-amber-800 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/10 px-3 py-2 md:px-4 md:py-3 rounded border border-amber-300 dark:border-amber-500/20">
              {forecastData.note}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
