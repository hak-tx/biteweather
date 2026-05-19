export function Footer() {
  // Build timestamp - updated whenever the app is published/deployed
  const buildDate = new Date('2025-12-15T17:21:00Z').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <footer className="border-t border-white/10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 mt-8">
      <div className="w-full px-4 md:px-8 py-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <div>
            © {new Date().getFullYear()} BiteWeather. All rights reserved.
          </div>
          <div className="flex items-center gap-1" data-testid="text-last-updated">
            <span className="opacity-60">Last updated:</span>
            <span className="font-medium text-amber-500">{buildDate}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
