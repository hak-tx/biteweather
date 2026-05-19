import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { isFreePreviewActive, getPreviewDaysRemaining } from "@shared/freePreview";

const TRIAL_DAYS = 14;

export function useAuth() {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  const refreshUser = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
  };

  const isAuthenticated = !!user;

  const isInTrialPeriod = () => {
    if (!user?.createdAt) return false;
    const createdDate = new Date(user.createdAt);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays < TRIAL_DAYS;
  };

  const getTrialDaysRemaining = () => {
    if (!user?.createdAt) return 0;
    const createdDate = new Date(user.createdAt);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, TRIAL_DAYS - diffDays);
  };

  // Check if user has active premium access from a promo code
  const hasPremiumAccess = () => {
    if (!user?.premiumAccessUntil) return false;
    const accessUntil = new Date(user.premiumAccessUntil);
    return accessUntil > new Date();
  };

  // Get days remaining for promo-granted premium access
  const getPremiumAccessDaysRemaining = () => {
    if (!user?.premiumAccessUntil) return 0;
    const accessUntil = new Date(user.premiumAccessUntil);
    const now = new Date();
    if (accessUntil <= now) return 0;
    return Math.ceil((accessUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  };

  const hasActiveSubscription = user?.subscriptionStatus === 'active' || user?.subscriptionTier === 'premium';
  const hasPromoAccess = isAuthenticated && hasPremiumAccess();
  const isInTrial = isAuthenticated && isInTrialPeriod() && !hasActiveSubscription && !hasPromoAccess;
  const isTrialExpired = isAuthenticated && !isInTrialPeriod() && !hasActiveSubscription && !hasPromoAccess;
  
  // Check if free preview is active
  const previewActive = isFreePreviewActive();
  const previewDaysRemaining = getPreviewDaysRemaining();
  
  // Premium access during preview: everyone gets premium
  // Otherwise: promo code access takes priority, then subscription, then trial
  const isPremium = previewActive || (isAuthenticated && (hasPromoAccess || hasActiveSubscription || isInTrialPeriod()));

  return {
    user,
    isLoading,
    isAuthenticated,
    isPremium,
    isInTrial,
    isTrialExpired,
    trialDaysRemaining: getTrialDaysRemaining(),
    hasActiveSubscription,
    hasPromoAccess,
    promoAccessDaysRemaining: getPremiumAccessDaysRemaining(),
    favoriteLocations: user?.favoriteLocations || [],
    refreshUser,
    // Free preview info
    isFreePreview: previewActive,
    freePreviewDaysRemaining: previewDaysRemaining,
  };
}
