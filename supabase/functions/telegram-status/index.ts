import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      return new Response(JSON.stringify({ authenticated: false, error: "Bot token not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check bot is working by calling getMe
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const data = await res.json();

    if (data.ok) {
      // Also get webhook info
      const whRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
      const whData = await whRes.json();

      return new Response(JSON.stringify({
        authenticated: true,
        bot: data.result,
        webhook: whData.result,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ authenticated: false, error: "Bot token invalid" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ authenticated: false, error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
