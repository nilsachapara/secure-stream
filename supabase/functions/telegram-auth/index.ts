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
    if (!supabaseUrl || !serviceKey) return jsonResponse({ error: "Server misconfigured" }, 500);

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // Verify admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "No authorization header" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const { data: roleData } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleData) return jsonResponse({ error: "Admin access required" }, 403);

    const body = await req.json();

    // Get backend URL
    const { data: settings } = await supabaseAdmin
      .from("system_settings").select("key, value").eq("key", "telegram_backend_url").maybeSingle();
    const backendUrl = settings?.value;
    if (!backendUrl) return jsonResponse({ error: "Backend URL not configured. Save it in Telegram Setup → Credentials tab." }, 400);

    const baseUrl = backendUrl.replace(/\/+$/, "");

    // The Go backend uses POST /api/auth/otp for both OTP code and 2FA password
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/auth/otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (fetchErr) {
      return jsonResponse({ error: `Cannot reach backend at ${baseUrl}: ${fetchErr.message}` }, 502);
    }

    const responseText = await res.text();

    // Check if response is HTML (wrong URL)
    if (responseText.trimStart().startsWith("<!") || responseText.trimStart().startsWith("<html")) {
      return jsonResponse({ 
        error: "Backend URL returned HTML instead of JSON. Make sure the URL points to your Go filestream server (e.g. https://filestream1.onrender.com), not a website." 
      }, 400);
    }

    try {
      const data = JSON.parse(responseText);
      return jsonResponse(data, res.status);
    } catch {
      return jsonResponse({ message: responseText, success: res.ok }, res.status);
    }
  } catch (err) {
    return jsonResponse({ error: err.message || "Unexpected error" }, 500);
  }
});