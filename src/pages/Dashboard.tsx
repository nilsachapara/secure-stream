import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { FileCard } from "@/components/FileCard";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { Loader2, FolderOpen } from "lucide-react";

interface DashboardProps {
  isPrivate?: boolean;
}

export default function Dashboard({ isPrivate = false }: DashboardProps) {
  const { user, isAdmin } = useAuth();
  const [selectedFile, setSelectedFile] = useState<{ id: string; name: string } | null>(null);

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

  const canStream = (file: typeof files extends (infer T)[] | null ? T : never) => {
    if (isAdmin) return true;
    if (!file.is_private) return true;
    return file.allowed_users?.includes(user?.id ?? "") ?? false;
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
          </div>
        ) : (
          <div className="grid gap-3">
            {files.map((file) => (
              <FileCard
                key={file.id}
                name={file.name}
                size={file.size}
                canStream={canStream(file)}
                onStream={() => setSelectedFile({ id: file.id, name: file.name })}
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
