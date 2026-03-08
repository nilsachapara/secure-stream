import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Phone, KeyRound, ShieldCheck, CheckCircle2 } from "lucide-react";

type Step = "phone" | "otp" | "2fa" | "done";

export default function TelegramSetup() {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [password2fa, setPassword2fa] = useState("");
  const [loading, setLoading] = useState(false);
  const backendUrl = import.meta.env.VITE_BACKEND_URL || "";

  const sendOtp = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${backendUrl}/telegram/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) throw new Error("Failed to send OTP");
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
      const res = await fetch(`${backendUrl}/telegram/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp }),
      });
      const data = await res.json();
      if (data.requires_2fa) {
        setStep("2fa");
      } else if (data.session_string) {
        await saveSession(data.session_string);
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
      const res = await fetch(`${backendUrl}/telegram/verify-2fa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password: password2fa }),
      });
      const data = await res.json();
      if (data.session_string) {
        await saveSession(data.session_string);
      } else {
        throw new Error("Failed to verify 2FA");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const saveSession = async (sessionString: string) => {
    const { error } = await supabase
      .from("system_settings")
      .upsert({ key: "telegram_session_string", value: sessionString }, { onConflict: "key" });
    if (error) {
      toast.error("Failed to save session");
    } else {
      toast.success("Telegram linked successfully!");
      setStep("done");
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-display font-bold mb-6">Telegram Setup</h1>

        <Card className="glass-panel">
          <CardHeader>
            <CardTitle className="font-display text-lg">
              {step === "done" ? "Connected" : "Link Telegram Account"}
            </CardTitle>
            <CardDescription>
              {step === "done"
                ? "Your Telegram account is linked."
                : "Complete the MTProto login to connect."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === "phone" && (
              <>
                <div className="space-y-2">
                  <Label>Phone Number</Label>
                  <div className="flex gap-2">
                    <Phone className="w-5 h-5 text-muted-foreground mt-2.5" />
                    <Input
                      placeholder="+1234567890"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                </div>
                <Button onClick={sendOtp} disabled={loading || !phone} className="w-full">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send OTP"}
                </Button>
              </>
            )}

            {step === "otp" && (
              <>
                <div className="space-y-2">
                  <Label>OTP Code</Label>
                  <div className="flex gap-2">
                    <KeyRound className="w-5 h-5 text-muted-foreground mt-2.5" />
                    <Input
                      placeholder="12345"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                    />
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
                  <div className="flex gap-2">
                    <ShieldCheck className="w-5 h-5 text-muted-foreground mt-2.5" />
                    <Input
                      type="password"
                      placeholder="Your 2FA password"
                      value={password2fa}
                      onChange={(e) => setPassword2fa(e.target.value)}
                    />
                  </div>
                </div>
                <Button onClick={verify2fa} disabled={loading || !password2fa} className="w-full">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify 2FA"}
                </Button>
              </>
            )}

            {step === "done" && (
              <div className="flex items-center gap-3 text-success py-4 justify-center">
                <CheckCircle2 className="w-6 h-6" />
                <span className="font-medium">Telegram is connected</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
