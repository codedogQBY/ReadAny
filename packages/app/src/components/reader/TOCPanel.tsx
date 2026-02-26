/**
 * TOCPanel — table of contents
 */
import { useTranslation } from "react-i18next";

interface TOCItem {
  id: string;
  title: string;
  level: number;
  cfi: string;
}

export function TOCPanel() {
  const { t } = useTranslation();
  const items: TOCItem[] = [];

  return (
    <div className="flex h-full flex-col p-3">
      <h3 className="mb-3 text-sm font-medium">{t("reader.toc")}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("reader.noBookOpen")}</p>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {items.map((item) => (
            <button
              key={item.id}
              className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
              style={{ paddingLeft: `${item.level * 16 + 8}px` }}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
