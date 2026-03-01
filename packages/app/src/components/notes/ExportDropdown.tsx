import { useTranslation } from "react-i18next";
import { Download, FileText, FileJson, ClipboardCopy } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { ExportFormat } from "@/lib/export/annotation-exporter";

interface ExportDropdownProps {
  onExport: (format: ExportFormat) => void;
  variant?: "ghost" | "outline";
  size?: "icon" | "sm";
  disabled?: boolean;
}

const formats: { format: ExportFormat; icon: typeof FileText; labelKey: string }[] = [
  { format: "markdown", icon: FileText, labelKey: "notes.exportMarkdown" },
  { format: "json", icon: FileJson, labelKey: "notes.exportJSON" },
  { format: "obsidian", icon: FileText, labelKey: "notes.exportObsidian" },
  { format: "notion", icon: ClipboardCopy, labelKey: "notes.exportNotion" },
];

export function ExportDropdown({
  onExport,
  variant = "ghost",
  size = "icon",
  disabled,
}: ExportDropdownProps) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={disabled}
          title={t("notes.export")}
          className={size === "sm" ? "gap-1.5 h-7 text-xs" : undefined}
        >
          <Download className="h-3 w-3" />
          {size === "sm" && <span>{t("notes.export")}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {formats.map(({ format, icon: Icon, labelKey }) => (
          <DropdownMenuItem key={format} onClick={() => onExport(format)}>
            <Icon className="h-4 w-4 mr-2" />
            {t(labelKey)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
