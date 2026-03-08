import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, range, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers":
    "content-length, content-range, accept-ranges, content-type, content-disposition",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const fileId = pathParts[pathParts.length - 1];

    if (!fileId || fileId === "stream-proxy") {
      return new Response(JSON.stringify({ error: "Missing fileId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Check if Go backend URL is configured
    const { data: settings } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "telegram_backend_url")
      .maybeSingle();

    const backendUrl = settings?.value;

    if (backendUrl) {
      // Route through Go backend (MTProto support for large files)
      const baseUrl = backendUrl.replace(/\/+$/, "");
      const isDownload = url.searchParams.get("download") === "true";
      const endpoint = isDownload ? "download" : "stream";
      const streamUrl = `${baseUrl}/api/${endpoint}/${fileId}`;

      const upstreamHeaders: Record<string, string> = {};
      const rangeHeader = req.headers.get("Range");
      if (rangeHeader) {
        upstreamHeaders["Range"] = rangeHeader;
      }

      const upstream = await fetch(streamUrl, {
        headers: upstreamHeaders,
        redirect: "follow",
      });

      if (!upstream.ok && upstream.status !== 206) {
        return new Response(
          JSON.stringify({ error: `Backend error: ${upstream.status}` }),
          { status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const responseHeaders: Record<string, string> = { ...corsHeaders };
      for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition", "transfer-encoding"]) {
        const val = upstream.headers.get(h);
        if (val) responseHeaders[h] = val;
      }
      if (!responseHeaders["content-type"]) {
        responseHeaders["content-type"] = "application/octet-stream";
      }
      responseHeaders["accept-ranges"] = "bytes";

      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    }

    // Fallback: Direct Bot API (20MB limit)
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      return new Response(JSON.stringify({ error: "No backend URL or bot token configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: file, error: fileError } = await supabase
      .from("files").select("*").eq("id", fileId).maybeSingle();

    if (fileError || !file) {
      return new Response(JSON.stringify({ error: "File not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const getFileRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${file.telegram_msg_id}`
    );
    const getFileData = await getFileRes.json();

    if (!getFileData.ok || !getFileData.result?.file_path) {
      return new Response(JSON.stringify({ error: "Could not get file from Telegram (>20MB requires Go backend)", details: getFileData }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const telegramFileUrl = `https://api.telegram.org/file/bot${botToken}/${getFileData.result.file_path}`;

    const upstreamHeaders: Record<string, string> = {};
    const rangeHeader = req.headers.get("Range");
    if (rangeHeader) upstreamHeaders["Range"] = rangeHeader;

    const upstream = await fetch(telegramFileUrl, { headers: upstreamHeaders });

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(JSON.stringify({ error: `Telegram error: ${upstream.status}` }), {
        status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const responseHeaders: Record<string, string> = { ...corsHeaders };
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const val = upstream.headers.get(h);
      if (val) responseHeaders[h] = val;
    }

    // Extract real filename from possibly caption-polluted name
    const fileNameMatch = file.name.match(/[\w\-. ]+\.\w{2,5}/);
    const cleanName = fileNameMatch ? fileNameMatch[0].replace(/\*+/g, "").trim() : file.name;
    const ext = cleanName.split(".").pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      mp4: "video/mp4", mkv: "video/x-matroska", avi: "video/x-msvideo", webm: "video/webm",
      mp3: "audio/mpeg", flac: "audio/flac", pdf: "application/pdf",
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    };
    if (!responseHeaders["content-type"] || responseHeaders["content-type"] === "application/octet-stream") {
      responseHeaders["content-type"] = mimeMap[ext || ""] || "application/octet-stream";
    }
    responseHeaders["accept-ranges"] = "bytes";

    if (url.searchParams.get("download") === "true") {
      responseHeaders["content-disposition"] = `attachment; filename="${encodeURIComponent(cleanName)}"`;
    }

    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Stream proxy error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
