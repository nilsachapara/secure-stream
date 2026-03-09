import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { FileCard } from "@/components/FileCard";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { Loader2, FolderOpen } from "lucide-react";
import { toast } from "sonner";

interface DashboardProps {
  isPrivate?: boolean;
}

export default function Dashboard({ isPrivate = false }: DashboardProps) {
  const { user, isAdmin } = useAuth();
  const [selectedFile, setSelectedFile] = useState<{ id: string; name: string } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { data: files, isLoading } = useQuery({
    queryKey: ["files", isPrivate, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("files")
        .select("*")
        .eq("is_private", isPrivate)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const canAccess = (file: typeof files extends (infer T)[] | null ? T : never) => {
    if (isAdmin) return true;
    if (!file.is_private) return true;
    return file.allowed_users?.includes(user?.id ?? "") ?? false;
  };

  const canStream = (file: typeof files extends (infer T)[] | null ? T : never) => {
    if (!canAccess(file)) return false;
    return true;
  };

  const handleDownload = async (fileId: string, fileName: string) => {
    setDownloadingId(fileId);
    toast.info("Starting download...");

    try {
      const downloadUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stream-proxy/${fileId}?download=true`;
      
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(downloadUrl, {
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Download failed" }));
        throw new Error(errorData.error || `Download failed (${response.status})`);
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength === "0") {
        throw new Error("Server returned empty file. The file may be too large for current backend.");
      }

      const blob = await response.blob();
      
      if (blob.size === 0) {
        throw new Error("Downloaded file is empty (0 bytes). Check backend configuration.");
      }

      // Extract clean filename
      const match = fileName.match(/[\w\-. ]+\.\w{2,5}/);
      const cleanName = match ? match[0].replace(/\*+/g, "").trim() : "download";

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = cleanName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);

      toast.success(`Downloaded ${cleanName}`);
    } catch (err: any) {
      console.error("Download error:", err);
      toast.error(err.message || "Download failed");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-display font-bold mb-6">
          {isPrivate ? "Private Files" : "Public Files"}
        </h1>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !files?.length ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <FolderOpen className="w-12 h-12 mb-3 opacity-40" />
            <p>No files yet</p>
            <p className="text-xs mt-1">Send files to your Telegram bot to see them here</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {files.map((file) => (
              <FileCard
                key={file.id}
                name={file.name}
                size={file.size}
                canStream={canStream(file)}
                isDownloading={downloadingId === file.id}
                onStream={() => setSelectedFile({ id: file.id, name: file.name })}
                onDownload={() => handleDownload(file.id, file.name)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedFile && (
        <VideoPlayerModal
          open={!!selectedFile}
          onOpenChange={(open) => !open && setSelectedFile(null)}
          fileName={selectedFile.name}
          fileId={selectedFile.id}
        />
      )}
    </DashboardLayout>
  );
}
