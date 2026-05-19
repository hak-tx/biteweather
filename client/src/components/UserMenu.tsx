import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User, LogOut, Crown, Settings, Ticket } from "lucide-react";
import { PromoCodeDialog } from "./PromoCodeDialog";

export function UserMenu() {
  const { user, isLoading, isPremium, hasPromoAccess, promoAccessDaysRemaining } = useAuth();
  const [promoDialogOpen, setPromoDialogOpen] = useState(false);

  if (isLoading) {
    return null;
  }

  if (!user) {
    return (
      <Button
        onClick={() => window.location.href = '/login'}
        variant="default"
        size="sm"
        className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
        data-testid="button-login"
      >
        Sign Up / Login
      </Button>
    );
  }

  // Get display name from user info
  const displayName = user.firstName || user.email?.split('@')[0] || 'Account';

  // Determine premium status text
  const getPremiumStatusText = () => {
    if (hasPromoAccess) {
      return `Premium (${promoAccessDaysRemaining} days left)`;
    }
    if (isPremium) {
      return 'Premium Member';
    }
    return 'Free Account';
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2" data-testid="button-user-menu">
            {user.profileImageUrl ? (
              <img
                src={user.profileImageUrl}
                alt={user.email || 'User'}
                className="w-5 h-5 rounded-full object-cover"
              />
            ) : (
              <User className="w-4 h-4" />
            )}
            <span className="hidden sm:inline max-w-[100px] truncate">{displayName}</span>
            {isPremium && <Crown className="w-4 h-4 text-yellow-500" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{user.email}</p>
              <p className="text-xs leading-none text-muted-foreground">
                {getPremiumStatusText()}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {!isPremium && (
            <DropdownMenuItem
              onClick={() => window.location.href = '/?upgrade=true'}
              data-testid="menu-upgrade"
            >
              <Crown className="mr-2 h-4 w-4" />
              <span>Upgrade to Pro</span>
            </DropdownMenuItem>
          )}
          {isPremium && (
            <DropdownMenuItem
              onClick={async () => {
                const response = await fetch('/api/customer-portal', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' }
                });
                const data = await response.json();
                if (data.url) {
                  window.location.href = data.url;
                }
              }}
              data-testid="menu-manage-subscription"
            >
              <Settings className="mr-2 h-4 w-4" />
              <span>Manage Subscription</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => setPromoDialogOpen(true)}
            data-testid="menu-redeem-code"
          >
            <Ticket className="mr-2 h-4 w-4" />
            <span>Redeem Promo Code</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => window.location.href = '/api/logout'}
            data-testid="menu-logout"
          >
            <LogOut className="mr-2 h-4 w-4" />
            <span>Log Out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PromoCodeDialog 
        open={promoDialogOpen} 
        onOpenChange={setPromoDialogOpen} 
      />
    </>
  );
}
