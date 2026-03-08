import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import videojs from "video.js";
import "video.js/dist/video-js.css";

interface VideoPlayerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  fileId: string;
}

export function VideoPlayerModal({ open, onOpenChange, fileName, fileId }: VideoPlayerModalProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null);
  const [backendUrl, setBackendUrl] = useState("");

  // Get backend URL from system settings
  useEffect(() => {
    if (!open) return;
    supabase
      .from("system_settings")
      .select("value")
      .eq("key", "telegram_backend_url")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) setBackendUrl(data.value);
      });
  }, [open]);

  useEffect(() => {
    if (!open || !videoRef.current || !backendUrl) return;

    const videoElement = document.createElement("video-js");
    videoElement.classList.add("vjs-big-play-centered", "vjs-fluid");
    videoRef.current.appendChild(videoElement);

    const player = videojs(videoElement, {
      autoplay: true,
      controls: true,
      responsive: true,
      fluid: true,
      sources: [
        {
          src: `${backendUrl}/api/stream/${fileId}`,
          type: "video/mp4",
        },
      ],
    });

    playerRef.current = player;

    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [open, fileId, backendUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="font-display">{fileName}</DialogTitle>
        </DialogHeader>
        <div ref={videoRef} className="w-full rounded-lg overflow-hidden bg-secondary" />
        {!backendUrl && (
          <p className="text-xs text-muted-foreground text-center">
            Backend URL not configured — streaming unavailable
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
