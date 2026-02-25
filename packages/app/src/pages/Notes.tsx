/**
 * Notes page — under development
 */
import { Construction } from "lucide-react";

export default function Notes() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <Construction className="h-16 w-16" />
      <h2 className="text-xl font-medium">Notes</h2>
      <p className="text-sm">This feature is under development.</p>
    </div>
  );
}
