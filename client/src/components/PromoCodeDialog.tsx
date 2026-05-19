import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Ticket, Check, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ValidationResult {
  valid: boolean;
  error?: string;
  type?: "discount" | "free_access";
  discountPercent?: number;
  freeAccessDays?: number;
  description?: string;
}

interface RedemptionResult {
  success: boolean;
  error?: string;
  type?: "discount" | "free_access";
  message?: string;
  premiumUntil?: string;
  stripeCouponId?: string;
  discountPercent?: number;
}

interface PromoCodeDialogProps {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function PromoCodeDialog({ trigger, open: controlledOpen, onOpenChange }: PromoCodeDialogProps) {
  const { refreshUser } = useAuth();
  const { toast } = useToast();
  const [internalOpen, setInternalOpen] = useState(false);
  const [code, setCode] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (value: boolean) => {
    if (isControlled) {
      onOpenChange?.(value);
    } else {
      setInternalOpen(value);
    }
  };

  const handleValidate = async () => {
    if (!code.trim()) return;
    
    setIsValidating(true);
    setValidation(null);
    
    try {
      const response = await fetch("/api/promo/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const result = await response.json();
      setValidation(result);
    } catch (error) {
      setValidation({ valid: false, error: "Failed to validate code" });
    } finally {
      setIsValidating(false);
    }
  };

  const handleRedeem = async () => {
    if (!code.trim() || !validation?.valid) return;
    
    setIsRedeeming(true);
    
    try {
      const response = await fetch("/api/promo/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const result: RedemptionResult = await response.json();
      
      if (result.success) {
        toast({
          title: "Code Redeemed!",
          description: result.message,
        });
        
        if (result.type === "free_access") {
          refreshUser();
        } else if (result.type === "discount") {
          toast({
            title: "Discount Applied",
            description: `Your ${result.discountPercent}% discount will be applied at checkout.`,
          });
        }
        
        setOpen(false);
        setCode("");
        setValidation(null);
      } else {
        toast({
          title: "Failed to Redeem",
          description: result.error || "Unable to redeem this code",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to redeem code. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRedeeming(false);
    }
  };

  const handleCodeChange = (value: string) => {
    setCode(value.toUpperCase());
    setValidation(null);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen);
      if (!isOpen) {
        setCode("");
        setValidation(null);
      }
    }}>
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="outline" size="sm" className="gap-2">
              <Ticket className="h-4 w-4" />
              Redeem Code
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Redeem Promo Code</DialogTitle>
          <DialogDescription>
            Enter a promo code to get discounts or free premium access.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="promo-code">Promo Code</Label>
            <div className="flex gap-2">
              <Input
                id="promo-code"
                placeholder="Enter code"
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && code.trim()) {
                    handleValidate();
                  }
                }}
                className="uppercase"
                data-testid="input-promo-code"
              />
              <Button
                onClick={handleValidate}
                disabled={!code.trim() || isValidating}
                variant="secondary"
                data-testid="button-validate-code"
              >
                {isValidating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Check"
                )}
              </Button>
            </div>
          </div>

          {validation && (
            <div
              className={`p-3 rounded-lg border ${
                validation.valid
                  ? "bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800"
                  : "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800"
              }`}
            >
              <div className="flex items-start gap-2">
                {validation.valid ? (
                  <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
                ) : (
                  <X className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                )}
                <div className="flex-1">
                  {validation.valid ? (
                    <>
                      <p className="font-medium text-amber-800 dark:text-amber-200">
                        Valid Code!
                      </p>
                      <p className="text-sm text-amber-700 dark:text-amber-300">
                        {validation.type === "free_access"
                          ? `Get ${validation.freeAccessDays} days of free premium access`
                          : `Get ${validation.discountPercent}% off your subscription`}
                      </p>
                      {validation.description && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                          {validation.description}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-red-800 dark:text-red-200">
                      {validation.error}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {validation?.valid && (
            <Button
              onClick={handleRedeem}
              disabled={isRedeeming}
              className="w-full"
              data-testid="button-redeem-code"
            >
              {isRedeeming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Redeeming...
                </>
              ) : (
                "Redeem Code"
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
