import { useState, useEffect } from "react";
import { Fish, Loader2, Sparkles, Check, Layers, Calendar, MapPin, Moon, Waves, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

export default function LoginPage() {
  // Prefetch weather data in background for faster navigation to home
  useEffect(() => {
    // Guard for SSR/test environments
    if (typeof window === 'undefined') return;
    
    const savedLocation = localStorage.getItem("weather_location") || "Houston,TX";
    const savedProvider = localStorage.getItem("weather_provider") || "visualcrossing";
    
    // Prefetch weather data so it's ready when user navigates home
    queryClient.prefetchQuery({
      queryKey: ['weather', savedLocation, savedProvider],
      queryFn: async () => {
        const res = await fetch(`/api/weather?q=${encodeURIComponent(savedLocation)}&provider=${savedProvider}`);
        if (!res.ok) throw new Error('Failed to fetch weather');
        return res.json();
      },
      // Uses global defaults: staleTime: Infinity, gcTime: Infinity
    });
  }, []);
  
  const [isLoading, setIsLoading] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerFirstName, setRegisterFirstName] = useState("");
  const [registerLastName, setRegisterLastName] = useState("");
  const { toast } = useToast();

  const handleGoogleLogin = () => {
    window.location.href = '/api/login?provider=google';
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast({
          title: "Login failed",
          description: data.error === "Invalid email or password" 
            ? "No account found with this email. Try creating an account instead."
            : (data.error || "Invalid email or password"),
          variant: "destructive",
        });
        return;
      }

      window.location.href = '/';
    } catch (error) {
      toast({
        title: "Login failed",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: registerEmail,
          password: registerPassword,
          firstName: registerFirstName,
          lastName: registerLastName,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast({
          title: "Registration failed",
          description: data.error || "Failed to create account",
          variant: "destructive",
        });
        return;
      }

      window.location.href = '/';
    } catch (error) {
      toast({
        title: "Registration failed",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const features = [
    { icon: Fish, text: "Solunar feeding times for best fishing" },
    { icon: Waves, text: "Tide predictions for coastal fishing" },
    { icon: Moon, text: "Moon phases & lunar fishing calendar" },
    { icon: Calendar, text: "15-day extended forecast with hourly detail" },
    { icon: MapPin, text: "Save unlimited favorite fishing spots" },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 relative">
      {/* Close button */}
      <a 
        href="/"
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
        data-testid="button-close-login"
      >
        <X className="w-5 h-5 text-white/70" />
      </a>
      
      <div className="w-full max-w-md space-y-6">
        {/* Feature Highlights Card */}
        <Card className="p-6 bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/20">
          <div className="text-center space-y-3 mb-5">
            <div className="flex justify-center">
              <div className="bg-gradient-to-br from-amber-400 to-orange-300 p-3 rounded-xl shadow-lg shadow-amber-500/20">
                <Fish className="w-8 h-8 text-slate-900" />
              </div>
            </div>
            <h1 className="text-2xl font-bold">Start Your Free Trial</h1>
            <p className="text-sm text-muted-foreground">
              Get 14 days of full premium access — no credit card required
            </p>
          </div>
          
          <div className="space-y-2.5">
            {features.map((feature, idx) => (
              <div key={idx} className="flex items-center gap-3 text-sm">
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <feature.icon className="w-4 h-4 text-amber-400" />
                </div>
                <span className="text-slate-300">{feature.text}</span>
                <Check className="w-4 h-4 text-amber-400 ml-auto flex-shrink-0" />
              </div>
            ))}
          </div>
          
          <div className="mt-5 pt-4 border-t border-white/10 text-center">
            <p className="text-xs text-muted-foreground">
              After trial: $1/month or $10/year • Cancel anytime
            </p>
          </div>
        </Card>

        {/* Auth Card */}
        <Card className="p-6 space-y-5">
          <div className="text-center">
            <h2 className="text-lg font-semibold">{showRegister ? 'Create Your Account' : 'Welcome Back'}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {showRegister ? 'Sign up in seconds to start your free trial' : 'Sign in to continue to BiteWeather'}
            </p>
          </div>

        <Button
          variant="outline"
          className="w-full h-10 gap-2"
          onClick={handleGoogleLogin}
          data-testid="button-login-google"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
          </div>
        </div>

        {!showRegister ? (
          <>
            {/* Login Form */}
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="you@example.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                  data-testid="input-login-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  placeholder="Your password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                  data-testid="input-login-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-login-submit">
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Sign In
              </Button>
            </form>
            
            {/* Create Account Link */}
            <div className="text-center pt-2 border-t">
              <p className="text-sm text-muted-foreground">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => setShowRegister(true)}
                  className="text-emerald-500 hover:text-emerald-400 font-medium hover:underline"
                  data-testid="link-create-account"
                >
                  Create account
                </button>
              </p>
            </div>
          </>
        ) : (
          <>
            {/* Registration Form */}
            <form onSubmit={handleEmailRegister} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="register-firstname">First Name</Label>
                  <Input
                    id="register-firstname"
                    type="text"
                    placeholder="John"
                    value={registerFirstName}
                    onChange={(e) => setRegisterFirstName(e.target.value)}
                    data-testid="input-register-firstname"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-lastname">Last Name</Label>
                  <Input
                    id="register-lastname"
                    type="text"
                    placeholder="Doe"
                    value={registerLastName}
                    onChange={(e) => setRegisterLastName(e.target.value)}
                    data-testid="input-register-lastname"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="register-email">Email</Label>
                <Input
                  id="register-email"
                  type="email"
                  placeholder="you@example.com"
                  value={registerEmail}
                  onChange={(e) => setRegisterEmail(e.target.value)}
                  required
                  data-testid="input-register-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="register-password">Password</Label>
                <Input
                  id="register-password"
                  type="password"
                  placeholder="At least 6 characters"
                  value={registerPassword}
                  onChange={(e) => setRegisterPassword(e.target.value)}
                  required
                  minLength={6}
                  data-testid="input-register-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-register-submit">
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Create Account
              </Button>
            </form>
            
            {/* Back to Login Link */}
            <div className="text-center pt-2 border-t">
              <p className="text-sm text-muted-foreground">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => setShowRegister(false)}
                  className="text-emerald-500 hover:text-emerald-400 font-medium hover:underline"
                  data-testid="link-sign-in"
                >
                  Sign in
                </button>
              </p>
            </div>
          </>
        )}

        <p className="text-xs text-center text-muted-foreground">
          By signing in, you agree to our Terms of Service and Privacy Policy
        </p>
        </Card>
      </div>
    </div>
  );
}
