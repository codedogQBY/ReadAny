import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles } from "lucide-react";
/**
 * AskAIDialog — quick AI question dialog for selected text
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface AskAIDialogProps {
  selectedText: string;
  onSubmit: (question: string) => void;
  onClose: () => void;
}

export function AskAIDialog({ selectedText, onSubmit, onClose }: AskAIDialogProps) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");

  const handleSubmit = () => { if (question.trim()) onSubmit(question.trim()); };

  return (
    <div className="w-80 rounded-lg border border-border bg-background p-4 shadow-lg">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">{t("reader.askAI")}</h3>
      </div>
      <div className="mb-3 max-h-20 overflow-y-auto rounded-md bg-muted p-2 text-xs text-muted-foreground">
        "{selectedText.slice(0, 200)}{selectedText.length > 200 ? "..." : ""}"
      </div>
      <Textarea
        placeholder={t("reader.askQuestion")}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        className="mb-3"
        rows={2}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>{t("common.cancel")}</Button>
        <Button size="sm" onClick={handleSubmit} disabled={!question.trim()}>{t("common.ask")}</Button>
      </div>
    </div>
  );
}
