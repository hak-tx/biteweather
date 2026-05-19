import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Play, Pause, Maximize, Minimize, Lock, Crown } from 'lucide-react';

interface RadarMapProps {
  latitude: number;
  longitude: number;
  isPremium?: boolean;
  isAuthenticated?: boolean;
  onUpgradeClick?: () => void;
}

export function RadarMap({ latitude, longitude, isPremium = true, isAuthenticated = true, onUpgradeClick }: RadarMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const radarLayersRef = useRef<L.TileLayer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animationSpeed, setAnimationSpeed] = useState(500);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [radarOpacity, setRadarOpacity] = useState(0.6);
  const [radarSource, setRadarSource] = useState<'iem'>('iem');
  const animationRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Initialize map
    const map = L.map(mapContainerRef.current, {
      center: [latitude, longitude],
      zoom: 7,
      zoomControl: true,
      attributionControl: false
    });

    mapRef.current = map;

    // Add dark base tile layer with labels, cities, and borders
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 20,
      attribution: '© OpenStreetMap contributors, © CartoDB',
      className: 'map-tiles'
    }).addTo(map);
    
    // Add labels layer on top for better visibility
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 20,
      zIndex: 1000,
      pane: 'shadowPane',
      className: 'map-labels'
    }).addTo(map);

    // Add location marker
    const customIcon = L.divIcon({
      className: 'custom-marker',
      html: '<div style="width: 12px; height: 12px; background: #3b82f6; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 10px rgba(59, 130, 246, 0.6);"></div>',
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });
    
    L.marker([latitude, longitude], { icon: customIcon }).addTo(map);

    // IEM radar frames at 5-minute intervals (past 50 minutes)
    // Reverse order so oldest frame is first (plays forward chronologically)
    const timeOffsets = [50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0];
    
    timeOffsets.forEach((offset, idx) => {
      const timeStr = offset === 0 ? '' : `-m${offset.toString().padStart(2, '0')}m`;
      const layer = L.tileLayer(
        `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913${timeStr}/{z}/{x}/{y}.png`,
        {
          tileSize: 256,
          opacity: 0,
          zIndex: 10 + idx,
          attribution: 'IEM',
          maxNativeZoom: 18,
          errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          keepBuffer: 2
        }
      );
      
      // Add error handling for failed tiles
      layer.on('tileerror', (error: any) => {
        console.warn(`IEM tile load error for frame ${idx}:`, error);
      });
      
      layer.addTo(map);
      radarLayersRef.current.push(layer);
    });

    setTotalFrames(timeOffsets.length);
    setIsLoading(false);

    // Show the most recent frame (last index) by default
    const mostRecentFrameIndex = timeOffsets.length - 1;
    setCurrentFrame(mostRecentFrameIndex);
    if (radarLayersRef.current[mostRecentFrameIndex]) {
      radarLayersRef.current[mostRecentFrameIndex].setOpacity(radarOpacity);
    }

    // Cleanup
    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
      radarLayersRef.current.forEach(layer => layer.remove());
      radarLayersRef.current = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [latitude, longitude, radarSource]);

  // Animation control
  useEffect(() => {
    if (!isPlaying || totalFrames === 0) {
      if (animationRef.current) {
        clearInterval(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    animationRef.current = setInterval(() => {
      setCurrentFrame(prev => {
        const next = (prev + 1) % totalFrames;
        
        // Toggle layer visibility
        radarLayersRef.current.forEach((layer, idx) => {
          layer.setOpacity(idx === next ? radarOpacity : 0);
        });
        
        return next;
      });
    }, animationSpeed);

    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
    };
  }, [isPlaying, animationSpeed, totalFrames, radarOpacity]);

  // Handle slider change
  const handleSliderChange = (value: number) => {
    setCurrentFrame(value);
    
    // Toggle layer visibility
    radarLayersRef.current.forEach((layer, idx) => {
      layer.setOpacity(idx === value ? radarOpacity : 0);
    });
  };

  // Handle opacity change
  const handleOpacityChange = (value: number) => {
    setRadarOpacity(value);
    
    // Update current frame opacity
    radarLayersRef.current[currentFrame]?.setOpacity(value);
  };

  // Check if fullscreen is supported
  const isFullscreenSupported = () => {
    const elem = document.documentElement as any;
    return !!(
      elem.requestFullscreen ||
      elem.webkitRequestFullscreen ||
      elem.mozRequestFullScreen ||
      elem.msRequestFullscreen
    );
  };

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    const elem = containerRef.current as any;
    const doc = document as any;

    // Check if already in fullscreen
    const isCurrentlyFullscreen = !!(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    );

    if (!isCurrentlyFullscreen) {
      // Enter fullscreen
      const requestFs = 
        elem.requestFullscreen ||
        elem.webkitRequestFullscreen ||
        elem.mozRequestFullScreen ||
        elem.msRequestFullscreen;

      if (requestFs) {
        requestFs.call(elem).then(() => {
          setIsFullscreen(true);
          setTimeout(() => {
            mapRef.current?.invalidateSize();
          }, 100);
        }).catch((err: Error) => {
          console.error('Fullscreen error:', err);
        });
      }
    } else {
      // Exit fullscreen
      const exitFs = 
        doc.exitFullscreen ||
        doc.webkitExitFullscreen ||
        doc.mozCancelFullScreen ||
        doc.msExitFullscreen;

      if (exitFs) {
        exitFs.call(doc).then(() => {
          setIsFullscreen(false);
          setTimeout(() => {
            mapRef.current?.invalidateSize();
          }, 100);
        }).catch((err: Error) => {
          console.error('Exit fullscreen error:', err);
        });
      }
    }
  };

  return (
    <div ref={containerRef} className={isFullscreen ? 'fixed inset-0 z-50 bg-slate-950' : ''}>
      <Card className="border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/5 backdrop-blur-xl shadow-2xl overflow-hidden h-full">
        <CardContent className="p-0 h-full flex flex-col">
          <div className="relative flex-1">
            <div 
              ref={mapContainerRef} 
              className={isFullscreen ? 'h-full w-full' : 'w-full aspect-[2/1] max-h-[42vh]'}
              data-testid="radar-map"
            />
            
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              </div>
            )}
            
            {/* Premium blur overlay for free/logged-out users */}
            {!isPremium && (
              <div className="absolute inset-0 z-[900] flex items-center justify-center backdrop-blur-md bg-slate-900/40">
                <div className="text-center p-6 max-w-xs">
                  <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center shadow-lg ${
                    isAuthenticated 
                      ? 'bg-gradient-to-br from-yellow-400 to-amber-500 shadow-yellow-500/30' 
                      : 'bg-gradient-to-br from-blue-400 to-cyan-500 shadow-blue-500/30'
                  }`}>
                    <Lock className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    {isAuthenticated ? 'Live Radar Locked' : 'Sign Up to Unlock'}
                  </h3>
                  <p className="text-sm text-slate-300 mb-4">
                    {isAuthenticated 
                      ? 'Upgrade to Pro for live animated radar, overlay multiple hourly charts, and visualize ideal solunar and fishing conditions.'
                      : 'Start your free 14-day trial for live animated radar, overlay multiple hourly charts, and visualize ideal solunar and fishing conditions.'
                    }
                  </p>
                  {isAuthenticated ? (
                    <Button
                      onClick={onUpgradeClick}
                      className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-slate-900 font-semibold px-6 py-2 gap-2"
                      data-testid="button-upgrade-radar"
                    >
                      <Crown className="w-4 h-4" />
                      Unlock Radar
                    </Button>
                  ) : (
                    <a href="/login">
                      <Button
                        className="bg-gradient-to-r from-blue-400 to-cyan-500 hover:from-blue-500 hover:to-cyan-600 text-white font-semibold px-6 py-2 gap-2"
                        data-testid="button-signup-radar"
                      >
                        <Crown className="w-4 h-4" />
                        Start Free Trial
                      </Button>
                    </a>
                  )}
                </div>
              </div>
            )}
            
            {/* Fullscreen button - only show if supported */}
            {isFullscreenSupported() && (
              <button
                onClick={toggleFullscreen}
                className="absolute top-3 right-3 z-[1000] p-2 bg-slate-900/90 hover:bg-slate-800 border border-white/10 rounded-lg text-white transition-colors"
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            )}
          </div>
          
          {/* Controls */}
          <div className="bg-secondary/50 dark:bg-blue-950/30 border-t border-border p-3 space-y-3">
            {/* Playback controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="p-2 bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
                title={isPlaying ? "Pause" : "Play"}
                data-testid="button-play-pause"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              
              {/* Frame slider */}
              <div className="flex-1">
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, totalFrames - 1)}
                  value={currentFrame}
                  onChange={(e) => handleSliderChange(parseInt(e.target.value))}
                  className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-500"
                  disabled={totalFrames === 0}
                  data-testid="slider-frame"
                />
              </div>
              
              <span className="text-xs text-muted-foreground font-mono min-w-[4rem] text-right">
                {currentFrame + 1} / {totalFrames}
              </span>
            </div>
            
            {/* Speed, opacity, and quality controls */}
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-2">
                <label className="text-muted-foreground">Speed:</label>
                <select
                  value={animationSpeed}
                  onChange={(e) => setAnimationSpeed(parseInt(e.target.value))}
                  className="bg-background border border-border rounded px-2 py-1 text-foreground text-xs"
                  data-testid="select-speed"
                >
                  <option value="1000">Slow</option>
                  <option value="500">Normal</option>
                  <option value="300">Fast</option>
                  <option value="150">Very Fast</option>
                </select>
              </div>
              
              <div className="flex items-center gap-2">
                <label className="text-muted-foreground">Opacity:</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={radarOpacity}
                  onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
                  className="w-20 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-cyan-500"
                  data-testid="slider-opacity"
                />
                <span className="text-cyan-400 font-mono min-w-[2rem]">{Math.round(radarOpacity * 100)}%</span>
              </div>
              
              <div className="flex items-center gap-2">
                <label className="text-muted-foreground">Source:</label>
                <select
                  value={radarSource}
                  onChange={(e) => setRadarSource(e.target.value as 'iem')}
                  className="bg-background border border-border rounded px-2 py-1 text-foreground text-xs"
                  data-testid="select-radar-source"
                >
                  <option value="iem">IEM (5-min)</option>
                </select>
              </div>
            </div>
            
            {/* Attribution */}
            <div className="flex items-center justify-between text-xs pt-1 border-t border-white/5">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="bg-blue-500 w-2 h-2 rounded-full animate-pulse"></span>
                <span>Past 50 min • 5-min intervals • US only</span>
              </div>
              <a 
                href="https://mesonet.agron.iastate.edu/" 
                target="_blank" 
                rel="noreferrer" 
                className="text-muted-foreground hover:text-blue-400 transition-colors"
              >
                Iowa Environmental Mesonet
              </a>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
