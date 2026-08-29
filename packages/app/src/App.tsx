/**
 * App — Tab-driven layout. No react-router page switching.
 * All opened tabs stay mounted; visibility controlled by CSS display.
 */
import { AppLayout } from "@/components/layout/AppLayout";
import { ContextMenu } from "@/components/layout/ContextMenu";
import { UpdateNotification } from "@/components/layout/UpdateNotification";
import { useAutoSync } from "@/hooks/use-sync";
import { DesktopSyncAdapter } from "@/lib/sync/sync-adapter-desktop";
import { setSyncAdapter } from "@readany/core/sync";
import { Toaster } from "sonner";

// Register the desktop sync adapter once at module load
setSyncAdapter(new DesktopSyncAdapter());

export default function App() {
  useAutoSync();

  return (
    <>
      <AppLayout />
      <Toaster position="top-center" richColors duration={2000} />
      <UpdateNotification />
      <ContextMenu />
    </>
  );
}
