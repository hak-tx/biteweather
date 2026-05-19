import { Crown, Sun, Moon, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { UserMenu } from "@/components/UserMenu";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { useTheme } from "next-themes";

interface AppHeaderProps {
  location: string;
  currentPage: "weather" | "tides";
  onUpgrade: () => void;
  onHelp?: () => void;
}

export function AppHeader({ location, currentPage, onUpgrade, onHelp }: AppHeaderProps) {
  const [, setLocation] = useLocation();
  const { isPremium } = useAuth();
  const { theme, setTheme } = useTheme();

  // Extract city and state from full location string
  const formatLocation = (loc: string): string => {
    const parts = loc.split(',').map(p => p.trim());
    
    // Look for state abbreviation (2 letters followed by optional ZIP)
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      // Match state abbreviation (2 capital letters)
      const stateMatch = part.match(/^([A-Z]{2})\s*\d*/);
      if (stateMatch && i > 0) {
        // Return city (previous part) and state
        return `${parts[i - 1]}, ${stateMatch[1]}`;
      }
    }
    
    // Fallback: return first two parts if available
    if (parts.length >= 2) {
      return `${parts[0]}, ${parts[1]}`;
    }
    
    return loc;
  };

  return (
    <header className="border-b border-white/10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="w-full px-4 md:px-8 py-2 md:py-3">
        {/* Single Row: Branding, Navigation, and User Menu */}
        <div className="flex items-center justify-between gap-2">
          {/* Left: Logo + Navigation */}
          <div className="flex items-center gap-2 md:gap-4">
            {/* Branding */}
            <div className="flex items-center gap-1.5 md:gap-2">
              <img src="/logo.png" alt="BiteWeather Logo" className="w-10 h-10 md:w-14 md:h-14 object-contain" />
              <h1 className="text-lg md:text-2xl font-bold tracking-tight">Bite<span className="text-amber-500 font-semibold">Weather</span></h1>
            </div>
          </div>

          {/* Right Section: Help, Theme Toggle, User Menu & Upgrade */}
          <div className="flex items-center gap-1.5 md:gap-3">
            {/* Help Button */}
            {onHelp && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onHelp}
                className="px-2 text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
                data-testid="button-help"
                title="Show help tour"
              >
                <HelpCircle className="w-4 h-4 md:w-5 md:h-5" />
              </Button>
            )}
            
            {/* Theme Toggle Switch */}
            <div className="flex items-center gap-1" data-testid="theme-toggle">
              <Sun className="w-3.5 h-3.5 text-yellow-500" />
              <Switch
                checked={theme === 'dark'}
                onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
                className="scale-75 data-[state=checked]:bg-amber-500"
              />
              <Moon className="w-3.5 h-3.5 text-slate-400" />
            </div>
            {!isPremium && (
              <Button
                size="sm"
                onClick={onUpgrade}
                className="px-2 md:px-3 py-1 md:py-1.5 text-xs gap-1 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-black font-semibold hover:shadow-md"
                data-testid="button-upgrade-header"
              >
                <Crown className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span className="hidden sm:inline">Pro</span>
              </Button>
            )}
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
