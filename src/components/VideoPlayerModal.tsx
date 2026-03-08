import { useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

  // Build the edge function proxy URL
  const streamUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stream-proxy/${fileId}`;

  useEffect(() => {
    if (!open || !videoRef.current) return;

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
          src: streamUrl,
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
  }, [open, fileId, streamUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="font-display">{fileName}</DialogTitle>
        </DialogHeader>
        <div ref={videoRef} className="w-full rounded-lg overflow-hidden bg-secondary" />
      </DialogContent>
    </Dialog>
  );
}
