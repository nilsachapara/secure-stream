import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, range, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers":
    "content-length, content-range, accept-ranges, content-type, content-disposition",
};

function extractCleanName(name: string): string {
  const match = name.match(/[\w\-. ]+\.\w{2,5}/);
  return match ? match[0].replace(/\*+/g, "").trim() : name.split("\n")[0].trim().slice(0, 80);
}

function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const mimeMap: Record<string, string> = {
    mp4: "video/mp4", mkv: "video/x-matroska", avi: "video/x-msvideo", webm: "video/webm",
    mov: "video/quicktime",
    mp3: "audio/mpeg", flac: "audio/flac", ogg: "audio/ogg", wav: "audio/wav",
    pdf: "application/pdf",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
    zip: "application/zip", rar: "application/x-rar-compressed",
  };
  return mimeMap[ext] || "application/octet-stream";
}

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

    const isDownload = url.searchParams.get("download") === "true";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const supabase = createClient(supabaseUrl, serviceKey);

    // Always fetch file info from DB (needed for name/size/telegram_msg_id)
    const { data: file, error: fileError } = await supabase
      .from("files").select("*").eq("id", fileId).maybeSingle();

    if (fileError || !file) {
      return new Response(JSON.stringify({ error: "File not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanName = extractCleanName(file.name);
    const contentType = getMimeType(cleanName);
    const fileSize = file.size || 0;

    // Check if Go backend URL is configured
    const { data: settings } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "telegram_backend_url")
      .maybeSingle();

    const backendUrl = settings?.value;

    // Strategy: 
    // 1. For files ≤20MB: always use Bot API directly (reliable)
    // 2. For files >20MB: try Go backend, if it fails return clear error
    const isSmallFile = fileSize > 0 && fileSize <= 20 * 1024 * 1024;

    // Try Bot API for small files (or as primary method if no backend configured)
    if (isSmallFile || !backendUrl) {
      if (!botToken) {
        return new Response(JSON.stringify({ error: "No bot token configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const getFileRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getFile?file_id=${file.telegram_msg_id}`
      );
      const getFileData = await getFileRes.json();

      if (!getFileData.ok || !getFileData.result?.file_path) {
        // Bot API can't handle this file (>20MB)
        if (!backendUrl) {
          return new Response(JSON.stringify({ 
            error: "File too large for Bot API (>20MB). Configure a Go backend for large file support.",
            size: fileSize
          }), {
            status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        // Fall through to Go backend below
      } else {
        // Bot API works - stream directly from Telegram
        const telegramFileUrl = `https://api.telegram.org/file/bot${botToken}/${getFileData.result.file_path}`;

        const upstreamHeaders: Record<string, string> = {};
        const rangeHeader = req.headers.get("Range");
        if (rangeHeader) upstreamHeaders["Range"] = rangeHeader;

        const upstream = await fetch(telegramFileUrl, { headers: upstreamHeaders });

        if (!upstream.ok && upstream.status !== 206) {
          return new Response(JSON.stringify({ error: `Telegram fetch error: ${upstream.status}` }), {
            status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const responseHeaders: Record<string, string> = { ...corsHeaders };
        responseHeaders["content-type"] = contentType;
        responseHeaders["accept-ranges"] = "bytes";

        // Use actual content-length from Telegram or DB
        const upstreamCL = upstream.headers.get("content-length");
        if (upstreamCL) responseHeaders["content-length"] = upstreamCL;

        const upstreamCR = upstream.headers.get("content-range");
        if (upstreamCR) responseHeaders["content-range"] = upstreamCR;

        if (isDownload) {
          responseHeaders["content-disposition"] = `attachment; filename="${encodeURIComponent(cleanName)}"`;
        }

        return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
      }
    }

    // Large file path: use Go backend
    if (backendUrl) {
      const baseUrl = backendUrl.replace(/\/+$/, "");
      const endpoint = isDownload ? "download" : "stream";
      const streamUrl = `${baseUrl}/api/${endpoint}/${fileId}`;

      const upstreamHeaders: Record<string, string> = {};
      const rangeHeader = req.headers.get("Range");
      if (rangeHeader) upstreamHeaders["Range"] = rangeHeader;

      try {
        const upstream = await fetch(streamUrl, {
          headers: upstreamHeaders,
          redirect: "follow",
        });

        // Check if backend actually returned data
        const upstreamCL = upstream.headers.get("content-length");
        const hasBody = upstreamCL !== "0" && upstreamCL !== null;

        if (!upstream.ok && upstream.status !== 206) {
          return new Response(
            JSON.stringify({ error: `Go backend error: ${upstream.status}. Large file streaming requires a working Go backend.` }),
            { status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // If backend returned empty body, return error instead of 0KB file
        if (upstreamCL === "0" || (!hasBody && upstream.status === 200)) {
          // Try to read the body to check if it's actually empty
          const body = await upstream.arrayBuffer();
          if (body.byteLength === 0) {
            return new Response(
              JSON.stringify({ 
                error: "Go backend returned empty response. The MTProto file_id decoder may not be working. Please check your Go backend logs.",
                suggestion: "The Go backend needs a working file_id decoder for files >20MB"
              }),
              { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          // Body actually had data despite no content-length - stream it
          const responseHeaders: Record<string, string> = { ...corsHeaders };
          responseHeaders["content-type"] = contentType;
          responseHeaders["content-length"] = String(body.byteLength);
          if (isDownload) {
            responseHeaders["content-disposition"] = `attachment; filename="${encodeURIComponent(cleanName)}"`;
          }
          return new Response(body, { status: 200, headers: responseHeaders });
        }

        const responseHeaders: Record<string, string> = { ...corsHeaders };
        responseHeaders["content-type"] = contentType;
        responseHeaders["accept-ranges"] = "bytes";
        if (upstreamCL) responseHeaders["content-length"] = upstreamCL;

        for (const h of ["content-range", "content-disposition", "transfer-encoding"]) {
          const val = upstream.headers.get(h);
          if (val) responseHeaders[h] = val;
        }

        if (isDownload && !responseHeaders["content-disposition"]) {
          responseHeaders["content-disposition"] = `attachment; filename="${encodeURIComponent(cleanName)}"`;
        }

        return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
      } catch (fetchErr) {
        return new Response(
          JSON.stringify({ error: `Cannot reach Go backend: ${fetchErr.message}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(JSON.stringify({ error: "No streaming method available for this file" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Stream proxy error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
