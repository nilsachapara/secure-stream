import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, range, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers":
    "content-length, content-range, accept-ranges, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Extract fileId from URL path: /stream-proxy/{fileId}
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const fileId = pathParts[pathParts.length - 1];

    if (!fileId || fileId === "stream-proxy") {
      return new Response(JSON.stringify({ error: "Missing fileId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // Get backend URL
    const { data: settings } = await supabaseAdmin
      .from("system_settings")
      .select("value")
      .eq("key", "telegram_backend_url")
      .maybeSingle();

    const backendUrl = settings?.value;
    if (!backendUrl) {
      return new Response(
        JSON.stringify({ error: "Backend URL not configured" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const baseUrl = backendUrl.replace(/\/+$/, "");
    const streamUrl = `${baseUrl}/api/stream/${fileId}`;

    // Build headers for upstream request - forward Range header
    const upstreamHeaders: Record<string, string> = {};
    const rangeHeader = req.headers.get("Range");
    if (rangeHeader) {
      upstreamHeaders["Range"] = rangeHeader;
    }

    // Fetch from Go backend, following redirects automatically
    const upstream = await fetch(streamUrl, {
      headers: upstreamHeaders,
      redirect: "follow", // Follow 307 redirects to Telegram CDN
    });

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(
        JSON.stringify({ error: `Upstream error: ${upstream.status}` }),
        {
          status: upstream.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Build response headers
    const responseHeaders: Record<string, string> = { ...corsHeaders };

    // Copy relevant headers from upstream
    const copyHeaders = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
    ];
    for (const h of copyHeaders) {
      const val = upstream.headers.get(h);
      if (val) responseHeaders[h] = val;
    }

    // Default content-type if missing
    if (!responseHeaders["content-type"]) {
      responseHeaders["content-type"] = "video/mp4";
    }

    // Ensure accept-ranges is set
    responseHeaders["accept-ranges"] = "bytes";

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Stream proxy error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
