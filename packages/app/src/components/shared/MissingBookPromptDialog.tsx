import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMissingBookPromptStore } from "@/stores/missing-book-prompt-store";

export function MissingBookPromptDialog() {
  const { open, title, description, confirmLabel, cancelLabel, resolvePrompt } =
    useMissingBookPromptStore();

  return (
    <Dialog open={open} onOpenChange={(next) => !next && resolvePrompt(false)}>
      <DialogContent className="max-w-[360px] gap-3">
        <DialogHeader className="gap-2">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-sm leading-5">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => resolvePrompt(false)}>
            {cancelLabel}
          </Button>
          <Button onClick={() => resolvePrompt(true)}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
