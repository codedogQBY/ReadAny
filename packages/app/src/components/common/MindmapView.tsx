/**
 * MindmapView — book structure mindmap visualization (placeholder)
 */
import { useTranslation } from "react-i18next";

interface MindmapViewProps {
  bookId: string;
}

export function MindmapView({ bookId }: MindmapViewProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <p className="text-lg font-medium text-muted-foreground">{t("mindmap.title")}</p>
        <p className="text-sm text-muted-foreground">
          {t("mindmap.description", { bookId })}
        </p>
        {/* TODO: Integrate mindmap rendering library */}
      </div>
    </div>
  );
}
