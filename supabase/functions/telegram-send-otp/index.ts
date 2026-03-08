import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Server misconfigured: missing environment variables" }, 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "No authorization header" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleData) return jsonResponse({ error: "Admin access required" }, 403);

    const { phone } = await req.json();
    if (!phone) return jsonResponse({ error: "Phone number required" }, 400);

    // Get backend URL
    const { data: settings } = await supabaseAdmin
      .from("system_settings")
      .select("key, value")
      .eq("key", "telegram_backend_url")
      .maybeSingle();

    const backendUrl = settings?.value;
    if (!backendUrl) {
      return jsonResponse({
        error: "Backend URL not configured. Go to Telegram Setup → Credentials tab and save your MTProto bridge URL."
      }, 400);
    }

    // Forward to MTProto bridge
    let res: Response;
    try {
      res = await fetch(`${backendUrl}/telegram/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
    } catch (fetchErr) {
      return jsonResponse({ error: `Cannot reach backend at ${backendUrl}: ${fetchErr.message}` }, 502);
    }

    const responseText = await res.text();

    if (!res.ok) {
      try {
        const errJson = JSON.parse(responseText);
        return jsonResponse({ error: errJson.message || errJson.error || "Backend error" }, res.status);
      } catch {
        return jsonResponse({ error: `Backend returned non-JSON response (status ${res.status})` }, 502);
      }
    }

    try {
      const data = JSON.parse(responseText);
      return jsonResponse(data);
    } catch {
      return jsonResponse({ error: "Backend returned invalid JSON" }, 502);
    }
  } catch (err) {
    return jsonResponse({ error: err.message || "Unexpected error" }, 500);
  }
});
