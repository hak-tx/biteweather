import { useState, useEffect, useImperativeHandle, forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { X, ChevronRight, ChevronLeft } from "lucide-react";

interface TourStep {
  target: string;
  title: string;
  content: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  action?: () => void;
  cleanup?: () => void;
}

const tourSteps: TourStep[] = [
  {
    target: '[data-tour="day-cards"]',
    title: "Select Any Day",
    content: "Click on any day card to see its detailed hourly forecast. Scroll left and right to view all available days.",
    placement: 'bottom',
    action: () => {
      const dayCards = document.querySelector('[data-tour="day-cards"]');
      if (dayCards) {
        dayCards.scrollBy({ left: 200, behavior: 'smooth' });
        setTimeout(() => dayCards.scrollBy({ left: -200, behavior: 'smooth' }), 1000);
      }
    }
  },
  {
    target: '[data-tour="metric-buttons"]',
    title: "Compare Multiple Metrics",
    content: "Click these buttons to overlay different weather data on the same chart. See how temperature, wind, humidity, and more correlate with precipitation patterns.",
    placement: 'bottom',
    action: () => {
      const metricButtons = document.querySelector('[data-tour="metric-buttons"]');
      if (metricButtons) {
        const rect = metricButtons.getBoundingClientRect();
        const scrollTop = rect.top + window.scrollY - 150;
        window.scrollTo({ top: scrollTop, behavior: 'smooth' });
      }
    }
  },
  {
    target: '[data-tour="hourly-chart"]',
    title: "Interactive Hourly Chart",
    content: "Hover over the chart to see detailed values for each hour. The chart scrolls horizontally to continuously show the 15 day forecast trends by the hour.",
    placement: 'top',
    action: () => {
      // First, close any open bite forecast to prevent it from covering the chart
      const closeButton = document.querySelector('[data-testid="button-close-fishing-details"]') as HTMLButtonElement;
      if (closeButton) {
        closeButton.click();
      }
      
      const chart = document.querySelector('[data-tour="hourly-chart"]');
      if (chart) {
        // Trigger hover effect to show tooltip
        const rect = chart.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        // Create and dispatch mousemove event to trigger tooltip
        const mouseMoveEvent = new MouseEvent('mousemove', {
          bubbles: true,
          clientX: rect.left + centerX,
          clientY: rect.top + centerY,
          view: window
        });
        chart.dispatchEvent(mouseMoveEvent);
        
        // Also trigger mouseenter to ensure tooltip visibility
        const mouseEnterEvent = new MouseEvent('mouseenter', {
          bubbles: true,
          view: window
        });
        chart.dispatchEvent(mouseEnterEvent);
        
        // Scroll demo
        const scrollContainer = chart.closest('.overflow-x-auto');
        if (scrollContainer) {
          setTimeout(() => {
            scrollContainer.scrollBy({ left: 300, behavior: 'smooth' });
          }, 800);
          setTimeout(() => {
            scrollContainer.scrollBy({ left: -300, behavior: 'smooth' });
          }, 2300);
        }
      }
    }
  },
  {
    target: '[data-tour="bite-forecast"]',
    title: "BiteWeather Forecast",
    content: "Click on any day card above to reveal personalized fishing predictions. We analyze solunar periods, tides, weather patterns, and temperature changes to identify the best times to fish each day.",
    placement: 'top',
    action: () => {
      // Click the first day card to open the bite forecast
      const firstDayCard = document.querySelector('[data-testid="card-day-0"]') as HTMLElement;
      if (firstDayCard) {
        firstDayCard.click();
        
        // Wait for forecast to open, then scroll to show it
        setTimeout(() => {
          const biteForecast = document.querySelector('[data-tour="bite-forecast"]') as HTMLElement;
          if (biteForecast) {
            const rect = biteForecast.getBoundingClientRect();
            const scrollTop = rect.top + window.scrollY - 100;
            window.scrollTo({ top: scrollTop, behavior: 'smooth' });
          }
        }, 300);
      }
    },
    cleanup: () => {
      // Close the bite forecast when moving away from this step
      const closeButton = document.querySelector('[data-testid="button-close-fishing-details"]') as HTMLButtonElement;
      if (closeButton) {
        closeButton.click();
      }
    }
  },
  {
    target: '[data-tour="radar-map"]',
    title: "Live Weather Radar",
    content: "Explore the interactive radar map below to see real-time weather conditions in your area.",
    placement: 'top',
    action: () => {
      const radar = document.querySelector('[data-tour="radar-map"]') as HTMLElement;
      if (radar) {
        // Scroll to show tooltip above the radar (with buffer)
        const rect = radar.getBoundingClientRect();
        const scrollTop = rect.top + window.scrollY - 200; // 200px buffer for tooltip
        window.scrollTo({ top: scrollTop, behavior: 'smooth' });
        
        // Disable Leaflet map interactions to allow page scrolling
        const mapContainer = radar.querySelector('.leaflet-container');
        if (mapContainer) {
          (mapContainer as HTMLElement).style.pointerEvents = 'none';
        }
      }
    },
    cleanup: () => {
      // Re-enable Leaflet map interactions
      const radar = document.querySelector('[data-tour="radar-map"]');
      if (radar) {
        const mapContainer = radar.querySelector('.leaflet-container');
        if (mapContainer) {
          (mapContainer as HTMLElement).style.pointerEvents = '';
        }
      }
    }
  }
];

export interface WelcomeTourRef {
  restart: () => void;
}

export const WelcomeTour = forwardRef<WelcomeTourRef>((props, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [highlightPosition, setHighlightPosition] = useState<DOMRect | null>(null);

  useImperativeHandle(ref, () => ({
    restart: () => {
      setCurrentStep(0);
      setIsOpen(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }));

  useEffect(() => {
    const hasSeenTour = localStorage.getItem('weather_tour_completed');
    if (!hasSeenTour) {
      // Wait for page to load and metric animation to start
      setTimeout(() => setIsOpen(true), 1000);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const updateHighlight = () => {
      const step = tourSteps[currentStep];
      const element = document.querySelector(step.target);
      if (element) {
        const rect = element.getBoundingClientRect();
        setHighlightPosition(rect);
        
        // Execute step action if defined
        if (step.action) {
          setTimeout(step.action, 500);
        }
      }
    };

    updateHighlight();
    window.addEventListener('resize', updateHighlight);
    window.addEventListener('scroll', updateHighlight);

    return () => {
      window.removeEventListener('resize', updateHighlight);
      window.removeEventListener('scroll', updateHighlight);
    };
  }, [currentStep, isOpen]);

  const handleNext = () => {
    // Run cleanup for current step before moving
    const currentStepData = tourSteps[currentStep];
    if (currentStepData.cleanup) {
      currentStepData.cleanup();
    }
    
    if (currentStep < tourSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleClose();
    }
  };

  const handlePrev = () => {
    // Run cleanup for current step before moving
    const currentStepData = tourSteps[currentStep];
    if (currentStepData.cleanup) {
      currentStepData.cleanup();
    }
    
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleClose = () => {
    // Run cleanup for current step before closing
    const currentStepData = tourSteps[currentStep];
    if (currentStepData.cleanup) {
      currentStepData.cleanup();
    }
    
    setIsOpen(false);
    localStorage.setItem('weather_tour_completed', 'true');
    
    // Scroll to top of page
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSkip = () => {
    handleClose();
  };

  if (!isOpen || !highlightPosition) return null;

  const step = tourSteps[currentStep];
  const tooltipStyle = getTooltipPosition(highlightPosition, step.placement || 'bottom');

  return (
    <>
      {/* Spotlight highlight with dark overlay */}
      <div
        className="fixed z-[9999] pointer-events-none"
        style={{
          top: highlightPosition.top - 8,
          left: highlightPosition.left - 8,
          width: highlightPosition.width + 16,
          height: highlightPosition.height + 16,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.75), 0 0 30px rgba(59, 130, 246, 0.6)',
          borderRadius: '12px',
          border: '3px solid rgb(59, 130, 246)',
        }}
      />

      {/* Tour tooltip */}
      <div
        className="fixed z-[10000] bg-white dark:bg-slate-800 rounded-lg shadow-2xl p-6 max-w-sm animate-in fade-in slide-in-from-bottom-4"
        style={{
          top: tooltipStyle.top,
          left: tooltipStyle.left,
          transform: tooltipStyle.transform,
        }}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-blue-500 bg-blue-50 dark:bg-blue-950 px-2 py-1 rounded">
                Step {currentStep + 1} of {tourSteps.length}
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{step.title}</h3>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            data-testid="button-close-tour"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">
          {step.content}
        </p>

        <div className="flex items-center justify-between gap-3">
          <button
            onClick={handleSkip}
            className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
            data-testid="button-skip-tour"
          >
            Skip Tour
          </button>
          
          <div className="flex gap-2">
            {currentStep > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrev}
                className="gap-1"
                data-testid="button-tour-prev"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleNext}
              className="gap-1 bg-blue-500 hover:bg-blue-600"
              data-testid="button-tour-next"
            >
              {currentStep < tourSteps.length - 1 ? (
                <>
                  Next
                  <ChevronRight className="w-4 h-4" />
                </>
              ) : (
                'Finish'
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
});

WelcomeTour.displayName = 'WelcomeTour';

function getTooltipPosition(rect: DOMRect, placement: 'top' | 'bottom' | 'left' | 'right') {
  const offset = 20;
  const tooltipWidth = 384; // max-w-sm
  const tooltipHeight = 200; // approximate

  switch (placement) {
    case 'bottom':
      return {
        top: rect.bottom + offset,
        left: rect.left + rect.width / 2,
        transform: 'translateX(-50%)',
      };
    case 'top':
      return {
        top: rect.top - tooltipHeight - offset,
        left: rect.left + rect.width / 2,
        transform: 'translateX(-50%)',
      };
    case 'left':
      return {
        top: rect.top + rect.height / 2,
        left: rect.left - tooltipWidth - offset,
        transform: 'translateY(-50%)',
      };
    case 'right':
      return {
        top: rect.top + rect.height / 2,
        left: rect.right + offset,
        transform: 'translateY(-50%)',
      };
  }
}
