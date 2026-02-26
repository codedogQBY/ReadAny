/**
 * App — Tab-driven layout. No react-router page switching.
 * All opened tabs stay mounted; visibility controlled by CSS display.
 */
import { AppLayout } from "@/components/layout/AppLayout";

export default function App() {
  return <AppLayout />;
}
