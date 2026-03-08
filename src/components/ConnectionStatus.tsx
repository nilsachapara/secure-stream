import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function ConnectionStatus() {
  const { data: hasSession } = useQuery({
    queryKey: ["telegram-session-status"],
    queryFn: async () => {
      const { data } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "telegram_session_string")
        .maybeSingle();
      return !!data?.value;
    },
    refetchInterval: 30000,
  });

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className={hasSession ? "status-dot-online" : "status-dot-offline"} />
      <span>{hasSession ? "Telegram Connected" : "Telegram Disconnected"}</span>
    </div>
  );
}
