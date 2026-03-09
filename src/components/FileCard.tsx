import { Play, Film, Download, FileText, Image, Music, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface FileCardProps {
  name: string;
  size: number | null;
  canStream: boolean;
  isDownloading?: boolean;
  onStream: () => void;
  onDownload: () => void;
}

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

function extractFileName(name: string): string {
  const match = name.match(/[\w\-. ]+\.\w{2,5}/);
  if (match) return match[0].replace(/\*+/g, "").trim();
  return name.split("\n")[0].replace(/\*+/g, "").trim().slice(0, 80);
}

function getExt(name: string): string {
  const clean = extractFileName(name);
  return clean.split(".").pop()?.toLowerCase() || "";
}

function getFileIcon(name: string) {
  const ext = getExt(name);
  if (["mp4", "mkv", "avi", "mov", "webm"].includes(ext)) return Film;
  if (["mp3", "flac", "ogg", "wav", "aac"].includes(ext)) return Music;
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) return Image;
  return FileText;
}

function isStreamable(name: string) {
  const ext = getExt(name);
  return ["mp4", "mkv", "avi", "mov", "webm", "mp3", "flac", "ogg", "wav"].includes(ext);
}

export function FileCard({ name, size, canStream, isDownloading, onStream, onDownload }: FileCardProps) {
  const displayName = extractFileName(name);
  const Icon = getFileIcon(name);
  const streamable = isStreamable(name);

  return (
    <Card className="glass-panel hover:border-primary/30 transition-colors group">
      <CardContent className="p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate" title={displayName}>
            {displayName}
          </p>
          <p className="text-xs text-muted-foreground">{formatSize(size)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canStream && streamable && (
            <Button size="sm" onClick={onStream}>
              <Play className="w-4 h-4 mr-1" />
              Stream
            </Button>
          )}
          {canStream && (
            <Button size="sm" variant="outline" onClick={onDownload} disabled={isDownloading}>
              {isDownloading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
