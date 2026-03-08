import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { useAuth } from "@/contexts/AuthContext";
import {
  Play,
  Film,
  Zap,
  Shield,
  ArrowRight,
  Tv,
  LogIn,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

export default function LandingPage() {
  const { user } = useAuth();
  const [selectedFile, setSelectedFile] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const { data: files, isLoading } = useQuery({
    queryKey: ["public-files-landing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("files")
        .select("*")
        .eq("is_private", false)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Ambient glow effects */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-accent/5 blur-[100px]" />
      </div>

      {/* Nav */}
      <header className="relative z-10 flex items-center justify-between px-6 md:px-12 py-5 border-b border-border/40 backdrop-blur-sm bg-background/60">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
            <Tv className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-display font-bold text-lg tracking-tight">
            TelegramDrive
          </span>
        </div>
        {user ? (
          <Link to="/dashboard">
            <Button size="sm" className="gap-2">
              Dashboard
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        ) : (
          <Link to="/login">
            <Button size="sm" variant="outline" className="gap-2">
              <LogIn className="w-4 h-4" />
              Sign In
            </Button>
          </Link>
        )}
      </header>

      {/* Hero */}
      <section className="relative z-10 px-6 md:px-12 pt-16 pb-12 md:pt-24 md:pb-16 max-w-5xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium mb-6 border border-primary/20">
          <Zap className="w-3.5 h-3.5" />
          Stream directly from Telegram
        </div>
        <h1 className="font-display text-4xl md:text-6xl font-bold tracking-tight leading-[1.1] mb-5">
          Your Media,{" "}
          <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Streamed Instantly
          </span>
        </h1>
        <p className="text-muted-foreground text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
          Access your Telegram cloud files with blazing-fast streaming.
          No downloads, no waiting — just press play.
        </p>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-3 mb-14">
          {[
            { icon: Zap, label: "Instant Streaming" },
            { icon: Shield, label: "Private & Secure" },
            { icon: Film, label: "All Formats" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-border/60 text-sm text-muted-foreground"
            >
              <Icon className="w-4 h-4 text-primary" />
              {label}
            </div>
          ))}
        </div>
      </section>

      {/* Public Content */}
      <section className="relative z-10 px-6 md:px-12 pb-20 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-xl md:text-2xl font-semibold">
            Latest Public Content
          </h2>
          {user && (
            <Link to="/dashboard">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                View all <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !files?.length ? (
          <div className="text-center py-16 glass-panel rounded-2xl">
            <Film className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-muted-foreground">No public content yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Content will appear here once the admin adds public files
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {files.map((file, i) => (
              <button
                key={file.id}
                onClick={() =>
                  setSelectedFile({ id: file.id, name: file.name })
                }
                className="group w-full text-left glass-panel rounded-xl p-4 flex items-center gap-4 hover:border-primary/40 hover:bg-card transition-all duration-200"
              >
                {/* Thumbnail placeholder */}
                <div className="relative w-16 h-16 md:w-20 md:h-20 rounded-lg bg-gradient-to-br from-primary/20 to-accent/10 flex items-center justify-center shrink-0 overflow-hidden group-hover:from-primary/30 group-hover:to-accent/20 transition-all">
                  <Film className="w-7 h-7 text-primary/60 group-hover:scale-0 transition-transform duration-200" />
                  <Play className="w-8 h-8 text-primary absolute scale-0 group-hover:scale-100 transition-transform duration-200 drop-shadow-lg" />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm md:text-base truncate group-hover:text-primary transition-colors">
                    {file.name}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    {file.size && (
                      <span className="text-xs text-muted-foreground">
                        {formatSize(file.size)}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground/60">
                      {new Date(file.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Play className="w-4 h-4 text-primary ml-0.5" />
                </div>
              </button>
            ))}
          </div>
        )}

        {/* CTA */}
        {!user && (
          <div className="mt-10 text-center glass-panel rounded-2xl p-8 border-primary/10">
            <h3 className="font-display text-lg font-semibold mb-2">
              Want access to private content?
            </h3>
            <p className="text-muted-foreground text-sm mb-5">
              Sign in to access your personal files and private streams
            </p>
            <Link to="/login">
              <Button className="gap-2">
                <LogIn className="w-4 h-4" />
                Sign In
              </Button>
            </Link>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/40 py-6 px-6 text-center">
        <p className="text-xs text-muted-foreground/60">
          Powered by TelegramDrive · Stream your cloud media
        </p>
      </footer>

      {/* Video Player */}
      {selectedFile && (
        <VideoPlayerModal
          open={!!selectedFile}
          onOpenChange={(open) => !open && setSelectedFile(null)}
          fileName={selectedFile.name}
          fileId={selectedFile.id}
        />
      )}
    </div>
  );
}
