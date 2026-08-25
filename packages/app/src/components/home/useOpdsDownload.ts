import {
  type ImportBooksResult,
  type OpdsAcquisition,
  OpdsClient,
  type OpdsCredentials,
  type OpdsDownloadProgress,
  OpdsError,
  type OpdsPublication,
  createExclusiveOpdsDownloadRunner,
  downloadOpdsAcquisition,
  listSupportedAcquisitions,
  toBookMeta,
} from "@readany/core";
import { type IPlatformService, getPlatformService } from "@readany/core/services";
import { generateId } from "@readany/core/utils";
import { useMemo, useState } from "react";
import type { DesktopImportFile } from "../../lib/book/imported-book-meta";
import { useLibraryStore } from "../../stores/library-store";

type OpdsDownloadPlatform = Pick<
  IPlatformService,
  "writeFile" | "deleteFile" | "mkdir" | "joinPath"
>;

export interface OpdsDownloadRequest {
  publication: OpdsPublication;
  acquisition?: OpdsAcquisition;
  catalogOrigin: string;
  credentials?: OpdsCredentials;
  signal?: AbortSignal;
  onProgress?: (progress: OpdsDownloadProgress) => void;
  onImportStart?: () => void;
}

export interface OpdsImportDownloadResult {
  importResult: ImportBooksResult;
  cleanupFailed: boolean;
}

export interface OpdsDownloadAdapterDependencies {
  platform: OpdsDownloadPlatform;
  client: Pick<OpdsClient, "fetchAsset">;
  importBooks(
    files: DesktopImportFile[],
    options?: { transactional?: boolean },
  ): Promise<ImportBooksResult>;
  getTempDirectory(): Promise<string>;
  createId?(): string;
  onCleanupError?(cleanupError: unknown, primaryError: unknown): void;
}

let temporaryFileSequence = 0;

function nextTemporaryName(format: string, createId?: () => string): string {
  temporaryFileSequence += 1;
  const id = createId?.() ?? generateId();
  return `opds-${Date.now()}-${temporaryFileSequence}-${id}.${format}`;
}

function selectedFormat(request: OpdsDownloadRequest) {
  const supported = listSupportedAcquisitions(request.publication);
  if (!request.acquisition) {
    if (supported.length === 1) return supported[0];
    throw new OpdsError("unsupported-acquisition");
  }
  const selected = supported.find(
    (choice) =>
      choice.url === request.acquisition?.url &&
      choice.type === request.acquisition.type &&
      choice.rel.join("\u0000") === request.acquisition.rel.join("\u0000"),
  );
  if (!selected) throw new OpdsError("unsupported-acquisition");
  return selected;
}

export function createOpdsDownloadAdapter(dependencies: OpdsDownloadAdapterDependencies) {
  return async (request: OpdsDownloadRequest): Promise<OpdsImportDownloadResult> => {
    const choice = selectedFormat(request);
    let temporaryPath: string;
    try {
      const tempRoot = await dependencies.getTempDirectory();
      const workspace = await dependencies.platform.joinPath(tempRoot, "readany-opds-import");
      await dependencies.platform.mkdir(workspace);
      temporaryPath = await dependencies.platform.joinPath(
        workspace,
        nextTemporaryName(choice.format, dependencies.createId),
      );
    } catch {
      throw new OpdsError("download-failed");
    }

    let primaryError: unknown;
    let importResult: ImportBooksResult | undefined;
    let cleanupFailed = false;
    try {
      const downloaded = await downloadOpdsAcquisition({
        ...request,
        acquisition: request.acquisition,
        client: dependencies.client,
        platform: dependencies.platform,
        destinationPath: temporaryPath,
      });
      request.onImportStart?.();
      try {
        importResult = await dependencies.importBooks(
          [
            {
              path: temporaryPath,
              name: downloaded.suggestedFileName,
              metadata: toBookMeta(request.publication),
            },
          ],
          { transactional: true },
        );
      } catch {
        throw new OpdsError("import-failed");
      }
      if (importResult.failures.length > 0) throw new OpdsError("import-failed");
    } catch (error) {
      primaryError = error;
    } finally {
      try {
        await dependencies.platform.deleteFile(temporaryPath);
      } catch (cleanupError) {
        cleanupFailed = true;
        try {
          dependencies.onCleanupError?.(cleanupError, primaryError);
        } catch {
          // Cleanup reporting is best effort and must never replace the operation result.
        }
      }
    }

    if (primaryError) throw primaryError;
    if (!importResult) throw new OpdsError("import-failed");
    return { importResult, cleanupFailed };
  };
}

export function useOpdsDownload() {
  const importBooks = useLibraryStore((state) => state.importBooks);
  const [progress, setProgress] = useState<OpdsDownloadProgress | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const runner = useMemo(
    () =>
      createExclusiveOpdsDownloadRunner<
        OpdsDownloadRequest & {
          signal: AbortSignal;
          onProgress: (progress: OpdsDownloadProgress) => void;
        },
        OpdsImportDownloadResult,
        OpdsDownloadProgress
      >(
        async (
          request: OpdsDownloadRequest & {
            signal: AbortSignal;
            onProgress: (progress: OpdsDownloadProgress) => void;
          },
        ) => {
          const platform = getPlatformService();
          const adapter = createOpdsDownloadAdapter({
            platform,
            client: new OpdsClient(platform),
            importBooks,
            getTempDirectory: async () => (await import("@tauri-apps/api/path")).tempDir(),
            onCleanupError: () => {
              console.warn("[OPDS] Temporary download cleanup failed.");
            },
          });
          return adapter({
            ...request,
          });
        },
        {
          onStart: () => {
            setIsDownloading(true);
            setProgress(null);
          },
          onProgress: setProgress,
          onFinish: () => setIsDownloading(false),
        },
      ),
    [importBooks],
  );

  return { download: runner.download, cancel: runner.cancel, progress, isDownloading };
}
