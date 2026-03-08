import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const update = await req.json();

    // Handle /setwebhook response check
    if (update.action === "set-webhook") {
      const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
      if (!botToken) {
        return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN not set" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const webhookUrl = `${supabaseUrl}/functions/v1/telegram-webhook`;
      const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message", "channel_post"] }),
      });
      const result = await res.json();
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Process Telegram update
    const message = update.message || update.channel_post;
    if (!message) {
      return new Response(JSON.stringify({ ok: true, skipped: "no message" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract file info from message
    let fileName = "unknown";
    let fileSize: number | null = null;
    let fileId: string | null = null;

    if (message.document) {
      fileName = message.document.file_name || "document";
      fileSize = message.document.file_size || null;
      fileId = message.document.file_id;
    } else if (message.video) {
      fileName = message.video.file_name || `video_${message.message_id}.mp4`;
      fileSize = message.video.file_size || null;
      fileId = message.video.file_id;
    } else if (message.audio) {
      fileName = message.audio.file_name || `audio_${message.message_id}.mp3`;
      fileSize = message.audio.file_size || null;
      fileId = message.audio.file_id;
    } else if (message.photo) {
      // Get largest photo
      const photo = message.photo[message.photo.length - 1];
      fileName = `photo_${message.message_id}.jpg`;
      fileSize = photo.file_size || null;
      fileId = photo.file_id;
    } else {
      return new Response(JSON.stringify({ ok: true, skipped: "no file in message" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!fileId) {
      return new Response(JSON.stringify({ ok: true, skipped: "no file_id" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try to extract a real filename from caption if it contains one
    if (message.caption) {
      const captionMatch = message.caption.match(/[\w\-. ]+\.\w{2,5}/);
      if (captionMatch) {
        // Clean markdown bold markers
        fileName = captionMatch[0].replace(/\*+/g, "").trim();
      }
      // Otherwise keep the original file_name from Telegram, don't use raw caption
    }

    // Insert into files table
    const { error: insertError } = await supabase.from("files").insert({
      name: fileName,
      telegram_msg_id: fileId,
      size: fileSize,
      is_private: false,
    });

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(JSON.stringify({ ok: false, error: insertError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, file: fileName }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
