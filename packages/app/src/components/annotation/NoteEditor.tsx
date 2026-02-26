import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
/**
 * NoteEditor — markdown note editor
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface NoteEditorProps {
  initialTitle?: string;
  initialContent?: string;
  onSave: (title: string, content: string) => void;
  onCancel: () => void;
}

export function NoteEditor({
  initialTitle = "",
  initialContent = "",
  onSave,
  onCancel,
}: NoteEditorProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);

  return (
    <div className="flex flex-col gap-3 p-3">
      <Input placeholder={t("notes.noteTitle")} value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea
        placeholder={t("notes.writeMarkdown")}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={8}
        className="flex-1 resize-none font-mono text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" onClick={() => onSave(title, content)} disabled={!title.trim()}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
