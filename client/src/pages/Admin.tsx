import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocation, Link } from "wouter";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Plus, Ban, Eye, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PromotionCode {
  id: number;
  code: string;
  type: "discount" | "free_access";
  discountPercent: number | null;
  freeAccessDays: number | null;
  maxRedemptions: number | null;
  currentRedemptions: number;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
  description: string | null;
  createdAt: string;
}

interface Redemption {
  id: number;
  userId: string;
  redeemedAt: string;
  user?: {
    email: string;
    firstName: string | null;
  };
}

export default function AdminPage() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [codes, setCodes] = useState<PromotionCode[]>([]);
  const [loadingCodes, setLoadingCodes] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [redemptionsDialogOpen, setRedemptionsDialogOpen] = useState(false);
  const [selectedCodeId, setSelectedCodeId] = useState<number | null>(null);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [loadingRedemptions, setLoadingRedemptions] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  
  const [newCode, setNewCode] = useState({
    code: "",
    type: "free_access" as "discount" | "free_access",
    discountPercent: 20,
    freeAccessDays: 30,
    maxRedemptions: "",
    validUntil: "",
    description: "",
  });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isLoading, isAuthenticated, setLocation]);

  useEffect(() => {
    if (isAuthenticated && user?.isAdmin) {
      fetchCodes();
    }
  }, [isAuthenticated, user?.isAdmin]);

  const fetchCodes = async () => {
    try {
      setLoadingCodes(true);
      const response = await fetch("/api/admin/promo-codes");
      if (response.ok) {
        const data = await response.json();
        setCodes(data.codes || []);
      } else if (response.status === 403) {
        toast({
          title: "Access Denied",
          description: "You don't have admin privileges.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load promo codes.",
        variant: "destructive",
      });
    } finally {
      setLoadingCodes(false);
    }
  };

  const fetchRedemptions = async (codeId: number) => {
    try {
      setLoadingRedemptions(true);
      const response = await fetch(`/api/admin/promo-codes/${codeId}/redemptions`);
      if (response.ok) {
        const data = await response.json();
        setRedemptions(data.redemptions || []);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load redemptions.",
        variant: "destructive",
      });
    } finally {
      setLoadingRedemptions(false);
    }
  };

  const handleCreateCode = async () => {
    if (!newCode.code.trim()) {
      toast({
        title: "Error",
        description: "Code is required.",
        variant: "destructive",
      });
      return;
    }

    try {
      setCreating(true);
      const response = await fetch("/api/admin/promo-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: newCode.code.trim(),
          type: newCode.type,
          discountPercent: newCode.type === "discount" ? newCode.discountPercent : null,
          freeAccessDays: newCode.type === "free_access" ? newCode.freeAccessDays : null,
          maxRedemptions: newCode.maxRedemptions ? parseInt(newCode.maxRedemptions) : null,
          validUntil: newCode.validUntil || null,
          description: newCode.description || null,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        toast({
          title: "Code Created",
          description: `Promo code ${newCode.code.toUpperCase()} has been created.`,
        });
        setCreateDialogOpen(false);
        setNewCode({
          code: "",
          type: "free_access",
          discountPercent: 20,
          freeAccessDays: 30,
          maxRedemptions: "",
          validUntil: "",
          description: "",
        });
        fetchCodes();
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to create code.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create code.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDeactivate = async (codeId: number) => {
    try {
      const response = await fetch(`/api/admin/promo-codes/${codeId}/deactivate`, {
        method: "POST",
      });

      if (response.ok) {
        toast({
          title: "Code Deactivated",
          description: "The promo code has been deactivated.",
        });
        fetchCodes();
      } else {
        toast({
          title: "Error",
          description: "Failed to deactivate code.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to deactivate code.",
        variant: "destructive",
      });
    }
  };

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const AdminHeader = () => (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-bold text-lg hover:text-primary transition-colors">
            BiteWeather
          </Link>
          <span className="text-muted-foreground">Admin</span>
        </div>
        <UserMenu />
      </div>
    </header>
  );

  if (!user?.isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <AdminHeader />
        <main className="container mx-auto px-4 py-8">
          <Card>
            <CardHeader>
              <CardTitle>Access Denied</CardTitle>
              <CardDescription>
                You don't have permission to access this page.
              </CardDescription>
            </CardHeader>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold">Promo Codes</h1>
            <p className="text-muted-foreground">Manage promotional codes for discounts and free access</p>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-code">
                <Plus className="h-4 w-4 mr-2" />
                Create Code
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Create Promo Code</DialogTitle>
                <DialogDescription>
                  Create a new promotional code for discounts or free premium access.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="code">Code</Label>
                  <Input
                    id="code"
                    placeholder="e.g., WELCOME2024"
                    value={newCode.code}
                    onChange={(e) => setNewCode({ ...newCode, code: e.target.value.toUpperCase() })}
                    className="uppercase"
                    data-testid="input-new-code"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="type">Type</Label>
                  <Select
                    value={newCode.type}
                    onValueChange={(value) => setNewCode({ ...newCode, type: value as "discount" | "free_access" })}
                  >
                    <SelectTrigger data-testid="select-code-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free_access">Free Premium Access</SelectItem>
                      <SelectItem value="discount">Discount on Subscription</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {newCode.type === "discount" ? (
                  <div className="grid gap-2">
                    <Label htmlFor="discountPercent">Discount Percentage</Label>
                    <Input
                      id="discountPercent"
                      type="number"
                      min="1"
                      max="100"
                      value={newCode.discountPercent}
                      onChange={(e) => setNewCode({ ...newCode, discountPercent: parseInt(e.target.value) || 0 })}
                      data-testid="input-discount-percent"
                    />
                  </div>
                ) : (
                  <div className="grid gap-2">
                    <Label htmlFor="freeAccessDays">Free Access Days</Label>
                    <Input
                      id="freeAccessDays"
                      type="number"
                      min="1"
                      value={newCode.freeAccessDays}
                      onChange={(e) => setNewCode({ ...newCode, freeAccessDays: parseInt(e.target.value) || 0 })}
                      data-testid="input-free-days"
                    />
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="maxRedemptions">Max Redemptions (optional)</Label>
                  <Input
                    id="maxRedemptions"
                    type="number"
                    min="1"
                    placeholder="Unlimited"
                    value={newCode.maxRedemptions}
                    onChange={(e) => setNewCode({ ...newCode, maxRedemptions: e.target.value })}
                    data-testid="input-max-redemptions"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="validUntil">Expires On (optional)</Label>
                  <Input
                    id="validUntil"
                    type="date"
                    value={newCode.validUntil}
                    onChange={(e) => setNewCode({ ...newCode, validUntil: e.target.value })}
                    data-testid="input-valid-until"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Input
                    id="description"
                    placeholder="Internal note about this code"
                    value={newCode.description}
                    onChange={(e) => setNewCode({ ...newCode, description: e.target.value })}
                    data-testid="input-description"
                  />
                </div>
                <Button
                  onClick={handleCreateCode}
                  disabled={creating}
                  className="w-full"
                  data-testid="button-submit-code"
                >
                  {creating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Creating...
                    </>
                  ) : (
                    "Create Code"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardContent className="pt-6">
            {loadingCodes ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : codes.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No promo codes yet. Create your first one!
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Redemptions</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {codes.map((code) => (
                    <TableRow key={code.id} data-testid={`row-code-${code.id}`}>
                      <TableCell className="font-mono font-bold">
                        <div className="flex items-center gap-2">
                          {code.code}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => copyToClipboard(code.code)}
                          >
                            {copiedCode === code.code ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={code.type === "free_access" ? "default" : "secondary"}>
                          {code.type === "free_access" ? "Free Access" : "Discount"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {code.type === "free_access"
                          ? `${code.freeAccessDays} days`
                          : `${code.discountPercent}% off`}
                      </TableCell>
                      <TableCell>
                        {code.currentRedemptions}
                        {code.maxRedemptions ? ` / ${code.maxRedemptions}` : ""}
                      </TableCell>
                      <TableCell>
                        {code.isActive ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300">
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {code.validUntil
                          ? new Date(code.validUntil).toLocaleDateString()
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedCodeId(code.id);
                              fetchRedemptions(code.id);
                              setRedemptionsDialogOpen(true);
                            }}
                            data-testid={`button-view-redemptions-${code.id}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {code.isActive && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeactivate(code.id)}
                              data-testid={`button-deactivate-${code.id}`}
                            >
                              <Ban className="h-4 w-4 text-red-500" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={redemptionsDialogOpen} onOpenChange={setRedemptionsDialogOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Redemptions</DialogTitle>
              <DialogDescription>
                Users who have redeemed this promo code.
              </DialogDescription>
            </DialogHeader>
            {loadingRedemptions ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : redemptions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No redemptions yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Redeemed At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {redemptions.map((redemption) => (
                    <TableRow key={redemption.id}>
                      <TableCell>
                        {redemption.user?.email || redemption.userId}
                      </TableCell>
                      <TableCell>
                        {new Date(redemption.redeemedAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
