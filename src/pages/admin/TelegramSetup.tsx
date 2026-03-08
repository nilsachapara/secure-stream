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
  Phone,
  KeyRound,
  ShieldCheck,
  CheckCircle2,
  Settings,
  Save,
  ExternalLink,
  Bot,
  Hash,
  Globe,
} from "lucide-react";

type SessionStep = "phone" | "otp" | "2fa" | "done";

export default function TelegramSetup() {
  const queryClient = useQueryClient();

  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [botToken, setBotToken] = useState("");
  const [backendUrl, setBackendUrl] = useState("");

  const [step, setStep] = useState<SessionStep>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [password2fa, setPassword2fa] = useState("");
  const [loading, setLoading] = useState(false);

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
          "telegram_backend_url",
          "telegram_session_string",
        ]);
      if (error) throw error;

      const map: Record<string, string> = {};
      data?.forEach((r) => (map[r.key] = r.value));

      if (map.telegram_api_id) setApiId(map.telegram_api_id);
      if (map.telegram_api_hash) setApiHash(map.telegram_api_hash);
      if (map.telegram_bot_token) setBotToken(map.telegram_bot_token);
      if (map.telegram_backend_url) setBackendUrl(map.telegram_backend_url);
      if (map.telegram_session_string) setStep("done");

      return map;
    },
  });

  const hasSession = !!savedSettings?.telegram_session_string;
  const hasCreds = !!savedSettings?.telegram_api_id;

  const saveCredentials = useMutation({
    mutationFn: async () => {
      const entries = [
        { key: "telegram_api_id", value: apiId },
        { key: "telegram_api_hash", value: apiHash },
        { key: "telegram_bot_token", value: botToken },
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
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const sendOtp = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-send-otp", {
        body: { phone },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success("OTP sent to your Telegram");
      setStep("otp");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-verify-otp", {
        body: { phone, otp },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (data.requires_2fa) {
        setStep("2fa");
      } else if (data.session_string) {
        toast.success("Telegram linked successfully!");
        setStep("done");
        queryClient.invalidateQueries({ queryKey: ["telegram-settings"] });
        queryClient.invalidateQueries({ queryKey: ["telegram-session-status"] });
      } else {
        throw new Error("Unexpected response");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const verify2fa = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-verify-2fa", {
        body: { phone, password: password2fa },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (data.session_string) {
        toast.success("Telegram linked successfully!");
        setStep("done");
        queryClient.invalidateQueries({ queryKey: ["telegram-settings"] });
        queryClient.invalidateQueries({ queryKey: ["telegram-session-status"] });
      } else {
        throw new Error("Failed to verify 2FA");
      }
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
              <Phone className="w-4 h-4" />
              Session
            </TabsTrigger>
          </TabsList>

          <TabsContent value="credentials">
            <Card className="glass-panel">
              <CardHeader>
                <CardTitle className="font-display text-lg">API Credentials</CardTitle>
                <CardDescription>
                  Get these from{" "}
                  <a
                    href="https://my.telegram.org/apps"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline inline-flex items-center gap-1"
                  >
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
                  <Label>Bot Token <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Input type="password" placeholder="123456:ABC-DEF..." value={botToken} onChange={(e) => setBotToken(e.target.value)} />
                  </div>
                </div>

                <Button
                  onClick={() => saveCredentials.mutate()}
                  disabled={saveCredentials.isPending || !apiId}
                  className="w-full"
                >
                  {saveCredentials.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Credentials
                    </>
                  )}
                </Button>

                {savedSettings?.telegram_api_id && (
                  <p className="text-xs text-success flex items-center gap-1.5 justify-center pt-2">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Credentials saved
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="session">
            <Card className="glass-panel">
              <CardHeader>
                <CardTitle className="font-display text-lg">
                  {step === "done" ? "Session Active" : "Link Telegram Account"}
                </CardTitle>
                <CardDescription>
                  {step === "done"
                    ? "Your Telegram session is active and connected."
                    : !hasCreds
                      ? "⚠️ Save your credentials first in the Credentials tab."
                      : "Complete the MTProto login to link your Telegram account."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {step === "phone" && (
                  <>
                    <div className="space-y-2">
                      <Label>Phone Number</Label>
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                        <Input placeholder="+1234567890" value={phone} onChange={(e) => setPhone(e.target.value)} />
                      </div>
                    </div>
                    <Button onClick={sendOtp} disabled={loading || !phone || !hasCreds} className="w-full">
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send OTP"}
                    </Button>
                    {!hasCreds && (
                      <p className="text-xs text-destructive text-center">
                        Save credentials first before starting a session.
                      </p>
                    )}
                  </>
                )}

                {step === "otp" && (
                  <>
                    <div className="space-y-2">
                      <Label>OTP Code</Label>
                      <div className="flex items-center gap-2">
                        <KeyRound className="w-4 h-4 text-muted-foreground shrink-0" />
                        <Input placeholder="12345" value={otp} onChange={(e) => setOtp(e.target.value)} />
                      </div>
                    </div>
                    <Button onClick={verifyOtp} disabled={loading || !otp} className="w-full">
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify OTP"}
                    </Button>
                  </>
                )}

                {step === "2fa" && (
                  <>
                    <div className="space-y-2">
                      <Label>2FA Password</Label>
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-muted-foreground shrink-0" />
                        <Input type="password" placeholder="Your 2FA password" value={password2fa} onChange={(e) => setPassword2fa(e.target.value)} />
                      </div>
                    </div>
                    <Button onClick={verify2fa} disabled={loading || !password2fa} className="w-full">
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify 2FA"}
                    </Button>
                  </>
                )}

                {step === "done" && (
                  <div className="flex flex-col items-center gap-3 py-6">
                    <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-success" />
                    </div>
                    <span className="font-medium text-success">Telegram is connected</span>
                    <Button variant="outline" size="sm" onClick={() => setStep("phone")}>
                      Re-authenticate
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
