import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, Crown, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UpgradeDialog({ open, onOpenChange }: UpgradeDialogProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: products } = useQuery<{data: any[]}>({
    queryKey: ["/api/products-with-prices"],
    enabled: open,
  });

  const handleCheckout = async (priceId: string) => {
    setLoading(priceId);
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ priceId })
      });
      const data = await response.json();
      
      if (response.status === 401) {
        onOpenChange(false);
        toast({
          title: "Please sign in first",
          description: "You need to be signed in to subscribe. Redirecting to login...",
        });
        setTimeout(() => setLocation('/login'), 1500);
        return;
      }
      
      if (data.url) {
        window.location.href = data.url;
      } else if (data.message) {
        toast({
          title: "Error",
          description: data.message,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Checkout error:', error);
      toast({
        title: "Error",
        description: "Failed to start checkout. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(null);
    }
  };

  const proProduct = products?.data?.[0];
  const monthlyPrice = proProduct?.prices?.find((p: any) => p.recurring?.interval === 'month');
  const annualPrice = proProduct?.prices?.find((p: any) => p.recurring?.interval === 'year');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-yellow-500" />
            Upgrade to BiteWeather Pro
          </DialogTitle>
          <DialogDescription>
            Get full access to extended forecasts and multiple metrics overlay
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 text-sm">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-amber-500" />
              <span>Full 15-day forecast (vs 5 days free)</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-amber-500" />
              <span>Multiple metrics overlay on charts</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-amber-500" />
              <span>Save unlimited favorite locations</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-amber-500" />
              <span>Priority access to new features</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="p-4">
              <div className="space-y-2">
                <h3 className="font-semibold">Monthly</h3>
                <div className="text-3xl font-bold">
                  ${monthlyPrice ? (monthlyPrice.unit_amount / 100).toFixed(2) : '1.00'}
                  <span className="text-sm font-normal text-muted-foreground">/month</span>
                </div>
                <Button
                  className="w-full"
                  onClick={() => monthlyPrice && handleCheckout(monthlyPrice.id)}
                  disabled={!monthlyPrice || loading === monthlyPrice?.id}
                  data-testid="button-checkout-monthly"
                >
                  {loading === monthlyPrice?.id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    'Subscribe Monthly'
                  )}
                </Button>
              </div>
            </Card>

            <Card className="p-4 border-2 border-yellow-500 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-yellow-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                BEST VALUE
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold">Annual</h3>
                <div className="text-3xl font-bold">
                  ${annualPrice ? (annualPrice.unit_amount / 100).toFixed(2) : '10.00'}
                  <span className="text-sm font-normal text-muted-foreground">/year</span>
                </div>
                <p className="text-xs text-muted-foreground">Save ${monthlyPrice && annualPrice ? ((monthlyPrice.unit_amount * 12 - annualPrice.unit_amount) / 100).toFixed(0) : '2'}/year</p>
                <Button
                  className="w-full"
                  variant="default"
                  onClick={() => annualPrice && handleCheckout(annualPrice.id)}
                  disabled={!annualPrice || loading === annualPrice?.id}
                  data-testid="button-checkout-annual"
                >
                  {loading === annualPrice?.id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    'Subscribe Annually'
                  )}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
