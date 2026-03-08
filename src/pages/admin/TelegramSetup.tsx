import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Loader2,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Bot,
  Webhook,
  Trash2,
} from "lucide-react";

export default function TelegramSetup() {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  // Check bot status & webhook info
  const { data: authStatus, isLoading: statusLoading, refetch: refetchStatus } = useQuery({
    queryKey: ["telegram-auth-status"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("telegram-status");
      if (error) return { authenticated: false, error: error.message };
      return data;
    },
    refetchInterval: 15000,
  });

  // Set webhook
  const setWebhook = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: { action: "set-webhook" },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(data?.description || "Webhook set successfully!");
      refetchStatus();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Delete webhook
  const deleteWebhook = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: { action: "delete-webhook" },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("Webhook deleted");
      refetchStatus();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const webhookUrl = authStatus?.webhook?.url;
  const hasWebhook = !!webhookUrl;
  const pendingUpdateCount = authStatus?.webhook?.pending_update_count ?? 0;

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-display font-bold mb-6">Telegram Setup</h1>

        {/* Bot Status */}
        <Card className="glass-panel mb-4">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Bot className="w-5 h-5" />
                Bot Status
              </span>
              <Button variant="ghost" size="icon" onClick={() => refetchStatus()} disabled={statusLoading}>
                <RefreshCw className={`w-4 h-4 ${statusLoading ? "animate-spin" : ""}`} />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {statusLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Checking...
              </div>
            ) : authStatus?.authenticated ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-border p-4 flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-success"
                    style={{ boxShadow: "0 0 8px hsl(var(--success) / 0.5)" }} />
                  <div>
                    <p className="text-sm font-medium">
                      @{authStatus.bot?.username} — Connected
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Bot ID: {authStatus.bot?.id}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4" />
                {authStatus?.error || "Bot token not configured. Add TELEGRAM_BOT_TOKEN in Cloud Secrets."}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Webhook Config */}
        <Card className="glass-panel">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Webhook className="w-5 h-5" />
              Webhook
            </CardTitle>
            <CardDescription>
              The webhook auto-inserts files into the database when sent to your bot.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasWebhook ? (
              <>
                <div className="rounded-lg border border-border p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    <p className="text-sm font-medium">Webhook Active</p>
                  </div>
                  <p className="text-xs text-muted-foreground break-all">
                    {webhookUrl}
                  </p>
                  {pendingUpdateCount > 0 && (
                    <p className="text-xs text-warning">
                      {pendingUpdateCount} pending updates
                    </p>
                  )}
                  {authStatus?.webhook?.last_error_message && (
                    <p className="text-xs text-destructive">
                      Last error: {authStatus.webhook.last_error_message}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => setWebhook.mutate()} disabled={setWebhook.isPending} className="flex-1">
                    {setWebhook.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                      <><RefreshCw className="w-4 h-4 mr-2" /> Re-set Webhook</>
                    )}
                  </Button>
                  <Button variant="destructive" onClick={() => deleteWebhook.mutate()} disabled={deleteWebhook.isPending}>
                    {deleteWebhook.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-lg border border-border p-4 flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-warning"
                    style={{ boxShadow: "0 0 8px hsl(var(--warning) / 0.5)" }} />
                  <p className="text-sm">No webhook set. Click below to activate.</p>
                </div>
                <Button onClick={() => setWebhook.mutate()} disabled={setWebhook.isPending || !authStatus?.authenticated} className="w-full">
                  {setWebhook.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                    <><Webhook className="w-4 h-4 mr-2" /> Set Webhook</>
                  )}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
