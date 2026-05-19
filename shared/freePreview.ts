// Free Preview Configuration
// Set to enable temporary free access to all features for launch

export const FREE_PREVIEW_CONFIG = {
  enabled: true,
};

export function isFreePreviewActive(): boolean {
  return FREE_PREVIEW_CONFIG.enabled;
}

export function getPreviewDaysRemaining(): number {
  return isFreePreviewActive() ? -1 : 0;
}
