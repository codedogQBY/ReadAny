import { insertKnowledgeAttachment } from "@/lib/db/database";
import {
  basenameFromPath,
  createKnowledgeAttachmentHash,
  inferKnowledgeAttachmentKind,
  inferKnowledgeAttachmentMimeType,
  sanitizeKnowledgeAttachmentFileName,
} from "@readany/core/knowledge";
import { getPlatformService } from "@readany/core/services";
import type { KnowledgeAttachment } from "@readany/core/types";
import { generateId } from "@readany/core/utils";

export interface KnowledgeImageAttachmentInsert {
  attachment: KnowledgeAttachment;
  attrs: {
    src: string;
    alt: string;
    title: string;
    attachmentId: string;
    fileName: string;
  };
}

function fileNameWithAttachmentId(attachmentId: string, fileName: string): string {
  return sanitizeKnowledgeAttachmentFileName(`${attachmentId}-${fileName}`);
}

export async function pickAndPersistKnowledgeImageAttachment(
  documentId: string,
): Promise<KnowledgeImageAttachmentInsert | null> {
  const platform = getPlatformService();
  const picked = await platform.pickFile({
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp"],
      },
    ],
  });
  const sourcePath = Array.isArray(picked) ? picked[0] : picked;
  if (!sourcePath) return null;

  const rawFileName = basenameFromPath(sourcePath, "image");
  const fileName = sanitizeKnowledgeAttachmentFileName(rawFileName, "image");
  const mimeType = inferKnowledgeAttachmentMimeType(fileName);
  const kind = inferKnowledgeAttachmentKind(fileName, mimeType);
  if (kind !== "image") {
    throw new Error(`Unsupported image attachment type: ${fileName}`);
  }

  const data = await platform.readFile(sourcePath);
  const attachmentId = generateId();
  const dataDir = await platform.getDataDir();
  const attachmentDir = await platform.joinPath(dataDir, "knowledge", "attachments");
  await platform.mkdir(attachmentDir);

  const storedFileName = fileNameWithAttachmentId(attachmentId, fileName);
  const localPath = await platform.joinPath(attachmentDir, storedFileName);
  await platform.writeFile(localPath, data);

  const now = Date.now();
  const attachment: KnowledgeAttachment = {
    id: attachmentId,
    documentId,
    kind: "image",
    fileName,
    mimeType,
    localPath,
    remotePath: `/readany/data/knowledge/attachments/${storedFileName}`,
    size: data.byteLength,
    hash: createKnowledgeAttachmentHash(data),
    createdAt: now,
    updatedAt: now,
  };
  await insertKnowledgeAttachment(attachment);

  let displaySrc = localPath;
  try {
    displaySrc = platform.convertFileSrc(localPath);
  } catch (error) {
    console.warn("[KnowledgeAttachment] Failed to convert image file src:", error);
  }

  return {
    attachment,
    attrs: {
      src: displaySrc,
      alt: fileName,
      title: fileName,
      attachmentId,
      fileName,
    },
  };
}
