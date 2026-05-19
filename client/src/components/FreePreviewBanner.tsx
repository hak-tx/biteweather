import { Sparkles, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";

export function FreePreviewBanner() {
  const { isFreePreview, freePreviewDaysRemaining } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  if (!isFreePreview || dismissed) return null;

  return (
    <div className="bg-slate-100/80 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700/50">
      <div className="px-4 py-2 md:py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 md:gap-3 flex-1">
          <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-amber-500 dark:text-amber-400 shrink-0" />
          <p className="text-xs md:text-sm font-medium text-slate-700 dark:text-slate-200">
            <span className="font-bold">All Features Free!</span>
            <span className="hidden sm:inline"> Every feature is unlocked for all users.</span>
          </p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 hover:bg-slate-200 dark:hover:bg-white/10 rounded transition-colors shrink-0"
          aria-label="Dismiss banner"
        >
          <X className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        </button>
      </div>
    </div>
  );
}
