import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { decodeConfig, encodeConfig } from "@readany/core/utils";
import { Check, Copy, Download, X } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface ConfigTransferProps<T> {
  getData: () => T;
  applyData: (data: unknown) => void;
  validate: (data: unknown) => boolean;
  label: string;
}

export function ConfigTransfer<T>({ getData, applyData, validate, label }: ConfigTransferProps<T>) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"idle" | "export" | "import">("idle");
  const [token, setToken] = useState("");
  const [importText, setImportText] = useState("");
  const [copied, setCopied] = useState(false);

  const handleExport = useCallback(() => {
    try {
      const data = getData();
      const encoded = encodeConfig(data);
      setToken(encoded);
      setMode("export");
    } catch {
      toast.error(t("settings.exportFailed", "导出失败，数据可能过大"));
    }
  }, [getData, t]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    toast.success(t("common.copied", "已复制"));
    setTimeout(() => setCopied(false), 2000);
  }, [token, t]);

  const applyImportedData = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        toast.error(t("settings.invalidConfig", "配置格式无效"));
        return;
      }
      const data = decodeConfig(trimmed);
      if (!data) {
        toast.error(t("settings.invalidConfig", "配置格式无效，口令可能不完整"));
        return;
      }
      if (!validate(data)) {
        toast.error(t("settings.invalidConfig", "配置格式无效"));
        return;
      }
      try {
        applyData(data);
        toast.success(t("settings.configImported", "配置已导入"));
        setMode("idle");
        setImportText("");
      } catch {
        toast.error(t("settings.importFailed", "导入失败"));
      }
    },
    [validate, applyData, t],
  );

  const handleImport = useCallback(() => applyImportedData(importText), [importText, applyImportedData]);

  if (mode === "export") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
        <textarea
          readOnly
          value={token}
          className="min-h-[60px] w-full rounded-md border border-input bg-background p-2 font-mono text-xs text-foreground"
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
        />
        <p className="text-xs text-muted-foreground">
          {t("settings.copyToken", "复制下方口令，在另一台设备导入")}
        </p>
        <div className="flex w-full gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={handleCopy}>
            {copied ? <Check className="mr-1.5 size-3.5" /> : <Copy className="mr-1.5 size-3.5" />}
            {t("common.copy", "复制口令")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMode("idle")}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  if (mode === "import") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
        <Textarea
          placeholder={t("settings.pasteConfig", "粘贴配置口令...")}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          className="min-h-[80px] font-mono text-xs"
        />
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={handleImport} disabled={!importText.trim()}>
            <Download className="mr-1.5 size-3.5" />
            {t("settings.importConfig", "导入")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setMode("idle"); setImportText(""); }}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={handleExport}>
        <Copy className="mr-1.5 size-3.5" />
        {t("settings.exportConfig", "导出")} {label}
      </Button>
      <Button variant="outline" size="sm" onClick={() => setMode("import")}>
        <Download className="mr-1.5 size-3.5" />
        {t("settings.importConfig", "导入")} {label}
      </Button>
    </div>
  );
}
