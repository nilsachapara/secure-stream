import { Play, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface FileCardProps {
  name: string;
  size: number | null;
  canStream: boolean;
  onStream: () => void;
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

export function FileCard({ name, size, canStream, onStream }: FileCardProps) {
  return (
    <Card className="glass-panel hover:border-primary/30 transition-colors group">
      <CardContent className="p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Film className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate text-sm">{name}</p>
          <p className="text-xs text-muted-foreground">{formatSize(size)}</p>
        </div>
        {canStream && (
          <Button size="sm" onClick={onStream} className="shrink-0">
            <Play className="w-4 h-4 mr-1" />
            Stream
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
