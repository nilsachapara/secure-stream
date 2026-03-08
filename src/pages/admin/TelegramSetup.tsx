import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Loader2,
  KeyRound,
  ShieldCheck,
  CheckCircle2,
  Settings,
  Save,
  ExternalLink,
  Bot,
  Hash,
  Globe,
  RefreshCw,
  AlertCircle,
} from "lucide-react";

export default function TelegramSetup() {
  const queryClient = useQueryClient();

  // Credentials state
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [botToken, setBotToken] = useState("");
  const [phone, setPhone] = useState("");
  const [backendUrl, setBackendUrl] = useState("");

  // Auth state
  const [otpCode, setOtpCode] = useState("");
  const [password2fa, setPassword2fa] = useState("");
  const [loading, setLoading] = useState(false);

  // Load saved credentials
  const { data: savedSettings, isLoading: loadingSettings } = useQuery({
    queryKey: ["telegram-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("key, value")
        .in("key", [
          "telegram_api_id",
          "telegram_api_hash",
          "telegram_bot_token",
          "telegram_phone",
          "telegram_backend_url",
        ]);
      if (error) throw error;

      const map: Record<string, string> = {};
      data?.forEach((r) => (map[r.key] = r.value));

      if (map.telegram_api_id) setApiId(map.telegram_api_id);
      if (map.telegram_api_hash) setApiHash(map.telegram_api_hash);
      if (map.telegram_bot_token) setBotToken(map.telegram_bot_token);
      if (map.telegram_phone) setPhone(map.telegram_phone);
      if (map.telegram_backend_url) setBackendUrl(map.telegram_backend_url);

      return map;
    },
  });

  const hasCreds = !!savedSettings?.telegram_api_id && !!savedSettings?.telegram_backend_url;

  // Check backend auth status
  const { data: authStatus, isLoading: statusLoading, refetch: refetchStatus } = useQuery({
    queryKey: ["telegram-auth-status"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("telegram-status");
      if (error) return { authenticated: false, error: error.message };
      return data;
    },
    enabled: hasCreds,
    refetchInterval: 10000,
  });

  // Save credentials
  const saveCredentials = useMutation({
    mutationFn: async () => {
      const entries = [
        { key: "telegram_api_id", value: apiId },
        { key: "telegram_api_hash", value: apiHash },
        { key: "telegram_bot_token", value: botToken },
        { key: "telegram_phone", value: phone },
        { key: "telegram_backend_url", value: backendUrl },
      ];

      for (const entry of entries) {
        if (!entry.value) continue;
        const { error } = await supabase
          .from("system_settings")
          .upsert(entry, { onConflict: "key" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Credentials saved successfully");
      queryClient.invalidateQueries({ queryKey: ["telegram-settings"] });
      queryClient.invalidateQueries({ queryKey: ["telegram-auth-status"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Submit OTP code
  const submitOtp = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: { code: otpCode },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success("OTP submitted successfully");
      setOtpCode("");
      refetchStatus();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Submit 2FA password
  const submit2fa = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: { password: password2fa },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success("2FA password submitted successfully");
      setPassword2fa("");
      refetchStatus();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loadingSettings) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-display font-bold mb-6">Telegram Setup</h1>

        <Tabs defaultValue={hasCreds ? "session" : "credentials"}>
          <TabsList className="mb-4 w-full">
            <TabsTrigger value="credentials" className="flex-1 gap-2">
              <Settings className="w-4 h-4" />
              Credentials
            </TabsTrigger>
            <TabsTrigger value="session" className="flex-1 gap-2">
              <ShieldCheck className="w-4 h-4" />
              Auth Status
            </TabsTrigger>
          </TabsList>

          {/* ---- CREDENTIALS TAB ---- */}
          <TabsContent value="credentials">
            <Card className="glass-panel">
              <CardHeader>
                <CardTitle className="font-display text-lg">API Credentials</CardTitle>
                <CardDescription>
                  Get API ID & Hash from{" "}
                  <a href="https://my.telegram.org/apps" target="_blank" rel="noopener noreferrer"
                    className="text-primary underline inline-flex items-center gap-1">
                    my.telegram.org <ExternalLink className="w-3 h-3" />
                  </a>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>API ID</Label>
                  <div className="flex items-center gap-2">
                    <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Input placeholder="123456" value={apiId} onChange={(e) => setApiId(e.target.value)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>API Hash</Label>
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Input type="password" placeholder="Your API hash" value={apiHash} onChange={(e) => setApiHash(e.target.value)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Bot Token</Label>
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Input type="password" placeholder="123456:ABC-DEF..." value={botToken} onChange={(e) => setBotToken(e.target.value)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Phone Number</Label>
                  <div className="flex items-center gap-2">
                    <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Input placeholder="+911234567890" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Phone number linked to your Telegram account (with country code)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Backend URL</Label>
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Input placeholder="https://your-server.com" value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your Go filestream backend URL (the server running main.go)
                  </p>
                </div>

                <Button onClick={() => saveCredentials.mutate()} disabled={saveCredentials.isPending || !apiId || !backendUrl} className="w-full">
                  {saveCredentials.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <><Save className="w-4 h-4 mr-2" /> Save Credentials</>
                  )}
                </Button>

                {savedSettings?.telegram_api_id && savedSettings?.telegram_backend_url && (
                  <p className="text-xs text-success flex items-center gap-1.5 justify-center pt-2">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Credentials saved
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---- AUTH STATUS TAB ---- */}
          <TabsContent value="session">
            <Card className="glass-panel">
              <CardHeader>
                <CardTitle className="font-display text-lg flex items-center justify-between">
                  Backend Auth Status
                  <Button variant="ghost" size="icon" onClick={() => refetchStatus()} disabled={statusLoading}>
                    <RefreshCw className={`w-4 h-4 ${statusLoading ? "animate-spin" : ""}`} />
                  </Button>
                </CardTitle>
                <CardDescription>
                  {!hasCreds
                    ? "⚠️ Save your credentials first in the Credentials tab."
                    : "Your Go backend handles MTProto auth. Submit OTP/2FA codes here."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!hasCreds ? (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4" />
                    Save backend URL and credentials first.
                  </div>
                ) : (
                  <>
                    {/* Status indicator */}
                    <div className="rounded-lg border border-border p-4 flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${authStatus?.authenticated ? "bg-success" : "bg-warning"}`}
                        style={{ boxShadow: `0 0 8px ${authStatus?.authenticated ? "hsl(var(--success) / 0.5)" : "hsl(var(--warning) / 0.5)"}` }}
                      />
                      <div>
                        <p className="text-sm font-medium">
                          {statusLoading ? "Checking..." : authStatus?.authenticated ? "Authenticated" : "Waiting for auth"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {authStatus?.authenticated
                            ? "MTProto session is active"
                            : "Backend is waiting for OTP code or 2FA password"}
                        </p>
                      </div>
                    </div>

                    {/* OTP input */}
                    <div className="space-y-2">
                      <Label>OTP Code</Label>
                      <p className="text-xs text-muted-foreground">
                        When your backend starts, it sends an OTP to your Telegram. Enter it here:
                      </p>
                      <div className="flex gap-2">
                        <Input placeholder="12345" value={otpCode} onChange={(e) => setOtpCode(e.target.value)} />
                        <Button onClick={submitOtp} disabled={loading || !otpCode} className="shrink-0">
                          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit"}
                        </Button>
                      </div>
                    </div>

                    {/* 2FA input */}
                    <div className="space-y-2">
                      <Label>2FA Password <span className="text-muted-foreground text-xs">(if required)</span></Label>
                      <p className="text-xs text-muted-foreground">
                        If your account has 2FA enabled, enter the password after OTP:
                      </p>
                      <div className="flex gap-2">
                        <Input type="password" placeholder="2FA password" value={password2fa} onChange={(e) => setPassword2fa(e.target.value)} />
                        <Button onClick={submit2fa} disabled={loading || !password2fa} className="shrink-0">
                          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit"}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
