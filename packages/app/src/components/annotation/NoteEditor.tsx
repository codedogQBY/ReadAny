import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
/**
 * NoteEditor — markdown note editor
 */
import { useState } from "react";

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
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);

  return (
    <div className="flex flex-col gap-3 p-3">
      <Input placeholder="Note title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea
        placeholder="Write your note in Markdown..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={8}
        className="flex-1 resize-none font-mono text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave(title, content)} disabled={!title.trim()}>
          Save
        </Button>
      </div>
    </div>
  );
}
