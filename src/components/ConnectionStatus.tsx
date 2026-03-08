import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function ConnectionStatus() {
  const { data: status } = useQuery({
    queryKey: ["telegram-auth-status"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("telegram-status");
      if (error) return { authenticated: false };
      return data;
    },
    refetchInterval: 30000,
  });

  const isConnected = status?.authenticated;

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className={isConnected ? "status-dot-online" : "status-dot-offline"} />
      <span>{isConnected ? "Telegram Connected" : "Telegram Disconnected"}</span>
    </div>
  );
}
