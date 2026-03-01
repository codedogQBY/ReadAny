/**
 * App — Tab-driven layout. No react-router page switching.
 * All opened tabs stay mounted; visibility controlled by CSS display.
 */
import { AppLayout } from "@/components/layout/AppLayout";
import { Toaster } from "sonner";

export default function App() {
  return (
    <>
      <AppLayout />
      <Toaster position="top-center" richColors duration={2000} />
    </>
  );
}
