import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const fileId = pathParts[pathParts.length - 1];
    const isDownload = url.searchParams.get("download") === "true";

    if (!fileId || fileId === "stream-proxy") {
      return new Response(JSON.stringify({ error: "Missing fileId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!botToken) {
      return new Response(JSON.stringify({ error: "Bot token not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Look up file record
    const { data: file, error: fileError } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .maybeSingle();

    if (fileError || !file) {
      return new Response(JSON.stringify({ error: "File not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get file path from Telegram Bot API
    const getFileRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${file.telegram_msg_id}`
    );
    const getFileData = await getFileRes.json();

    if (!getFileData.ok || !getFileData.result?.file_path) {
      return new Response(JSON.stringify({ error: "Could not get file from Telegram", details: getFileData }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const telegramFileUrl = `https://api.telegram.org/file/bot${botToken}/${getFileData.result.file_path}`;

    // Proxy the file content
    const upstreamHeaders: Record<string, string> = {};
    const rangeHeader = req.headers.get("Range");
    if (rangeHeader) {
      upstreamHeaders["Range"] = rangeHeader;
    }

    const upstream = await fetch(telegramFileUrl, { headers: upstreamHeaders });

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(JSON.stringify({ error: `Telegram file fetch failed: ${upstream.status}` }), {
        status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build response headers
    const responseHeaders: Record<string, string> = { ...corsHeaders };

    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const val = upstream.headers.get(h);
      if (val) responseHeaders[h] = val;
    }

    // Guess content type from filename
    if (!responseHeaders["content-type"] || responseHeaders["content-type"] === "application/octet-stream") {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        mp4: "video/mp4", mkv: "video/x-matroska", avi: "video/x-msvideo", webm: "video/webm",
        mp3: "audio/mpeg", flac: "audio/flac", ogg: "audio/ogg", wav: "audio/wav",
        pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
        gif: "image/gif", webp: "image/webp", zip: "application/zip",
      };
      responseHeaders["content-type"] = mimeMap[ext || ""] || "application/octet-stream";
    }

    responseHeaders["accept-ranges"] = "bytes";

    if (isDownload) {
      responseHeaders["content-disposition"] = `attachment; filename="${encodeURIComponent(file.name)}"`;
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Stream proxy error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
