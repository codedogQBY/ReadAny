/**
 * Notes page — under development
 */
import { Construction } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function Notes() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <Construction className="h-16 w-16" />
      <h2 className="text-xl font-medium">{t("notes.title")}</h2>
      <p className="text-sm">{t("notes.underDevelopment")}</p>
    </div>
  );
}
