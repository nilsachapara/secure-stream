import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, Maximize2, Volume2, VolumeX } from "lucide-react";

interface VideoPlayerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  fileId: string;
}

export function VideoPlayerModal({ open, onOpenChange, fileName, fileId }: VideoPlayerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  const streamUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stream-proxy/${fileId}`;

  const isAudio = /\.(mp3|flac|ogg|wav|aac)$/i.test(fileName);

  useEffect(() => {
    if (!open) {
      setLoading(true);
      setError(null);
    }
  }, [open]);

  const handleFullscreen = () => {
    if (videoRef.current) {
      if (videoRef.current.requestFullscreen) {
        videoRef.current.requestFullscreen();
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden bg-background">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="font-display text-sm truncate pr-8">{fileName}</DialogTitle>
        </DialogHeader>

        <div className="relative w-full bg-black/90 rounded-b-lg overflow-hidden">
          {loading && !error && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/50">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-xs text-muted-foreground">Loading stream...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <AlertCircle className="w-10 h-10 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  if (videoRef.current) {
                    videoRef.current.load();
                  }
                }}
              >
                Retry
              </Button>
            </div>
          )}

          {isAudio ? (
            <div className="p-8 flex items-center justify-center">
              <audio
                ref={videoRef as any}
                controls
                autoPlay
                className="w-full"
                onCanPlay={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setError("Failed to load audio. The file may be too large or unavailable.");
                }}
              >
                <source src={streamUrl} />
              </audio>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                controls
                autoPlay
                muted={muted}
                playsInline
                className="w-full aspect-video"
                style={{ display: error ? "none" : "block" }}
                onCanPlay={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setError("Failed to load video. The file may be too large for Bot API (>20MB) — configure the Go backend for MTProto support.");
                }}
              >
                <source src={streamUrl} type="video/mp4" />
              </video>

              {!error && (
                <div className="absolute bottom-12 right-3 flex gap-1.5 z-20">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-8 h-8 bg-black/50 hover:bg-black/70 text-white"
                    onClick={() => {
                      setMuted(!muted);
                      if (videoRef.current) videoRef.current.muted = !muted;
                    }}
                  >
                    {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-8 h-8 bg-black/50 hover:bg-black/70 text-white"
                    onClick={handleFullscreen}
                  >
                    <Maximize2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
