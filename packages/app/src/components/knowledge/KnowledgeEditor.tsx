import {
  disableKnowledgeCardTemplate,
  getKnowledgeCardTemplates,
  upsertKnowledgeCardTemplate,
} from "@/lib/db/database";
import {
  type KnowledgeEditorFeature,
  type KnowledgeEditorSurface,
  type KnowledgeEditorTier,
  READANY_ATTACHMENT_URI_PREFIX,
  type ReadAnyCardAttrs,
  type ReadAnyCardTemplateField,
  builtInReadAnyCards,
  createCustomReadAnyCardTemplate,
  createDefaultReadAnyCardAttrs,
  createKnowledgeEditorDraftKey,
  createReadAnyCardAttrsFromTemplate,
  createReadAnyCardReadOnlyModel,
  createReadAnyCardTiptapContent,
  clearKnowledgeEditorDraft,
  formatReadAnyCardDataForEditor,
  getKnowledgeEditorFeatureForCardType,
  getKnowledgeEditorProfile,
  getKnowledgeEditorSurfaceProfile,
  getReadAnyCardTemplateDescription,
  getReadAnyCardTemplateFields,
  getReadAnyCardTemplateInsertLabel,
  getVisibleReadAnyCardTemplateFields,
  hasKnowledgeEditorFeature,
  isKnowledgeEditorDraftRestorable,
  isReadAnyCardTemplateRequiredValueMissing,
  knowledgeEditorDraftFingerprint,
  loadKnowledgeEditorDraft,
  normalizeReadAnyCardTemplateFields,
  normalizeTiptapDocument,
  parseReadAnyCardDataFromEditor,
  renderKnowledgeJsonToMarkdown,
  saveKnowledgeEditorDraft,
  updateCustomReadAnyCardTemplate,
} from "@readany/core/knowledge";
import type { KnowledgeEditorDraft } from "@readany/core/knowledge";
import type { JSONValue, KnowledgeCardTemplate } from "@readany/core/types";
import { cn, generateId } from "@readany/core/utils";
import { eventBus } from "@readany/core/utils/event-bus";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import type { Content } from "@tiptap/core";
import {
  EditorContent,
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  useEditor,
} from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  BookOpen,
  Brain,
  Code,
  FileQuestion,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Map as MapIcon,
  MessageSquareQuote,
  Minus,
  Network,
  OctagonX,
  Pencil,
  Plus,
  Quote,
  Redo2,
  Sparkles,
  Strikethrough,
  TextQuote,
  Trash2,
  Undo2,
  Unlink,
} from "lucide-react";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

export interface KnowledgeEditorValue {
  contentJson: JSONValue;
  contentMd: string;
  plainText: string;
}

export interface KnowledgeImageInsertAttrs {
  src: string;
  alt?: string;
  title?: string;
  attachmentId?: string;
  fileName?: string;
}

export interface KnowledgeEditorOutlineTarget {
  index: number;
  requestId: number;
}

export interface KnowledgeInternalLinkTarget {
  id: string;
  title: string;
  path?: string;
  targetPath?: string;
  typeLabel?: string;
}

export interface KnowledgeSourceReferenceRequest {
  requestId: number;
  label: string;
  sourceTitle?: string;
  sourceId?: string;
  cfi?: string;
}

interface KnowledgeEditorProps {
  documentId?: string;
  value: KnowledgeEditorValue;
  onChange: (value: KnowledgeEditorValue) => void;
  placeholder?: string;
  className?: string;
  contentClassName?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  chrome?: "default" | "canvas";
  tier?: KnowledgeEditorTier;
  surface?: KnowledgeEditorSurface;
  isSaved?: boolean;
  onPickLocalImage?: () => Promise<KnowledgeImageInsertAttrs | null>;
  outlineTarget?: KnowledgeEditorOutlineTarget | null;
  internalLinkTargets?: KnowledgeInternalLinkTarget[];
  sourceReferenceRequest?: KnowledgeSourceReferenceRequest | null;
}

const cardIconMap = {
  bookQuote: MessageSquareQuote,
  callout: TextQuote,
  bookMetadata: BookOpen,
  aiSummary: Sparkles,
  aiToolFailure: OctagonX,
  qa: FileQuestion,
  review: Quote,
  mindmap: MapIcon,
  mermaid: Network,
  relatedNotes: Brain,
};

interface InsertableCardItem {
  key: string;
  cardType: string;
  insertLabel: string;
  description?: string;
  template?: KnowledgeCardTemplate;
  createAttrs: () => ReadAnyCardAttrs;
}

const customCardFieldTypes = [
  "text",
  "multiline",
  "number",
  "checkbox",
  "select",
  "multiselect",
] as const satisfies ReadAnyCardTemplateField["type"][];

const customCardFieldWidths = ["", "full", "half", "third"] as const satisfies readonly (
  | ""
  | NonNullable<ReadAnyCardTemplateField["width"]>
)[];

const customCardFieldConditionOperators = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "empty",
  "notEmpty",
] as const satisfies NonNullable<ReadAnyCardTemplateField["visibleWhen"]>["operator"][];

const DESKTOP_DRAFT_SAVE_DELAY_MS = 650;
type TranslationFn = ReturnType<typeof useTranslation>["t"];

function isChoiceTemplateField(field: ReadAnyCardTemplateField) {
  return field.type === "select" || field.type === "multiselect";
}

function defaultTemplateFieldOptionLabel(t: TranslationFn, count: number): string {
  return t("notes.knowledgeCustomCardFieldOptionDefault", {
    count,
    defaultValue: `Option ${count}`,
  });
}

function createDefaultTemplateFieldOptions(t: TranslationFn) {
  return [
    { label: defaultTemplateFieldOptionLabel(t, 1), value: "option_1" },
    { label: defaultTemplateFieldOptionLabel(t, 2), value: "option_2" },
  ];
}

function formatTemplateFieldOptionsText(field: ReadAnyCardTemplateField): string {
  return (field.options ?? [])
    .map((option) =>
      option.label === option.value ? option.value : `${option.label} | ${option.value}`,
    )
    .join("\n");
}

function parseTemplateFieldOptionsText(
  input: string,
  t: TranslationFn,
): ReadAnyCardTemplateField["options"] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [labelPart, valuePart] = line.split("|").map((part) => part.trim());
      const label = labelPart || defaultTemplateFieldOptionLabel(t, index + 1);
      const value =
        valuePart ||
        label
          .toLowerCase()
          .replace(/[^a-z0-9_-\s]/g, "")
          .replace(/[\s-]+/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_+|_+$/g, "") ||
        `option_${index + 1}`;
      return { label, value };
    });
}

function getTemplateFieldDefaultString(field: ReadAnyCardTemplateField): string {
  if (field.defaultValue === undefined || field.defaultValue === null) return "";
  return String(field.defaultValue);
}

function getTemplateConditionValueString(
  condition: ReadAnyCardTemplateField["visibleWhen"] | undefined,
): string {
  const value = condition?.value;
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : "";
  return String(value);
}

function getTemplateFieldConditionValueString(field: ReadAnyCardTemplateField): string {
  return getTemplateConditionValueString(field.visibleWhen);
}

function parseTemplateFieldConditionValue(
  sourceField: ReadAnyCardTemplateField | undefined,
  value: string,
) {
  if (sourceField?.type === "checkbox") return value === "true";
  if (sourceField?.type === "number") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : value;
  }
  return value;
}

const ReadAnyCardExtension = Node.create({
  name: "readanyCard",
  group: "block",
  atom: true,
  draggable: true,

  addStorage() {
    return {
      cardTemplates: [] as KnowledgeCardTemplate[],
    };
  },

  addAttributes() {
    return {
      cardType: { default: "callout" },
      id: { default: null },
      version: { default: 1 },
      title: { default: null },
      text: { default: null },
      sourceTitle: { default: null },
      sourceId: { default: null },
      cfi: { default: null },
      markdown: { default: null },
      data: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "readany-card" }];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = {
      "data-card-type": HTMLAttributes.cardType || "callout",
      "data-card-version": String(HTMLAttributes.version || 1),
    };
    return ["readany-card", mergeAttributes(attrs), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ReadAnyCardView);
  },
});

const ReadAnyInternalLinkExtension = Node.create({
  name: "readanyInternalLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      documentId: { default: null },
      targetPath: { default: null },
      label: { default: null },
      title: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-readany-internal-link]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const label =
      HTMLAttributes.label ||
      HTMLAttributes.title ||
      HTMLAttributes.documentId ||
      HTMLAttributes.targetPath ||
      "";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-readany-internal-link":
          HTMLAttributes.documentId || HTMLAttributes.targetPath || label,
        class: "readany-internal-link",
      }),
      label,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ReadAnyInternalLinkView);
  },
});

const ReadAnySourceReferenceExtension = Node.create({
  name: "readanySourceReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      label: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-label") || element.textContent || null,
        renderHTML: (attributes: { label?: string | null }) =>
          attributes.label ? { "data-label": attributes.label } : {},
      },
      sourceTitle: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-source-title") || element.textContent || null,
        renderHTML: (attributes: { sourceTitle?: string | null }) =>
          attributes.sourceTitle ? { "data-source-title": attributes.sourceTitle } : {},
      },
      sourceId: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-source-id") ||
          element.getAttribute("data-readany-source-id") ||
          null,
        renderHTML: (attributes: { sourceId?: string | null }) =>
          attributes.sourceId ? { "data-source-id": attributes.sourceId } : {},
      },
      cfi: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const cfi = element.getAttribute("data-cfi");
          if (cfi) return cfi;
          const legacyReference = element.getAttribute("data-readany-source-reference") || "";
          return legacyReference.startsWith("epubcfi(") ? legacyReference : null;
        },
        renderHTML: (attributes: { cfi?: string | null }) =>
          attributes.cfi ? { "data-cfi": attributes.cfi } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-readany-source-reference]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = node.attrs.label || node.attrs.sourceTitle || "Source";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-readany-source-reference": node.attrs.cfi || node.attrs.sourceId || label,
        class: "readany-source-reference",
      }),
      label,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ReadAnySourceReferenceView);
  },
});

const KnowledgeImageExtension = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      attachmentId: { default: null },
      fileName: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(HTMLAttributes, {
        class:
          "mx-auto my-4 max-h-[520px] max-w-full rounded-md border border-border/60 object-contain",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(KnowledgeImageNodeView);
  },
});

function KnowledgeImageNodeView({ node }: NodeViewProps) {
  const { t } = useTranslation();
  const [hasLoadError, setHasLoadError] = useState(false);
  const attrs = node.attrs as KnowledgeImageInsertAttrs;
  const src = typeof attrs.src === "string" ? attrs.src.trim() : "";
  const fileName =
    (typeof attrs.fileName === "string" && attrs.fileName.trim()) ||
    (typeof attrs.title === "string" && attrs.title.trim()) ||
    (typeof attrs.alt === "string" && attrs.alt.trim()) ||
    t("notes.knowledgeAttachmentFile", { defaultValue: "Attachment" });
  const isUnresolvedAttachment =
    !!attrs.attachmentId && (!src || src.startsWith(READANY_ATTACHMENT_URI_PREFIX));
  const isMissing = hasLoadError || !src || isUnresolvedAttachment;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset image load state when the resolved src changes.
  useEffect(() => {
    setHasLoadError(false);
  }, [src]);

  return (
    <NodeViewWrapper as="figure" className="my-4" data-readany-image="true" contentEditable={false}>
      {isMissing ? (
        <div className="mx-auto flex min-h-32 max-w-xl items-center gap-3 rounded-md border border-dashed border-border/70 bg-muted/25 px-4 py-4 text-left">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground">
            <FileQuestion className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{fileName}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("notes.knowledgeAttachmentUnavailable", {
                defaultValue: "Image attachment is not available on this device yet.",
              })}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/80">
              {t("notes.knowledgeAttachmentUnavailableHint", {
                defaultValue: "Sync again or keep the original device online to restore it.",
              })}
            </p>
          </div>
        </div>
      ) : (
        <img
          src={src}
          alt={attrs.alt?.trim() ?? ""}
          title={attrs.title?.trim() ?? ""}
          className="mx-auto max-h-[520px] max-w-full rounded-md border border-border/60 object-contain"
          onError={() => setHasLoadError(true)}
        />
      )}
      {attrs.alt?.trim() && !isMissing ? (
        <figcaption className="mt-2 text-center text-xs leading-relaxed text-muted-foreground">
          {attrs.alt.trim()}
        </figcaption>
      ) : null}
    </NodeViewWrapper>
  );
}

function contentJsonEquals(left: JSONValue, right: JSONValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function KnowledgeEditor({
  documentId,
  value,
  onChange,
  placeholder,
  className,
  contentClassName,
  autoFocus = false,
  readOnly = false,
  chrome = "default",
  tier = "knowledge_doc",
  surface,
  isSaved,
  onPickLocalImage,
  outlineTarget,
  internalLinkTargets = [],
  sourceReferenceRequest,
}: KnowledgeEditorProps) {
  const { t } = useTranslation();
  const [isInsertOpen, setIsInsertOpen] = useState(false);
  const [isBlockInsertOpen, setIsBlockInsertOpen] = useState(false);
  const [isImageInsertOpen, setIsImageInsertOpen] = useState(false);
  const [isInternalLinkOpen, setIsInternalLinkOpen] = useState(false);
  const [internalLinkQuery, setInternalLinkQuery] = useState("");
  const [imageSrc, setImageSrc] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [isPickingLocalImage, setIsPickingLocalImage] = useState(false);
  const [isTemplateFormOpen, setIsTemplateFormOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateMarkdown, setTemplateMarkdown] = useState("");
  const [templateFields, setTemplateFields] = useState<ReadAnyCardTemplateField[]>([]);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [templateSaveError, setTemplateSaveError] = useState<string | null>(null);
  const [floatingToolbarPosition, setFloatingToolbarPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const imageSrcInputId = useId();
  const imageAltInputId = useId();
  const [cardTemplates, setCardTemplates] = useState<KnowledgeCardTemplate[]>([]);
  const cardTemplatesRef = useRef<KnowledgeCardTemplate[]>([]);
  const templateLoaderMountedRef = useRef(false);
  const isInternalUpdate = useRef(false);
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const internalLinkInputRef = useRef<HTMLInputElement | null>(null);
  const handledSourceReferenceRequestIdRef = useRef<number | null>(null);
  const normalizedContentJson = useMemo(
    () => normalizeTiptapDocument(value.contentJson, { cardTemplates }),
    [cardTemplates, value.contentJson],
  );
  const valueFingerprint = useMemo(
    () => knowledgeEditorDraftFingerprint(normalizedContentJson as unknown as JSONValue),
    [normalizedContentJson],
  );
  const draftKey = useMemo(
    () => (documentId ? createKnowledgeEditorDraftKey(documentId, "desktop") : null),
    [documentId],
  );
  const previousDraftKeyRef = useRef(draftKey);
  const draftKeyRef = useRef(draftKey);
  const readOnlyRef = useRef(readOnly);
  const baseFingerprintRef = useRef(valueFingerprint);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWrittenDraftFingerprintRef = useRef<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<KnowledgeEditorDraft | null>(null);
  const editorProfile = useMemo(
    () => (surface ? getKnowledgeEditorSurfaceProfile(surface) : getKnowledgeEditorProfile(tier)),
    [surface, tier],
  );
  const canUse = useCallback(
    (feature: KnowledgeEditorFeature) => hasKnowledgeEditorFeature(editorProfile, feature),
    [editorProfile],
  );
  const canInsertCard = useCallback(
    (cardType: string) => {
      const feature = getKnowledgeEditorFeatureForCardType(cardType);
      return canUse("readAnyCards") || (feature ? canUse(feature) : false);
    },
    [canUse],
  );
  const allowedCards = useMemo(
    () => [
      ...builtInReadAnyCards
        .filter((card) => canInsertCard(card.cardType))
        .map<InsertableCardItem>((card) => ({
          key: `built-in:${card.cardType}`,
          cardType: card.cardType,
          insertLabel: t(`notes.knowledgeCards.${card.cardType}`, {
            defaultValue: card.insertLabel,
          }),
          description: t(`notes.knowledgeCardDescriptions.${card.cardType}`, {
            defaultValue: "",
          }),
          createAttrs: () =>
            createDefaultReadAnyCardAttrs(card.cardType, {
              title: t(`notes.knowledgeCards.${card.cardType}`, {
                defaultValue: card.insertLabel,
              }),
              version: card.version,
            }),
        })),
      ...cardTemplates
        .map((template) => {
          const attrs = createReadAnyCardAttrsFromTemplate(template);
          const cardType = attrs.cardType ?? `custom:${template.id}`;
          return { template, cardType };
        })
        .filter(({ template, cardType }) => template.enabled !== false && canInsertCard(cardType))
        .map<InsertableCardItem>(({ template, cardType }) => ({
          key: `template:${template.id}`,
          cardType,
          insertLabel: getReadAnyCardTemplateInsertLabel(template),
          description: getReadAnyCardTemplateDescription(template),
          template,
          createAttrs: () => createReadAnyCardAttrsFromTemplate(template),
        })),
    ],
    [canInsertCard, cardTemplates, t],
  );

  const reloadCardTemplates = useCallback(async () => {
    try {
      const templates = await getKnowledgeCardTemplates({ includeDisabled: true });
      if (!templateLoaderMountedRef.current) return;
      setCardTemplates(templates.filter((template) => !template.builtIn));
    } catch (error) {
      console.warn("[KnowledgeEditor] Failed to load card templates:", error);
    }
  }, []);

  useEffect(() => {
    templateLoaderMountedRef.current = true;
    void reloadCardTemplates();
    const offTemplateChange = eventBus.on("knowledge:card-templates-changed", () => {
      void reloadCardTemplates();
    });
    const offSyncCompleted = eventBus.on("sync:completed", () => {
      void reloadCardTemplates();
    });
    return () => {
      templateLoaderMountedRef.current = false;
      offTemplateChange();
      offSyncCompleted();
    };
  }, [reloadCardTemplates]);

  useEffect(() => {
    cardTemplatesRef.current = cardTemplates;
  }, [cardTemplates]);

  useEffect(() => {
    if (!isInternalLinkOpen) return;
    window.requestAnimationFrame(() => {
      internalLinkInputRef.current?.focus();
    });
  }, [isInternalLinkOpen]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        dropcursor: false,
        gapcursor: false,
      }),
      Link.configure({
        autolink: true,
        openOnClick: false,
      }),
      ReadAnyInternalLinkExtension,
      ReadAnySourceReferenceExtension,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      KnowledgeImageExtension,
      ReadAnyCardExtension,
      Placeholder.configure({
        placeholder: placeholder || "",
        emptyEditorClass: "is-editor-empty",
      }),
    ],
    [placeholder],
  );
  const visibleInternalLinkTargets = useMemo(() => {
    const query = internalLinkQuery.trim().toLowerCase();
    const source = query
      ? internalLinkTargets.filter((target) =>
          [target.title, target.path ?? "", target.typeLabel ?? "", target.id]
            .join(" ")
            .toLowerCase()
            .includes(query),
        )
      : internalLinkTargets;
    return source.slice(0, 8);
  }, [internalLinkQuery, internalLinkTargets]);

  useEffect(() => {
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    draftKeyRef.current = draftKey;
  }, [draftKey]);

  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  useEffect(() => {
    if (previousDraftKeyRef.current === draftKey) return;
    previousDraftKeyRef.current = draftKey;
    baseFingerprintRef.current = valueFingerprint;
    lastWrittenDraftFingerprintRef.current = null;
    setPendingDraft(null);
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
  }, [draftKey, valueFingerprint]);

  useEffect(() => {
    let mounted = true;
    if (!draftKey || readOnly) {
      setPendingDraft(null);
      return;
    }

    const initialFingerprint = baseFingerprintRef.current;
    const loadDraft = async () => {
      const draft = await loadKnowledgeEditorDraft(draftKey);
      if (!mounted) return;
      if (isKnowledgeEditorDraftRestorable(draft, initialFingerprint)) {
        setPendingDraft(draft);
      } else if (draft) {
        void clearKnowledgeEditorDraft(draftKey);
      }
    };

    void loadDraft();
    return () => {
      mounted = false;
    };
  }, [draftKey, readOnly]);

  useEffect(() => {
    if (!draftKey || !isSaved) return;
    if (lastWrittenDraftFingerprintRef.current !== valueFingerprint) return;

    lastWrittenDraftFingerprintRef.current = null;
    baseFingerprintRef.current = valueFingerprint;
    setPendingDraft((draft) => (draft?.contentFingerprint === valueFingerprint ? null : draft));
    void clearKnowledgeEditorDraft(draftKey);
  }, [draftKey, isSaved, valueFingerprint]);

  const scheduleDraftSave = useCallback((nextValue: KnowledgeEditorValue) => {
    const activeDraftKey = draftKeyRef.current;
    if (readOnlyRef.current || !activeDraftKey) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);

    const nextFingerprint = knowledgeEditorDraftFingerprint(nextValue.contentJson);
    if (nextFingerprint === baseFingerprintRef.current) {
      lastWrittenDraftFingerprintRef.current = null;
      void clearKnowledgeEditorDraft(activeDraftKey);
      return;
    }

    draftSaveTimerRef.current = setTimeout(() => {
      void saveKnowledgeEditorDraft(activeDraftKey, nextValue, {
        baseFingerprint: baseFingerprintRef.current,
      })
        .then((draft) => {
          lastWrittenDraftFingerprintRef.current = draft.contentFingerprint;
        })
        .catch((error) => {
          console.warn("[KnowledgeEditor] Failed to save editor draft:", error);
        });
    }, DESKTOP_DRAFT_SAVE_DELAY_MS);
  }, []);

  const editor = useEditor({
    extensions,
    content: normalizedContentJson,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm dark:prose-invert max-w-none min-h-[80px] outline-none",
          "readany-knowledge-editor",
          "prose-headings:font-semibold prose-headings:tracking-tight",
          "prose-h1:text-xl prose-h1:mb-3 prose-h1:mt-4",
          "prose-h2:text-base prose-h2:mb-2 prose-h2:mt-4",
          "prose-h3:text-sm prose-h3:mb-1.5 prose-h3:mt-3",
          "prose-p:my-2 prose-p:leading-relaxed prose-p:text-[13px]",
          "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:text-[13px]",
          "prose-blockquote:border-l-primary/50 prose-blockquote:bg-muted/30 prose-blockquote:py-1 prose-blockquote:px-3 prose-blockquote:rounded-r prose-blockquote:not-italic prose-blockquote:text-muted-foreground",
          "prose-code:px-1.5 prose-code:py-0.5 prose-code:bg-muted prose-code:rounded prose-code:text-[12px] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none",
          "prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:rounded-md prose-pre:text-[12px]",
          "prose-hr:border-border prose-hr:my-4",
          "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
          "prose-strong:font-semibold prose-strong:text-foreground",
          "prose-em:text-foreground/90",
        ),
      },
    },
    onUpdate: ({ editor }) => {
      if (readOnly) return;
      const currentCardTemplates = cardTemplatesRef.current;
      const contentJson = normalizeTiptapDocument(editor.getJSON() as unknown as JSONValue, {
        cardTemplates: currentCardTemplates,
      }) as unknown as JSONValue;
      const nextValue = {
        contentJson,
        contentMd: renderKnowledgeJsonToMarkdown(contentJson, {
          cardTemplates: currentCardTemplates,
        }),
        plainText: editor.getText(),
      };
      isInternalUpdate.current = true;
      scheduleDraftSave(nextValue);
      onChange(nextValue);
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage as unknown as Record<string, unknown>;
    const readAnyCardStorage =
      (storage.readanyCard as { cardTemplates?: KnowledgeCardTemplate[] } | undefined) ?? {};
    readAnyCardStorage.cardTemplates = cardTemplates;
    storage.readanyCard = readAnyCardStorage;
  }, [cardTemplates, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
    if (readOnly) {
      editor.commands.blur();
      setFloatingToolbarPosition(null);
      setIsBlockInsertOpen(false);
      setIsImageInsertOpen(false);
      setIsInsertOpen(false);
      setIsInternalLinkOpen(false);
      setIsTemplateFormOpen(false);
    }
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor || isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }

    const normalizedJson = normalizedContentJson as unknown as JSONValue;
    const currentJson = editor.getJSON() as unknown as JSONValue;
    if (!contentJsonEquals(currentJson, normalizedJson)) {
      editor.commands.setContent(normalizedContentJson);
    }

    if (!readOnly && !contentJsonEquals(value.contentJson, normalizedJson)) {
      isInternalUpdate.current = true;
      onChange({
        contentJson: normalizedJson,
        contentMd: renderKnowledgeJsonToMarkdown(normalizedJson, { cardTemplates }),
        plainText: editor.getText(),
      });
    }
  }, [cardTemplates, editor, normalizedContentJson, onChange, readOnly, value.contentJson]);

  useEffect(() => {
    if (editor && autoFocus && !readOnly) {
      editor.commands.focus();
    }
  }, [editor, autoFocus, readOnly]);

  useEffect(() => {
    if (!editor || !outlineTarget) return;
    const headings = Array.from(
      editor.view.dom.querySelectorAll("h1,h2,h3,h4,h5,h6"),
    ) as HTMLElement[];
    const target = headings[outlineTarget.index];
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.animate?.(
      [
        { outline: "0 solid transparent", outlineOffset: "0px" },
        { outline: "2px solid var(--primary)", outlineOffset: "4px" },
        { outline: "0 solid transparent", outlineOffset: "8px" },
      ],
      { duration: 900, easing: "ease-out" },
    );
  }, [editor, outlineTarget]);

  useEffect(() => {
    if (!editor || readOnly || !sourceReferenceRequest || !canUse("sourceReference")) return;
    if (handledSourceReferenceRequestIdRef.current === sourceReferenceRequest.requestId) return;
    const label = sourceReferenceRequest.label.trim();
    if (!label) return;
    handledSourceReferenceRequestIdRef.current = sourceReferenceRequest.requestId;
    editor
      .chain()
      .focus()
      .insertContent([
        {
          type: "readanySourceReference",
          attrs: {
            label,
            sourceTitle: sourceReferenceRequest.sourceTitle?.trim() || label,
            sourceId: sourceReferenceRequest.sourceId?.trim() || null,
            cfi: sourceReferenceRequest.cfi?.trim() || null,
          },
        },
        { type: "text", text: " " },
      ])
      .run();
  }, [canUse, editor, readOnly, sourceReferenceRequest]);

  const hasFloatingInlineTools =
    !readOnly &&
    (canUse("bold") ||
      canUse("italic") ||
      canUse("strike") ||
      canUse("inlineCode") ||
      canUse("link"));

  const updateFloatingToolbarPosition = useCallback(() => {
    if (!editor || readOnly || !hasFloatingInlineTools || editor.state.selection.empty) {
      setFloatingToolbarPosition(null);
      return;
    }

    const shell = editorShellRef.current;
    if (!shell) {
      setFloatingToolbarPosition(null);
      return;
    }

    try {
      const { from, to } = editor.state.selection;
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const shellRect = shell.getBoundingClientRect();
      const selectionLeft = Math.min(start.left, end.left);
      const selectionRight = Math.max(start.right, end.right, start.left, end.left);
      const rawLeft = (selectionLeft + selectionRight) / 2 - shellRect.left;
      const rawTop = Math.min(start.top, end.top) - shellRect.top - 8;
      const left = Math.min(Math.max(rawLeft, 42), Math.max(shellRect.width - 42, 42));
      const top = Math.max(rawTop, 44);

      setFloatingToolbarPosition({ left, top });
    } catch {
      setFloatingToolbarPosition(null);
    }
  }, [editor, hasFloatingInlineTools, readOnly]);

  const syncCardControlsEditable = useCallback(() => {
    const shell = editorShellRef.current;
    if (!shell) return;
    const controls = shell.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "[data-readany-card-control]",
    );
    for (const control of controls) {
      control.readOnly = readOnly;
      control.tabIndex = readOnly ? -1 : 0;
      control.setAttribute("aria-readonly", readOnly ? "true" : "false");
    }
  }, [readOnly]);

  useEffect(() => {
    if (!editor) return;

    editor.on("selectionUpdate", updateFloatingToolbarPosition);
    editor.on("transaction", updateFloatingToolbarPosition);
    editor.on("transaction", syncCardControlsEditable);
    window.addEventListener("resize", updateFloatingToolbarPosition);
    syncCardControlsEditable();

    return () => {
      editor.off("selectionUpdate", updateFloatingToolbarPosition);
      editor.off("transaction", updateFloatingToolbarPosition);
      editor.off("transaction", syncCardControlsEditable);
      window.removeEventListener("resize", updateFloatingToolbarPosition);
    };
  }, [editor, syncCardControlsEditable, updateFloatingToolbarPosition]);

  useEffect(() => {
    syncCardControlsEditable();
  }, [syncCardControlsEditable]);

  const setLink = useCallback(() => {
    if (!editor || readOnly || !canUse("link")) return;
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt(t("editor.enterLink"), previousUrl);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [canUse, editor, readOnly, t]);
  const unsetLink = useCallback(() => {
    if (!editor || readOnly || !canUse("link")) return;
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
  }, [canUse, editor, readOnly]);

  const insertInternalLink = useCallback(
    (target?: KnowledgeInternalLinkTarget) => {
      if (!editor || readOnly || !canUse("internalLink")) return;
      const label = (target?.title ?? internalLinkQuery).trim();
      if (!label) return;
      editor
        .chain()
        .focus()
        .insertContent({
          type: "readanyInternalLink",
          attrs: {
            label,
            title: label,
            ...(target?.id ? { documentId: target.id } : {}),
            ...(target?.targetPath ? { targetPath: target.targetPath } : {}),
          },
        })
        .run();
      setInternalLinkQuery("");
      setIsInternalLinkOpen(false);
    },
    [canUse, editor, internalLinkQuery, readOnly],
  );

  const insertImageAttrs = useCallback(
    (attrs: KnowledgeImageInsertAttrs) => {
      if (!editor || readOnly || !canUse("image")) return;
      const src = attrs.src.trim();
      if (!src) return;
      editor
        .chain()
        .focus()
        .insertContent({
          type: "image",
          attrs: {
            src,
            alt: attrs.alt?.trim() ?? "",
            title: attrs.title?.trim() ?? "",
            attachmentId: attrs.attachmentId?.trim() ?? "",
            fileName: attrs.fileName?.trim() ?? "",
          },
        })
        .run();
      setImageSrc("");
      setImageAlt("");
      setIsImageInsertOpen(false);
    },
    [canUse, editor, readOnly],
  );

  const insertImage = useCallback(() => {
    if (!editor || readOnly || !canUse("image")) return;
    const src = imageSrc.trim();
    if (!src) return;
    insertImageAttrs({ src, alt: imageAlt });
  }, [canUse, editor, imageAlt, imageSrc, insertImageAttrs, readOnly]);

  const pickLocalImage = useCallback(async () => {
    if (readOnly || !onPickLocalImage || isPickingLocalImage) return;
    setIsPickingLocalImage(true);
    try {
      const attrs = await onPickLocalImage();
      if (attrs) insertImageAttrs(attrs);
    } finally {
      setIsPickingLocalImage(false);
    }
  }, [insertImageAttrs, isPickingLocalImage, onPickLocalImage, readOnly]);

  const insertCard = useCallback(
    (card: InsertableCardItem) => {
      if (!editor || readOnly || !canInsertCard(card.cardType)) return;
      editor
        .chain()
        .focus()
        .insertContent({
          type: "readanyCard",
          attrs: card.createAttrs(),
        })
        .run();
      setIsInsertOpen(false);
      setIsBlockInsertOpen(false);
    },
    [canInsertCard, editor, readOnly],
  );

  const resetTemplateForm = useCallback(() => {
    setEditingTemplateId(null);
    setTemplateName("");
    setTemplateDescription("");
    setTemplateMarkdown("");
    setTemplateFields([]);
    setTemplateSaveError(null);
  }, []);

  const addTemplateField = useCallback(() => {
    setTemplateFields((current) => [
      ...current,
      {
        key: `field_${current.length + 1}`,
        label: t("notes.knowledgeCustomCardFieldNew", {
          count: current.length + 1,
          defaultValue: `Field ${current.length + 1}`,
        }),
        type: "text",
      },
    ]);
    setTemplateSaveError(null);
  }, [t]);

  const updateTemplateField = useCallback(
    (index: number, patch: Partial<ReadAnyCardTemplateField>) => {
      setTemplateFields((current) =>
        current.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)),
      );
      setTemplateSaveError(null);
    },
    [],
  );

  const updateTemplateGroupVisibleWhen = useCallback(
    (
      group: string | undefined,
      visibleWhen: ReadAnyCardTemplateField["groupVisibleWhen"] | undefined,
    ) => {
      const groupName = group?.trim();
      if (!groupName) return;
      setTemplateFields((current) =>
        current.map((field) =>
          field.group?.trim() === groupName ? { ...field, groupVisibleWhen: visibleWhen } : field,
        ),
      );
      setTemplateSaveError(null);
    },
    [],
  );

  const removeTemplateField = useCallback((index: number) => {
    setTemplateFields((current) => current.filter((_, fieldIndex) => fieldIndex !== index));
    setTemplateSaveError(null);
  }, []);

  const openNewTemplateForm = useCallback(() => {
    if (readOnly) return;
    resetTemplateForm();
    setIsTemplateFormOpen(true);
  }, [readOnly, resetTemplateForm]);

  const openTemplateEditForm = useCallback(
    (template: KnowledgeCardTemplate) => {
      if (readOnly) return;
      const attrs = createReadAnyCardAttrsFromTemplate(template);
      setEditingTemplateId(template.id);
      setTemplateName(getReadAnyCardTemplateInsertLabel(template));
      setTemplateDescription(getReadAnyCardTemplateDescription(template) ?? "");
      setTemplateMarkdown(attrs.markdown ?? attrs.text ?? "");
      setTemplateFields(getReadAnyCardTemplateFields(template));
      setTemplateSaveError(null);
      setIsTemplateFormOpen(true);
    },
    [readOnly],
  );

  const saveTemplate = useCallback(async () => {
    if (readOnly || !editor || !canUse("readAnyCards") || isSavingTemplate) return;
    const name = templateName.trim();
    if (!name) return;

    setIsSavingTemplate(true);
    setTemplateSaveError(null);
    try {
      const normalizedTemplateFields = normalizeReadAnyCardTemplateFields(templateFields);
      const editingTemplate = editingTemplateId
        ? cardTemplates.find((template) => template.id === editingTemplateId)
        : null;
      if (editingTemplateId && !editingTemplate) {
        throw new Error(
          t("notes.knowledgeCustomCardMissing", {
            defaultValue: "This custom card template no longer exists.",
          }),
        );
      }
      const template = editingTemplate
        ? updateCustomReadAnyCardTemplate({
            template: editingTemplate,
            name,
            description: templateDescription,
            markdown: templateMarkdown,
            fields: normalizedTemplateFields,
          })
        : createCustomReadAnyCardTemplate({
            id: `card-template-${generateId()}`,
            name,
            description: templateDescription,
            markdown: templateMarkdown,
            fields: normalizedTemplateFields,
          });

      await upsertKnowledgeCardTemplate(template);
      setCardTemplates((current) =>
        [...current.filter((item) => item.id !== template.id), template].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      if (!editingTemplate) {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "readanyCard",
            attrs: createReadAnyCardAttrsFromTemplate(template),
          })
          .run();
        setIsInsertOpen(false);
        setIsBlockInsertOpen(false);
      }
      resetTemplateForm();
      setIsTemplateFormOpen(false);
    } catch (error) {
      console.warn("[KnowledgeEditor] Failed to save card template:", error);
      setTemplateSaveError(
        error instanceof Error
          ? error.message
          : t("notes.knowledgeCustomCardCreateFailed", {
              defaultValue: "Failed to save custom card.",
            }),
      );
    } finally {
      setIsSavingTemplate(false);
    }
  }, [
    canUse,
    cardTemplates,
    editingTemplateId,
    editor,
    isSavingTemplate,
    readOnly,
    resetTemplateForm,
    t,
    templateDescription,
    templateFields,
    templateMarkdown,
    templateName,
  ]);
  const disableTemplate = useCallback(
    async (template: KnowledgeCardTemplate) => {
      if (readOnly) return;
      const confirmed = window.confirm(
        t("notes.knowledgeCustomCardDisableConfirm", {
          name: template.name,
          defaultValue: `Remove "${template.name}" from the insert menu? Existing cards in documents will stay unchanged.`,
        }),
      );
      if (!confirmed) return;

      try {
        await disableKnowledgeCardTemplate(template.id);
        setCardTemplates((current) =>
          current.map((item) => (item.id === template.id ? { ...item, enabled: false } : item)),
        );
        if (editingTemplateId === template.id) {
          resetTemplateForm();
          setIsTemplateFormOpen(false);
        }
      } catch (error) {
        console.warn("[KnowledgeEditor] Failed to disable card template:", error);
        setTemplateSaveError(
          error instanceof Error
            ? error.message
            : t("notes.knowledgeCustomCardDisableFailed", {
                defaultValue: "Failed to remove custom card.",
              }),
        );
      }
    },
    [editingTemplateId, readOnly, resetTemplateForm, t],
  );

  const restorePendingDraft = useCallback(() => {
    if (readOnly || !pendingDraft) return;
    const contentJson = normalizeTiptapDocument(pendingDraft.value.contentJson, {
      cardTemplates,
    }) as unknown as JSONValue;
    const nextValue = {
      contentJson,
      contentMd: renderKnowledgeJsonToMarkdown(contentJson, { cardTemplates }),
      plainText: pendingDraft.value.plainText,
    };
    const nextFingerprint = knowledgeEditorDraftFingerprint(contentJson);
    setPendingDraft(null);
    lastWrittenDraftFingerprintRef.current = nextFingerprint;
    isInternalUpdate.current = true;
    editor?.commands.setContent(contentJson as Content);
    onChange(nextValue);
  }, [cardTemplates, editor, onChange, pendingDraft, readOnly]);

  const discardPendingDraft = useCallback(() => {
    setPendingDraft(null);
    lastWrittenDraftFingerprintRef.current = null;
    if (draftKey) void clearKnowledgeEditorDraft(draftKey);
  }, [draftKey]);

  if (!editor) return null;

  const hasBlockInsertItems =
    canUse("heading1") ||
    canUse("heading2") ||
    canUse("heading3") ||
    canUse("bulletList") ||
    canUse("orderedList") ||
    canUse("taskList") ||
    canUse("blockquote") ||
    canUse("codeBlock") ||
    canUse("horizontalRule") ||
    canUse("image") ||
    allowedCards.length > 0;
  const toolbarGroupCandidates: ({ key: string; node: ReactNode } | null)[] = [
    hasBlockInsertItems
      ? {
          key: "insert",
          node: (
            <div className="relative">
              <ToolbarButton
                onClick={() => {
                  setIsBlockInsertOpen((open) => !open);
                  setIsInternalLinkOpen(false);
                  setIsImageInsertOpen(false);
                  setIsInsertOpen(false);
                }}
                isActive={isBlockInsertOpen}
                title={t("notes.knowledgeInsertBlock", { defaultValue: "Insert block" })}
              >
                <Plus className="h-3.5 w-3.5" />
              </ToolbarButton>

              {isBlockInsertOpen ? (
                <div className="absolute left-0 top-8 z-20 w-72 rounded-lg border border-border/70 bg-popover p-1.5 shadow-lg">
                  <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {t("notes.knowledgeInsertBlock", { defaultValue: "Insert block" })}
                  </div>
                  {canUse("heading1") ? (
                    <BlockInsertButton
                      icon={<Heading1 className="h-3.5 w-3.5" />}
                      title={t("editor.heading1")}
                      hint={t("notes.knowledgeInsertHeadingHint", {
                        defaultValue: "Start a section",
                      })}
                      onClick={() => {
                        editor.chain().focus().toggleHeading({ level: 1 }).run();
                        setIsBlockInsertOpen(false);
                      }}
                    />
                  ) : null}
                  {canUse("heading2") ? (
                    <BlockInsertButton
                      icon={<Heading2 className="h-3.5 w-3.5" />}
                      title={t("editor.heading2")}
                      hint={t("notes.knowledgeInsertSubheadingHint", {
                        defaultValue: "Nest a smaller section",
                      })}
                      onClick={() => {
                        editor.chain().focus().toggleHeading({ level: 2 }).run();
                        setIsBlockInsertOpen(false);
                      }}
                    />
                  ) : null}
                  {canUse("heading3") ? (
                    <BlockInsertButton
                      icon={<Heading3 className="h-3.5 w-3.5" />}
                      title={t("editor.heading3")}
                      hint={t("notes.knowledgeInsertMinorHeadingHint", {
                        defaultValue: "Add a small subsection",
                      })}
                      onClick={() => {
                        editor.chain().focus().toggleHeading({ level: 3 }).run();
                        setIsBlockInsertOpen(false);
                      }}
                    />
                  ) : null}
                  {canUse("bulletList") ? (
                    <BlockInsertButton
                      icon={<List className="h-3.5 w-3.5" />}
                      title={t("editor.bulletList")}
                      hint={t("notes.knowledgeInsertListHint", {
                        defaultValue: "Collect points",
                      })}
                      onClick={() => {
                        editor.chain().focus().toggleBulletList().run();
                        setIsBlockInsertOpen(false);
                      }}
                    />
                  ) : null}
                  {canUse("orderedList") ? (
                    <BlockInsertButton
                      icon={<ListOrdered className="h-3.5 w-3.5" />}
                      title={t("editor.orderedList")}
                      hint={t("notes.knowledgeInsertOrderedListHint", {
                        defaultValue: "Write ordered steps",
                      })}
                      onClick={() => {
                        editor.chain().focus().toggleOrderedList().run();
                        setIsBlockInsertOpen(false);
                      }}
                    />
                  ) : null}
                  {canUse("taskList") ? (
                    <BlockInsertButton
                      icon={<ListTodo className="h-3.5 w-3.5" />}
                      title={t("editor.taskList")}
                      hint={t("notes.knowledgeInsertTaskHint", {
                        defaultValue: "Track follow-up reading work",
                      })}
                      onClick={() => {
                        editor.chain().focus().toggleTaskList().run();
                        setIsBlockInsertOpen(false);
                      }}
                    />
                  ) : null}
                  {canUse("blockquote") ? (
                    <BlockInsertButton
                      icon={<Quote className="h-3.5 w-3.5" />}
                      title={t("editor.blockquote")}
                      hint={t("notes.knowledgeInsertQuoteHint", {
                        defaultValue: "Set off an idea or cited passage",
                      })}
                      onClick={() => {
                        editor.chain().focus().toggleBlockquote().run();
                        setIsBlockInsertOpen(false);
                      }}
                    />
                  ) : null}
                  {canUse("codeBlock") ? (
                    <BlockInsertButton
                      icon={<Code className="h-3.5 w-3.5" />}
                      title={t("editor.codeBlock")}
                      hint={t("notes.knowledgeInsertCodeBlockHint", {
                        defaultValue: "Capture code, prompts, or structured snippets",
                      })}
                      onClick={() => {
                        editor.chain().focus().toggleCodeBlock().run();
                        setIsBlockInsertOpen(false);
                      }}
                    />
                  ) : null}
                  {canUse("horizontalRule") ? (
                    <BlockInsertButton
                      icon={<Minus className="h-3.5 w-3.5" />}
                      title={t("editor.horizontalRule")}
                      hint={t("notes.knowledgeInsertDividerHint", {
                        defaultValue: "Separate two sections",
                      })}
                      onClick={() => {
                        editor.chain().focus().setHorizontalRule().run();
                        setIsBlockInsertOpen(false);
                      }}
                    />
                  ) : null}
                  {canUse("image") ? (
                    <BlockInsertButton
                      icon={<ImagePlus className="h-3.5 w-3.5" />}
                      title={t("notes.knowledgeInsertImage")}
                      hint={t("notes.knowledgeInsertImageHint", {
                        defaultValue: "Add a synced image attachment",
                      })}
                      onClick={() => {
                        setIsImageInsertOpen(true);
                        setIsBlockInsertOpen(false);
                      }}
                    />
                  ) : null}
                  {allowedCards.length > 0 ? (
                    <>
                      <div className="my-1 h-px bg-border/50" />
                      {allowedCards.slice(0, 5).map((card) => {
                        const Icon =
                          cardIconMap[card.cardType as keyof typeof cardIconMap] ?? Sparkles;
                        return (
                          <BlockInsertButton
                            key={card.key}
                            icon={<Icon className="h-3.5 w-3.5" />}
                            title={card.insertLabel}
                            hint={card.description || t("notes.knowledgeInsertCard")}
                            onClick={() => insertCard(card)}
                          />
                        );
                      })}
                      {allowedCards.length > 5 ? (
                        <BlockInsertButton
                          icon={<Sparkles className="h-3.5 w-3.5" />}
                          title={t("notes.knowledgeCardPickerTitle")}
                          hint={t("notes.knowledgeCardPickerHint")}
                          onClick={() => {
                            setIsInsertOpen(true);
                            setIsBlockInsertOpen(false);
                          }}
                        />
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ),
        }
      : null,
    canUse("undo") || canUse("redo")
      ? {
          key: "history",
          node: (
            <ToolbarGroup>
              {canUse("undo") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().undo().run()}
                  disabled={!editor.can().undo()}
                  title={t("editor.undo")}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
              {canUse("redo") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().redo().run()}
                  disabled={!editor.can().redo()}
                  title={t("editor.redo")}
                >
                  <Redo2 className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
            </ToolbarGroup>
          ),
        }
      : null,
    canUse("heading1") || canUse("heading2") || canUse("heading3")
      ? {
          key: "headings",
          node: (
            <ToolbarGroup>
              {canUse("heading1") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                  isActive={editor.isActive("heading", { level: 1 })}
                  title={t("editor.heading1")}
                >
                  <Heading1 className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
              {canUse("heading2") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                  isActive={editor.isActive("heading", { level: 2 })}
                  title={t("editor.heading2")}
                >
                  <Heading2 className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
              {canUse("heading3") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                  isActive={editor.isActive("heading", { level: 3 })}
                  title={t("editor.heading3")}
                >
                  <Heading3 className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
            </ToolbarGroup>
          ),
        }
      : null,
    {
      key: "inline",
      node: (
        <ToolbarGroup>
          {canUse("bold") ? (
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              isActive={editor.isActive("bold")}
              title={t("editor.bold")}
            >
              <Bold className="h-3.5 w-3.5" />
            </ToolbarButton>
          ) : null}
          {canUse("italic") ? (
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              isActive={editor.isActive("italic")}
              title={t("editor.italic")}
            >
              <Italic className="h-3.5 w-3.5" />
            </ToolbarButton>
          ) : null}
          {canUse("strike") ? (
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleStrike().run()}
              isActive={editor.isActive("strike")}
              title={t("editor.strikethrough")}
            >
              <Strikethrough className="h-3.5 w-3.5" />
            </ToolbarButton>
          ) : null}
          {canUse("inlineCode") ? (
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleCode().run()}
              isActive={editor.isActive("code")}
              title={t("editor.inlineCode")}
            >
              <Code className="h-3.5 w-3.5" />
            </ToolbarButton>
          ) : null}
          {canUse("link") ? (
            <ToolbarButton
              onClick={setLink}
              isActive={editor.isActive("link")}
              title={t("editor.link")}
            >
              <Link2 className="h-3.5 w-3.5" />
            </ToolbarButton>
          ) : null}
          {canUse("internalLink") ? (
            <div className="relative">
              <ToolbarButton
                onClick={() => {
                  setIsInternalLinkOpen((open) => !open);
                  setIsImageInsertOpen(false);
                  setIsInsertOpen(false);
                  setIsBlockInsertOpen(false);
                }}
                isActive={isInternalLinkOpen}
                title={t("notes.knowledgeInsertInternalLink")}
              >
                <Network className="h-3.5 w-3.5" />
              </ToolbarButton>

              {isInternalLinkOpen ? (
                <div className="absolute left-0 top-8 z-20 w-72 rounded-lg border border-border/70 bg-popover p-2 shadow-lg">
                  <div className="mb-2 text-xs font-medium text-popover-foreground">
                    {t("notes.knowledgeInsertInternalLink")}
                  </div>
                  <input
                    ref={internalLinkInputRef}
                    value={internalLinkQuery}
                    onChange={(event) => setInternalLinkQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        insertInternalLink(visibleInternalLinkTargets[0]);
                      }
                    }}
                    placeholder={t("notes.knowledgeInternalLinkSearchPlaceholder")}
                    className="mb-2 h-8 w-full rounded-md border border-border/70 bg-background px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-primary/10"
                  />
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    {visibleInternalLinkTargets.map((target) => (
                      <button
                        key={target.id}
                        type="button"
                        className="flex w-full min-w-0 flex-col rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted"
                        onClick={() => insertInternalLink(target)}
                      >
                        <span className="truncate text-xs font-medium text-popover-foreground">
                          {target.title}
                        </span>
                        <span className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {[target.typeLabel, target.path].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    ))}
                    {internalLinkQuery.trim() ? (
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-dashed border-border/70 px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/35 hover:bg-primary/5 hover:text-foreground"
                        onClick={() => insertInternalLink()}
                      >
                        <span className="truncate">
                          {t("notes.knowledgeInsertLooseInternalLink", {
                            title: internalLinkQuery.trim(),
                          })}
                        </span>
                        <Network className="h-3.5 w-3.5 shrink-0" />
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </ToolbarGroup>
      ),
    },
    canUse("bulletList") ||
    canUse("orderedList") ||
    canUse("taskList") ||
    canUse("blockquote") ||
    canUse("horizontalRule")
      ? {
          key: "blocks",
          node: (
            <ToolbarGroup>
              {canUse("bulletList") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                  isActive={editor.isActive("bulletList")}
                  title={t("editor.bulletList")}
                >
                  <List className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
              {canUse("orderedList") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}
                  isActive={editor.isActive("orderedList")}
                  title={t("editor.orderedList")}
                >
                  <ListOrdered className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
              {canUse("taskList") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().toggleTaskList().run()}
                  isActive={editor.isActive("taskList")}
                  title={t("editor.taskList")}
                >
                  <ListTodo className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
              {canUse("blockquote") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().toggleBlockquote().run()}
                  isActive={editor.isActive("blockquote")}
                  title={t("editor.blockquote")}
                >
                  <Quote className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
              {canUse("horizontalRule") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().setHorizontalRule().run()}
                  title={t("editor.horizontalRule")}
                >
                  <Minus className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
            </ToolbarGroup>
          ),
        }
      : null,
    canUse("image")
      ? {
          key: "media",
          node: (
            <div className="relative">
              <ToolbarGroup>
                <ToolbarButton
                  onClick={() => {
                    setIsImageInsertOpen((open) => !open);
                    setIsBlockInsertOpen(false);
                    setIsInsertOpen(false);
                  }}
                  title={t("notes.knowledgeInsertImage")}
                  disabled={!canUse("image")}
                  isActive={isImageInsertOpen}
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                </ToolbarButton>
              </ToolbarGroup>

              {isImageInsertOpen && (
                <form
                  className="absolute left-0 top-8 z-20 w-72 rounded-lg border border-border/70 bg-popover p-2.5 shadow-lg"
                  onSubmit={(event) => {
                    event.preventDefault();
                    insertImage();
                  }}
                >
                  <div className="mb-2 text-xs font-medium text-popover-foreground">
                    {t("notes.knowledgeInsertImage")}
                  </div>
                  {onPickLocalImage ? (
                    <>
                      <button
                        type="button"
                        className="mb-2 flex h-8 w-full items-center justify-center gap-2 rounded-md border border-border/70 bg-muted/30 px-2 text-xs font-medium text-foreground transition-colors hover:border-primary/35 hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={pickLocalImage}
                        disabled={isPickingLocalImage}
                      >
                        <ImagePlus className="h-3.5 w-3.5 text-primary" />
                        {isPickingLocalImage
                          ? t("notes.knowledgeAttachmentAdding")
                          : t("notes.knowledgeInsertLocalImage")}
                      </button>
                      <div className="mb-2 flex items-center gap-2">
                        <span className="h-px flex-1 bg-border/60" />
                        <span className="text-[10px] font-medium uppercase text-muted-foreground">
                          URL
                        </span>
                        <span className="h-px flex-1 bg-border/60" />
                      </div>
                    </>
                  ) : null}
                  <label
                    htmlFor={imageSrcInputId}
                    className="mb-1 block text-[11px] font-medium text-muted-foreground"
                  >
                    {t("notes.knowledgeImageUrlPlaceholder")}
                  </label>
                  <input
                    id={imageSrcInputId}
                    value={imageSrc}
                    onChange={(event) => setImageSrc(event.target.value)}
                    placeholder="https://..."
                    className="mb-2 h-8 w-full rounded-md border border-border/70 bg-background px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-primary/10"
                  />
                  <label
                    htmlFor={imageAltInputId}
                    className="mb-1 block text-[11px] font-medium text-muted-foreground"
                  >
                    {t("notes.knowledgeImageAltPlaceholder")}
                  </label>
                  <input
                    id={imageAltInputId}
                    value={imageAlt}
                    onChange={(event) => setImageAlt(event.target.value)}
                    placeholder={t("notes.knowledgeImageAltPrompt")}
                    className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-primary/10"
                  />
                  <div className="mt-2.5 flex justify-end gap-1.5">
                    <button
                      type="button"
                      className="h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={() => {
                        setIsImageInsertOpen(false);
                        setImageSrc("");
                        setImageAlt("");
                      }}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="submit"
                      className="h-7 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition-opacity disabled:opacity-45"
                      disabled={!imageSrc.trim()}
                    >
                      {t("common.confirm")}
                    </button>
                  </div>
                </form>
              )}
            </div>
          ),
        }
      : null,
    allowedCards.length > 0
      ? {
          key: "cards",
          node: (
            <div className="relative">
              <ToolbarButton
                onClick={() => {
                  setIsInsertOpen((open) => !open);
                  setIsImageInsertOpen(false);
                  setIsBlockInsertOpen(false);
                }}
                isActive={isInsertOpen}
                title={t("notes.knowledgeInsertCard", { defaultValue: "Insert card" })}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </ToolbarButton>

              {isInsertOpen && (
                <div className="absolute left-0 top-8 z-20 w-[26rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border/70 bg-popover p-1.5 shadow-lg">
                  {allowedCards.map((card) => {
                    const Icon = cardIconMap[card.cardType as keyof typeof cardIconMap] ?? Sparkles;
                    return (
                      <div
                        key={card.key}
                        className="group/card flex w-full items-center gap-1 rounded-md text-xs text-popover-foreground transition-colors hover:bg-muted"
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"
                          onClick={() => insertCard(card)}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{card.insertLabel}</span>
                            {card.description ? (
                              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                                {card.description}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        {card.template ? (
                          <div className="mr-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/card:opacity-100 focus-within:opacity-100">
                            <button
                              type="button"
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (card.template) openTemplateEditForm(card.template);
                              }}
                              aria-label={t("notes.knowledgeCustomCardEdit", {
                                defaultValue: "Edit custom card",
                              })}
                              title={t("notes.knowledgeCustomCardEdit", {
                                defaultValue: "Edit custom card",
                              })}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (card.template) void disableTemplate(card.template);
                              }}
                              aria-label={t("notes.knowledgeCustomCardDisable", {
                                defaultValue: "Remove custom card",
                              })}
                              title={t("notes.knowledgeCustomCardDisable", {
                                defaultValue: "Remove custom card",
                              })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {canUse("readAnyCards") ? (
                    <>
                      <div className="my-1 h-px bg-border/55" />
                      {isTemplateFormOpen ? (
                        <form
                          className="space-y-2 rounded-md bg-muted/25 p-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveTemplate();
                          }}
                        >
                          <div className="rounded-md border border-border/45 bg-background/70 px-2.5 py-2">
                            <p className="text-xs font-semibold text-foreground">
                              {editingTemplateId
                                ? t("notes.knowledgeCustomCardEdit", {
                                    defaultValue: "Edit custom card",
                                  })
                                : t("notes.knowledgeCustomCardNew", {
                                    defaultValue: "New custom card",
                                  })}
                            </p>
                            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                              {editingTemplateId
                                ? t("notes.knowledgeCustomCardEditHint", {
                                    defaultValue:
                                      "Updates future insertions. Cards already in documents stay unchanged.",
                                  })
                                : t("notes.knowledgeCustomCardNewHint", {
                                    defaultValue: "Create a reusable structure that syncs.",
                                  })}
                            </p>
                          </div>
                          <div className="space-y-1">
                            <label
                              htmlFor="knowledge-custom-card-name"
                              className="text-[11px] font-medium text-muted-foreground"
                            >
                              {t("notes.knowledgeCustomCardName", {
                                defaultValue: "Card name",
                              })}
                            </label>
                            <input
                              id="knowledge-custom-card-name"
                              value={templateName}
                              onChange={(event) => {
                                setTemplateName(event.target.value);
                                setTemplateSaveError(null);
                              }}
                              placeholder={t("notes.knowledgeCustomCardNamePlaceholder", {
                                defaultValue: "Concept, timeline, reading question...",
                              })}
                              className="h-8 w-full rounded-md border border-border/55 bg-background px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
                            />
                          </div>
                          <div className="space-y-1">
                            <label
                              htmlFor="knowledge-custom-card-description"
                              className="text-[11px] font-medium text-muted-foreground"
                            >
                              {t("notes.knowledgeCustomCardDescription", {
                                defaultValue: "Description",
                              })}
                            </label>
                            <input
                              id="knowledge-custom-card-description"
                              value={templateDescription}
                              onChange={(event) => setTemplateDescription(event.target.value)}
                              placeholder={t("notes.knowledgeCustomCardDescriptionPlaceholder", {
                                defaultValue: "What this structure is for",
                              })}
                              className="h-8 w-full rounded-md border border-border/55 bg-background px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
                            />
                          </div>
                          <div className="space-y-1">
                            <label
                              htmlFor="knowledge-custom-card-markdown"
                              className="text-[11px] font-medium text-muted-foreground"
                            >
                              {t("notes.knowledgeCustomCardDefaultBody", {
                                defaultValue: "Default body",
                              })}
                            </label>
                            <textarea
                              id="knowledge-custom-card-markdown"
                              value={templateMarkdown}
                              onChange={(event) => setTemplateMarkdown(event.target.value)}
                              placeholder={t("notes.knowledgeCustomCardBodyPlaceholder", {
                                defaultValue: "Question:\nAnswer:\nSource:",
                              })}
                              rows={3}
                              className="min-h-16 w-full resize-none rounded-md border border-border/55 bg-background px-2.5 py-2 text-xs leading-5 text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
                            />
                          </div>
                          <div className="space-y-2 rounded-md border border-border/45 bg-background/65 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-foreground">
                                  {t("notes.knowledgeCustomCardFields", {
                                    defaultValue: "Fields",
                                  })}
                                </p>
                                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                                  {t("notes.knowledgeCustomCardFieldsHint", {
                                    defaultValue:
                                      "Turn card data into editable fields instead of raw JSON.",
                                  })}
                                </p>
                              </div>
                              <button
                                type="button"
                                className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                                onClick={addTemplateField}
                              >
                                <Plus className="h-3.5 w-3.5" />
                                {t("notes.knowledgeCustomCardAddField", {
                                  defaultValue: "Add",
                                })}
                              </button>
                            </div>
                            {templateFields.length > 0 ? (
                              <div className="space-y-1.5">
                                {templateFields.map((field, index) => {
                                  const conditionSourceFields = templateFields.filter(
                                    (candidate, candidateIndex) =>
                                      candidateIndex !== index && candidate.key !== field.key,
                                  );
                                  const conditionSourceField = conditionSourceFields.find(
                                    (candidate) => candidate.key === field.visibleWhen?.fieldKey,
                                  );
                                  const conditionOperator = field.visibleWhen?.operator ?? "equals";
                                  const conditionNeedsValue =
                                    conditionOperator !== "empty" &&
                                    conditionOperator !== "notEmpty";
                                  const fieldGroupName = field.group?.trim() || "";
                                  const groupConditionSourceFields = fieldGroupName
                                    ? templateFields.filter(
                                        (candidate, candidateIndex) =>
                                          candidateIndex !== index && candidate.key !== field.key,
                                      )
                                    : [];
                                  const isFirstGroupField = fieldGroupName
                                    ? templateFields.findIndex(
                                        (candidate) => candidate.group?.trim() === fieldGroupName,
                                      ) === index
                                    : false;
                                  const groupVisibleWhen = fieldGroupName
                                    ? templateFields.find(
                                        (candidate) =>
                                          candidate.group?.trim() === fieldGroupName &&
                                          candidate.groupVisibleWhen,
                                      )?.groupVisibleWhen
                                    : undefined;
                                  const groupConditionSourceField = groupConditionSourceFields.find(
                                    (candidate) => candidate.key === groupVisibleWhen?.fieldKey,
                                  );
                                  const groupConditionOperator =
                                    groupVisibleWhen?.operator ?? "equals";
                                  const groupConditionNeedsValue =
                                    groupConditionOperator !== "empty" &&
                                    groupConditionOperator !== "notEmpty";

                                  return (
                                    <div
                                      key={`${field.key}-${index}`}
                                      className="grid gap-1.5 rounded-md border border-border/45 bg-muted/20 p-2"
                                    >
                                      <div className="grid gap-1.5 sm:grid-cols-[1fr_0.9fr_0.8fr]">
                                        <label className="space-y-1">
                                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                            {t("notes.knowledgeCustomCardFieldLabel", {
                                              defaultValue: "Label",
                                            })}
                                          </span>
                                          <input
                                            value={field.label}
                                            onChange={(event) =>
                                              updateTemplateField(index, {
                                                label: event.currentTarget.value,
                                              })
                                            }
                                            className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
                                            placeholder={t(
                                              "notes.knowledgeCustomCardFieldLabelPlaceholder",
                                              {
                                                defaultValue: "Question, evidence, confidence...",
                                              },
                                            )}
                                          />
                                        </label>
                                        <label className="space-y-1">
                                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                            {t("notes.knowledgeCustomCardFieldKey", {
                                              defaultValue: "Data key",
                                            })}
                                          </span>
                                          <input
                                            value={field.key}
                                            onChange={(event) =>
                                              updateTemplateField(index, {
                                                key: event.currentTarget.value,
                                              })
                                            }
                                            className="h-8 w-full rounded-md border border-border/55 bg-background px-2 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
                                            placeholder="field_key"
                                          />
                                        </label>
                                        <label className="space-y-1">
                                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                            {t("notes.knowledgeCustomCardFieldGroup", {
                                              defaultValue: "Group",
                                            })}
                                          </span>
                                          <input
                                            value={field.group ?? ""}
                                            onChange={(event) =>
                                              updateTemplateField(index, {
                                                group:
                                                  event.currentTarget.value.trim() || undefined,
                                                groupVisibleWhen: event.currentTarget.value.trim()
                                                  ? field.groupVisibleWhen
                                                  : undefined,
                                              })
                                            }
                                            className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
                                            placeholder={t(
                                              "notes.knowledgeCustomCardFieldGroupPlaceholder",
                                              {
                                                defaultValue: "Core, Evidence, Follow-up...",
                                              },
                                            )}
                                          />
                                        </label>
                                      </div>
                                      {fieldGroupName && isFirstGroupField ? (
                                        <div className="rounded-md border border-border/45 bg-background/55 p-2">
                                          <div className="grid gap-1.5 sm:grid-cols-[0.9fr_0.8fr_1fr]">
                                            <label className="space-y-1">
                                              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                                {t("notes.knowledgeCustomCardGroupVisibleWhen", {
                                                  defaultValue: "Group shows when",
                                                })}
                                              </span>
                                              <select
                                                value={groupVisibleWhen?.fieldKey ?? ""}
                                                onChange={(event) => {
                                                  const fieldKey = event.currentTarget.value;
                                                  updateTemplateGroupVisibleWhen(
                                                    fieldGroupName,
                                                    fieldKey
                                                      ? {
                                                          fieldKey,
                                                          operator:
                                                            groupVisibleWhen?.operator ?? "equals",
                                                          value: groupVisibleWhen?.value ?? "",
                                                        }
                                                      : undefined,
                                                  );
                                                }}
                                                className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none focus:border-primary/45"
                                              >
                                                <option value="">
                                                  {t(
                                                    "notes.knowledgeCustomCardFieldAlwaysVisible",
                                                    { defaultValue: "Always visible" },
                                                  )}
                                                </option>
                                                {groupConditionSourceFields.map((candidate) => (
                                                  <option key={candidate.key} value={candidate.key}>
                                                    {candidate.label}
                                                  </option>
                                                ))}
                                              </select>
                                            </label>
                                            {groupVisibleWhen ? (
                                              <>
                                                <label className="space-y-1">
                                                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                                    {t(
                                                      "notes.knowledgeCustomCardFieldConditionOperator",
                                                      { defaultValue: "Rule" },
                                                    )}
                                                  </span>
                                                  <select
                                                    value={groupConditionOperator}
                                                    onChange={(event) => {
                                                      const operator = event.currentTarget
                                                        .value as NonNullable<
                                                        ReadAnyCardTemplateField["visibleWhen"]
                                                      >["operator"];
                                                      updateTemplateGroupVisibleWhen(
                                                        fieldGroupName,
                                                        {
                                                          fieldKey:
                                                            groupVisibleWhen?.fieldKey ?? "",
                                                          operator,
                                                          value:
                                                            operator === "empty" ||
                                                            operator === "notEmpty"
                                                              ? undefined
                                                              : (groupVisibleWhen?.value ?? ""),
                                                        },
                                                      );
                                                    }}
                                                    className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none focus:border-primary/45"
                                                  >
                                                    {customCardFieldConditionOperators.map(
                                                      (operator) => (
                                                        <option key={operator} value={operator}>
                                                          {operator === "equals"
                                                            ? t(
                                                                "notes.knowledgeCustomCardConditionEquals",
                                                                { defaultValue: "equals" },
                                                              )
                                                            : operator === "notEquals"
                                                              ? t(
                                                                  "notes.knowledgeCustomCardConditionNotEquals",
                                                                  { defaultValue: "is not" },
                                                                )
                                                              : operator === "contains"
                                                                ? t(
                                                                    "notes.knowledgeCustomCardConditionContains",
                                                                    { defaultValue: "contains" },
                                                                  )
                                                                : operator === "notContains"
                                                                  ? t(
                                                                      "notes.knowledgeCustomCardConditionNotContains",
                                                                      {
                                                                        defaultValue:
                                                                          "does not contain",
                                                                      },
                                                                    )
                                                                  : operator === "empty"
                                                                    ? t(
                                                                        "notes.knowledgeCustomCardConditionEmpty",
                                                                        {
                                                                          defaultValue: "is empty",
                                                                        },
                                                                      )
                                                                    : t(
                                                                        "notes.knowledgeCustomCardConditionNotEmpty",
                                                                        {
                                                                          defaultValue:
                                                                            "is not empty",
                                                                        },
                                                                      )}
                                                        </option>
                                                      ),
                                                    )}
                                                  </select>
                                                </label>
                                                {groupConditionNeedsValue ? (
                                                  <div className="space-y-1">
                                                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                                      {t(
                                                        "notes.knowledgeCustomCardFieldConditionValue",
                                                        { defaultValue: "Value" },
                                                      )}
                                                    </span>
                                                    {groupConditionSourceField?.type ===
                                                    "checkbox" ? (
                                                      <select
                                                        value={getTemplateConditionValueString(
                                                          groupVisibleWhen,
                                                        )}
                                                        onChange={(event) =>
                                                          updateTemplateGroupVisibleWhen(
                                                            fieldGroupName,
                                                            {
                                                              fieldKey:
                                                                groupVisibleWhen?.fieldKey ?? "",
                                                              operator: groupConditionOperator,
                                                              value:
                                                                event.currentTarget.value ===
                                                                "true",
                                                            },
                                                          )
                                                        }
                                                        className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none focus:border-primary/45"
                                                      >
                                                        <option value="true">
                                                          {t("common.yes", {
                                                            defaultValue: "Yes",
                                                          })}
                                                        </option>
                                                        <option value="false">
                                                          {t("common.no", { defaultValue: "No" })}
                                                        </option>
                                                      </select>
                                                    ) : isChoiceTemplateField(
                                                        groupConditionSourceField ??
                                                          ({
                                                            type: "text",
                                                          } as ReadAnyCardTemplateField),
                                                      ) ? (
                                                      <select
                                                        value={getTemplateConditionValueString(
                                                          groupVisibleWhen,
                                                        )}
                                                        onChange={(event) =>
                                                          updateTemplateGroupVisibleWhen(
                                                            fieldGroupName,
                                                            {
                                                              fieldKey:
                                                                groupVisibleWhen?.fieldKey ?? "",
                                                              operator: groupConditionOperator,
                                                              value: event.currentTarget.value,
                                                            },
                                                          )
                                                        }
                                                        className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none focus:border-primary/45"
                                                      >
                                                        {(
                                                          groupConditionSourceField?.options ?? []
                                                        ).map((option) => (
                                                          <option
                                                            key={option.value}
                                                            value={option.value}
                                                          >
                                                            {option.label}
                                                          </option>
                                                        ))}
                                                      </select>
                                                    ) : (
                                                      <input
                                                        value={getTemplateConditionValueString(
                                                          groupVisibleWhen,
                                                        )}
                                                        onChange={(event) =>
                                                          updateTemplateGroupVisibleWhen(
                                                            fieldGroupName,
                                                            {
                                                              fieldKey:
                                                                groupVisibleWhen?.fieldKey ?? "",
                                                              operator: groupConditionOperator,
                                                              value:
                                                                parseTemplateFieldConditionValue(
                                                                  groupConditionSourceField,
                                                                  event.currentTarget.value,
                                                                ),
                                                            },
                                                          )
                                                        }
                                                        className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
                                                        placeholder={t(
                                                          "notes.knowledgeCustomCardFieldConditionValuePlaceholder",
                                                          { defaultValue: "Expected value" },
                                                        )}
                                                      />
                                                    )}
                                                  </div>
                                                ) : (
                                                  <div className="self-end rounded-md border border-border/40 bg-muted/25 px-2 py-2 text-[11px] leading-4 text-muted-foreground">
                                                    {t(
                                                      "notes.knowledgeCustomCardFieldConditionNoValue",
                                                      {
                                                        defaultValue:
                                                          "This rule does not need a value.",
                                                      },
                                                    )}
                                                  </div>
                                                )}
                                              </>
                                            ) : (
                                              <div className="self-end rounded-md border border-dashed border-border/50 bg-muted/20 px-2 py-2 text-[11px] leading-4 text-muted-foreground sm:col-span-2">
                                                {t("notes.knowledgeCustomCardGroupVisibleHint", {
                                                  defaultValue:
                                                    "All fields in this group follow the same group rule.",
                                                })}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      ) : null}
                                      <div className="grid gap-1.5 sm:grid-cols-[0.8fr_1fr_1fr_auto]">
                                        <label className="space-y-1">
                                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                            {t("notes.knowledgeCustomCardFieldType", {
                                              defaultValue: "Type",
                                            })}
                                          </span>
                                          <select
                                            value={field.type}
                                            onChange={(event) => {
                                              const nextType = event.currentTarget
                                                .value as ReadAnyCardTemplateField["type"];
                                              updateTemplateField(index, {
                                                type: nextType,
                                                options:
                                                  nextType === "select" ||
                                                  nextType === "multiselect"
                                                    ? field.options?.length
                                                      ? field.options
                                                      : createDefaultTemplateFieldOptions(t)
                                                    : undefined,
                                                defaultValue:
                                                  nextType === "multiselect"
                                                    ? []
                                                    : nextType === "checkbox"
                                                      ? undefined
                                                      : typeof field.defaultValue === "boolean"
                                                        ? undefined
                                                        : field.defaultValue,
                                              });
                                            }}
                                            className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none focus:border-primary/45"
                                          >
                                            {customCardFieldTypes.map((type) => (
                                              <option key={type} value={type}>
                                                {type === "text"
                                                  ? t("notes.knowledgeCustomCardFieldTypeText", {
                                                      defaultValue: "Text",
                                                    })
                                                  : type === "multiline"
                                                    ? t(
                                                        "notes.knowledgeCustomCardFieldTypeMultiline",
                                                        { defaultValue: "Long text" },
                                                      )
                                                    : type === "number"
                                                      ? t(
                                                          "notes.knowledgeCustomCardFieldTypeNumber",
                                                          { defaultValue: "Number" },
                                                        )
                                                      : type === "checkbox"
                                                        ? t(
                                                            "notes.knowledgeCustomCardFieldTypeCheckbox",
                                                            { defaultValue: "Checkbox" },
                                                          )
                                                        : type === "select"
                                                          ? t(
                                                              "notes.knowledgeCustomCardFieldTypeSelect",
                                                              { defaultValue: "Single choice" },
                                                            )
                                                          : t(
                                                              "notes.knowledgeCustomCardFieldTypeMultiselect",
                                                              { defaultValue: "Multiple choice" },
                                                            )}
                                              </option>
                                            ))}
                                          </select>
                                        </label>
                                        <div className="space-y-1">
                                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                            {t("notes.knowledgeCustomCardFieldLayout", {
                                              defaultValue: "Layout",
                                            })}
                                          </span>
                                          <div className="grid h-8 grid-cols-4 overflow-hidden rounded-md border border-border/55 bg-background">
                                            {customCardFieldWidths.map((width) => {
                                              const isActive = (field.width ?? "") === width;
                                              const label =
                                                width === ""
                                                  ? t("notes.knowledgeCustomCardFieldWidthAuto", {
                                                      defaultValue: "Auto",
                                                    })
                                                  : width === "full"
                                                    ? t("notes.knowledgeCustomCardFieldWidthFull", {
                                                        defaultValue: "Full",
                                                      })
                                                    : width === "half"
                                                      ? t(
                                                          "notes.knowledgeCustomCardFieldWidthHalf",
                                                          { defaultValue: "Half" },
                                                        )
                                                      : t(
                                                          "notes.knowledgeCustomCardFieldWidthThird",
                                                          { defaultValue: "Third" },
                                                        );
                                              return (
                                                <button
                                                  key={width || "auto"}
                                                  type="button"
                                                  className={cn(
                                                    "border-r border-border/45 px-1 text-[10px] font-medium text-muted-foreground transition-colors last:border-r-0 hover:bg-muted/50",
                                                    isActive && "bg-primary/10 text-primary",
                                                  )}
                                                  onClick={() =>
                                                    updateTemplateField(index, {
                                                      width: width || undefined,
                                                    })
                                                  }
                                                >
                                                  {label}
                                                </button>
                                              );
                                            })}
                                          </div>
                                        </div>
                                        <div className="space-y-1">
                                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                            {t("notes.knowledgeCustomCardFieldDefault", {
                                              defaultValue: "Default",
                                            })}
                                          </span>
                                          {field.type === "checkbox" ? (
                                            <select
                                              value={
                                                field.defaultValue === undefined
                                                  ? ""
                                                  : field.defaultValue
                                                    ? "true"
                                                    : "false"
                                              }
                                              onChange={(event) =>
                                                updateTemplateField(index, {
                                                  defaultValue:
                                                    event.currentTarget.value === ""
                                                      ? undefined
                                                      : event.currentTarget.value === "true",
                                                })
                                              }
                                              className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none focus:border-primary/45"
                                            >
                                              <option value="">
                                                {t("notes.knowledgeCustomCardFieldDefaultEmpty", {
                                                  defaultValue: "No default",
                                                })}
                                              </option>
                                              <option value="true">
                                                {t("common.yes", { defaultValue: "Yes" })}
                                              </option>
                                              <option value="false">
                                                {t("common.no", { defaultValue: "No" })}
                                              </option>
                                            </select>
                                          ) : field.type === "select" ? (
                                            <select
                                              value={getTemplateFieldDefaultString(field)}
                                              onChange={(event) =>
                                                updateTemplateField(index, {
                                                  defaultValue:
                                                    event.currentTarget.value === ""
                                                      ? undefined
                                                      : event.currentTarget.value,
                                                })
                                              }
                                              className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none focus:border-primary/45"
                                            >
                                              <option value="">
                                                {t("notes.knowledgeCustomCardFieldDefaultEmpty", {
                                                  defaultValue: "No default",
                                                })}
                                              </option>
                                              {(field.options ?? []).map((option) => (
                                                <option key={option.value} value={option.value}>
                                                  {option.label}
                                                </option>
                                              ))}
                                            </select>
                                          ) : field.type === "multiselect" ? (
                                            <div className="flex min-h-8 flex-wrap gap-1 rounded-md border border-border/55 bg-background p-1">
                                              {(field.options ?? []).map((option) => {
                                                const selectedValues = Array.isArray(
                                                  field.defaultValue,
                                                )
                                                  ? field.defaultValue.map(String)
                                                  : [];
                                                const isSelected = selectedValues.includes(
                                                  option.value,
                                                );
                                                return (
                                                  <button
                                                    key={option.value}
                                                    type="button"
                                                    className={cn(
                                                      "rounded-sm px-1.5 py-0.5 text-[11px] transition-colors",
                                                      isSelected
                                                        ? "bg-primary/12 text-primary"
                                                        : "bg-muted/45 text-muted-foreground hover:bg-muted",
                                                    )}
                                                    onClick={() => {
                                                      const nextValues = isSelected
                                                        ? selectedValues.filter(
                                                            (value) => value !== option.value,
                                                          )
                                                        : [...selectedValues, option.value];
                                                      updateTemplateField(index, {
                                                        defaultValue: nextValues,
                                                      });
                                                    }}
                                                  >
                                                    {option.label}
                                                  </button>
                                                );
                                              })}
                                            </div>
                                          ) : (
                                            <input
                                              value={
                                                field.defaultValue === undefined ||
                                                field.defaultValue === null
                                                  ? ""
                                                  : String(field.defaultValue)
                                              }
                                              onChange={(event) =>
                                                updateTemplateField(index, {
                                                  defaultValue:
                                                    event.currentTarget.value === ""
                                                      ? undefined
                                                      : event.currentTarget.value,
                                                })
                                              }
                                              className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
                                              placeholder={t(
                                                "notes.knowledgeCustomCardFieldDefaultPlaceholder",
                                                {
                                                  defaultValue: "Optional",
                                                },
                                              )}
                                            />
                                          )}
                                        </div>
                                        <button
                                          type="button"
                                          className="mt-5 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                          onClick={() => removeTemplateField(index)}
                                          aria-label={t("notes.knowledgeCustomCardRemoveField", {
                                            defaultValue: "Remove field",
                                          })}
                                          title={t("notes.knowledgeCustomCardRemoveField", {
                                            defaultValue: "Remove field",
                                          })}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                      <div className="grid gap-1.5 sm:grid-cols-[1fr_1fr_auto]">
                                        <label className="space-y-1">
                                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                            {t("notes.knowledgeCustomCardFieldPlaceholder", {
                                              defaultValue: "Placeholder",
                                            })}
                                          </span>
                                          <input
                                            value={field.placeholder ?? ""}
                                            onChange={(event) =>
                                              updateTemplateField(index, {
                                                placeholder: event.currentTarget.value || undefined,
                                              })
                                            }
                                            className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
                                            placeholder={t(
                                              "notes.knowledgeCustomCardFieldPlaceholderPlaceholder",
                                              { defaultValue: "Shown while empty" },
                                            )}
                                          />
                                        </label>
                                        <label className="space-y-1">
                                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                            {t("notes.knowledgeCustomCardFieldHelpText", {
                                              defaultValue: "Help text",
                                            })}
                                          </span>
                                          <input
                                            value={field.helpText ?? ""}
                                            onChange={(event) =>
                                              updateTemplateField(index, {
                                                helpText: event.currentTarget.value || undefined,
                                              })
                                            }
                                            className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
                                            placeholder={t(
                                              "notes.knowledgeCustomCardFieldHelpTextPlaceholder",
                                              { defaultValue: "Short hint under the field" },
                                            )}
                                          />
                                        </label>
                                        <label className="mt-5 flex h-8 items-center gap-2 rounded-md border border-border/45 bg-background/70 px-2.5 text-xs font-medium text-muted-foreground">
                                          <input
                                            type="checkbox"
                                            checked={field.required === true}
                                            onChange={(event) =>
                                              updateTemplateField(index, {
                                                required: event.currentTarget.checked || undefined,
                                              })
                                            }
                                            className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary/30"
                                          />
                                          {t("notes.knowledgeCustomCardFieldRequired", {
                                            defaultValue: "Required",
                                          })}
                                        </label>
                                      </div>
                                      {isChoiceTemplateField(field) ? (
                                        <label className="space-y-1">
                                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                            {t("notes.knowledgeCustomCardFieldOptions", {
                                              defaultValue: "Options",
                                            })}
                                          </span>
                                          <textarea
                                            value={formatTemplateFieldOptionsText(field)}
                                            onChange={(event) =>
                                              updateTemplateField(index, {
                                                options: parseTemplateFieldOptionsText(
                                                  event.currentTarget.value,
                                                  t,
                                                ),
                                              })
                                            }
                                            rows={Math.max(
                                              2,
                                              Math.min(5, field.options?.length ?? 2),
                                            )}
                                            className="min-h-16 w-full resize-y rounded-md border border-border/55 bg-background px-2.5 py-2 font-mono text-[11px] leading-5 text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
                                            placeholder={t(
                                              "notes.knowledgeCustomCardFieldOptionsPlaceholder",
                                              {
                                                defaultValue:
                                                  "Important | important\nLater | later",
                                              },
                                            )}
                                          />
                                          <p className="text-[10px] leading-4 text-muted-foreground">
                                            {t("notes.knowledgeCustomCardFieldOptionsHint", {
                                              defaultValue:
                                                "One option per line. Use Label | value when you need a stable value.",
                                            })}
                                          </p>
                                        </label>
                                      ) : null}
                                      <div className="rounded-md border border-border/45 bg-background/55 p-2">
                                        <div className="grid gap-1.5 sm:grid-cols-[0.9fr_0.8fr_1fr]">
                                          <label className="space-y-1">
                                            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                              {t("notes.knowledgeCustomCardFieldVisibleWhen", {
                                                defaultValue: "Show when",
                                              })}
                                            </span>
                                            <select
                                              value={field.visibleWhen?.fieldKey ?? ""}
                                              onChange={(event) => {
                                                const fieldKey = event.currentTarget.value;
                                                updateTemplateField(index, {
                                                  visibleWhen: fieldKey
                                                    ? {
                                                        fieldKey,
                                                        operator:
                                                          field.visibleWhen?.operator ?? "equals",
                                                        value: field.visibleWhen?.value ?? "",
                                                      }
                                                    : undefined,
                                                });
                                              }}
                                              className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none focus:border-primary/45"
                                            >
                                              <option value="">
                                                {t("notes.knowledgeCustomCardFieldAlwaysVisible", {
                                                  defaultValue: "Always visible",
                                                })}
                                              </option>
                                              {conditionSourceFields.map((candidate) => (
                                                <option key={candidate.key} value={candidate.key}>
                                                  {candidate.label}
                                                </option>
                                              ))}
                                            </select>
                                          </label>
                                          {field.visibleWhen ? (
                                            <>
                                              <label className="space-y-1">
                                                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                                  {t(
                                                    "notes.knowledgeCustomCardFieldConditionOperator",
                                                    { defaultValue: "Rule" },
                                                  )}
                                                </span>
                                                <select
                                                  value={conditionOperator}
                                                  onChange={(event) => {
                                                    const operator = event.currentTarget
                                                      .value as NonNullable<
                                                      ReadAnyCardTemplateField["visibleWhen"]
                                                    >["operator"];
                                                    updateTemplateField(index, {
                                                      visibleWhen: {
                                                        fieldKey: field.visibleWhen?.fieldKey ?? "",
                                                        operator,
                                                        value:
                                                          operator === "empty" ||
                                                          operator === "notEmpty"
                                                            ? undefined
                                                            : (field.visibleWhen?.value ?? ""),
                                                      },
                                                    });
                                                  }}
                                                  className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none focus:border-primary/45"
                                                >
                                                  {customCardFieldConditionOperators.map(
                                                    (operator) => (
                                                      <option key={operator} value={operator}>
                                                        {operator === "equals"
                                                          ? t(
                                                              "notes.knowledgeCustomCardConditionEquals",
                                                              { defaultValue: "equals" },
                                                            )
                                                          : operator === "notEquals"
                                                            ? t(
                                                                "notes.knowledgeCustomCardConditionNotEquals",
                                                                { defaultValue: "is not" },
                                                              )
                                                            : operator === "contains"
                                                              ? t(
                                                                  "notes.knowledgeCustomCardConditionContains",
                                                                  { defaultValue: "contains" },
                                                                )
                                                              : operator === "notContains"
                                                                ? t(
                                                                    "notes.knowledgeCustomCardConditionNotContains",
                                                                    {
                                                                      defaultValue:
                                                                        "does not contain",
                                                                    },
                                                                  )
                                                                : operator === "empty"
                                                                  ? t(
                                                                      "notes.knowledgeCustomCardConditionEmpty",
                                                                      {
                                                                        defaultValue: "is empty",
                                                                      },
                                                                    )
                                                                  : t(
                                                                      "notes.knowledgeCustomCardConditionNotEmpty",
                                                                      {
                                                                        defaultValue:
                                                                          "is not empty",
                                                                      },
                                                                    )}
                                                      </option>
                                                    ),
                                                  )}
                                                </select>
                                              </label>
                                              {conditionNeedsValue ? (
                                                <div className="space-y-1">
                                                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                                    {t(
                                                      "notes.knowledgeCustomCardFieldConditionValue",
                                                      { defaultValue: "Value" },
                                                    )}
                                                  </span>
                                                  {conditionSourceField?.type === "checkbox" ? (
                                                    <select
                                                      value={getTemplateFieldConditionValueString(
                                                        field,
                                                      )}
                                                      onChange={(event) =>
                                                        updateTemplateField(index, {
                                                          visibleWhen: {
                                                            fieldKey:
                                                              field.visibleWhen?.fieldKey ?? "",
                                                            operator: conditionOperator,
                                                            value:
                                                              event.currentTarget.value === "true",
                                                          },
                                                        })
                                                      }
                                                      className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none focus:border-primary/45"
                                                    >
                                                      <option value="true">
                                                        {t("common.yes", { defaultValue: "Yes" })}
                                                      </option>
                                                      <option value="false">
                                                        {t("common.no", { defaultValue: "No" })}
                                                      </option>
                                                    </select>
                                                  ) : isChoiceTemplateField(
                                                      conditionSourceField ??
                                                        ({
                                                          type: "text",
                                                        } as ReadAnyCardTemplateField),
                                                    ) ? (
                                                    <select
                                                      value={getTemplateFieldConditionValueString(
                                                        field,
                                                      )}
                                                      onChange={(event) =>
                                                        updateTemplateField(index, {
                                                          visibleWhen: {
                                                            fieldKey:
                                                              field.visibleWhen?.fieldKey ?? "",
                                                            operator: conditionOperator,
                                                            value: event.currentTarget.value,
                                                          },
                                                        })
                                                      }
                                                      className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none focus:border-primary/45"
                                                    >
                                                      {(conditionSourceField?.options ?? []).map(
                                                        (option) => (
                                                          <option
                                                            key={option.value}
                                                            value={option.value}
                                                          >
                                                            {option.label}
                                                          </option>
                                                        ),
                                                      )}
                                                    </select>
                                                  ) : (
                                                    <input
                                                      value={getTemplateFieldConditionValueString(
                                                        field,
                                                      )}
                                                      onChange={(event) =>
                                                        updateTemplateField(index, {
                                                          visibleWhen: {
                                                            fieldKey:
                                                              field.visibleWhen?.fieldKey ?? "",
                                                            operator: conditionOperator,
                                                            value: parseTemplateFieldConditionValue(
                                                              conditionSourceField,
                                                              event.currentTarget.value,
                                                            ),
                                                          },
                                                        })
                                                      }
                                                      className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
                                                      placeholder={t(
                                                        "notes.knowledgeCustomCardFieldConditionValuePlaceholder",
                                                        { defaultValue: "Expected value" },
                                                      )}
                                                    />
                                                  )}
                                                </div>
                                              ) : (
                                                <div className="self-end rounded-md border border-border/40 bg-muted/25 px-2 py-2 text-[11px] leading-4 text-muted-foreground">
                                                  {t(
                                                    "notes.knowledgeCustomCardFieldConditionNoValue",
                                                    {
                                                      defaultValue:
                                                        "This rule does not need a value.",
                                                    },
                                                  )}
                                                </div>
                                              )}
                                            </>
                                          ) : (
                                            <div className="self-end rounded-md border border-dashed border-border/50 bg-muted/20 px-2 py-2 text-[11px] leading-4 text-muted-foreground sm:col-span-2">
                                              {t(
                                                "notes.knowledgeCustomCardFieldAlwaysVisibleHint",
                                                {
                                                  defaultValue:
                                                    "No condition set. This field is always shown.",
                                                },
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">
                                {t("notes.knowledgeCustomCardNoFields", {
                                  defaultValue:
                                    "No fields yet. The card can still use the default body and advanced JSON.",
                                })}
                              </div>
                            )}
                          </div>
                          {templateSaveError ? (
                            <p className="text-[11px] leading-4 text-destructive">
                              {templateSaveError}
                            </p>
                          ) : null}
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              className="h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              onClick={() => {
                                resetTemplateForm();
                                setIsTemplateFormOpen(false);
                              }}
                            >
                              {t("common.cancel")}
                            </button>
                            <button
                              type="submit"
                              className="h-7 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition-opacity disabled:opacity-45"
                              disabled={!templateName.trim() || isSavingTemplate}
                            >
                              {isSavingTemplate
                                ? t("common.saving", { defaultValue: "Saving..." })
                                : editingTemplateId
                                  ? t("notes.knowledgeCustomCardSave", {
                                      defaultValue: "Save card",
                                    })
                                  : t("notes.knowledgeCustomCardCreate", {
                                      defaultValue: "Create card",
                                    })}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-popover-foreground transition-colors hover:bg-muted"
                          onClick={openNewTemplateForm}
                        >
                          <Sparkles className="h-3.5 w-3.5 text-primary" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {t("notes.knowledgeCustomCardNew", {
                                defaultValue: "New custom card",
                              })}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {t("notes.knowledgeCustomCardNewHint", {
                                defaultValue: "Create a reusable structure that syncs.",
                              })}
                            </span>
                          </span>
                        </button>
                      )}
                    </>
                  ) : null}
                </div>
              )}
            </div>
          ),
        }
      : null,
  ];
  const toolbarGroups = readOnly
    ? []
    : toolbarGroupCandidates.filter(
        (group): group is { key: string; node: ReactNode } => group !== null,
      );
  const isCanvasChrome = chrome === "canvas";

  return (
    <div
      ref={editorShellRef}
      className={cn(
        "relative",
        isCanvasChrome
          ? "group bg-transparent"
          : [
              "group overflow-hidden rounded-lg border border-border/60 bg-background",
              !readOnly &&
                "focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 focus-within:ring-offset-1",
              "transition-all duration-200",
            ],
        className,
      )}
    >
      {toolbarGroups.length > 0 ? (
        <div
          className={cn(
            "flex flex-wrap items-center gap-1",
            isCanvasChrome
              ? "sticky top-0 z-10 mx-auto mb-5 max-w-[820px] rounded-md border border-border/55 bg-background/95 px-2 py-1.5 shadow-sm backdrop-blur"
              : "border-b border-border/40 bg-muted/20 px-2 py-1.5",
          )}
        >
          {toolbarGroups.map((group, index) => (
            <Fragment key={group.key}>
              {index > 0 ? <ToolbarDivider /> : null}
              {group.node}
            </Fragment>
          ))}
        </div>
      ) : null}

      {!readOnly && pendingDraft ? (
        <div
          className={cn(
            "flex min-w-0 items-center justify-between gap-3 border border-primary/20 bg-primary/[0.055] px-3 py-2 text-xs text-foreground",
            isCanvasChrome ? "mx-auto mb-4 max-w-[820px] rounded-md" : "m-3 mb-0 rounded-md",
          )}
        >
          <div className="min-w-0">
            <p className="truncate font-medium">
              {t("notes.knowledgeEditorDraftFound", {
                defaultValue: "Unsaved draft found",
              })}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {t("notes.knowledgeEditorDraftHint", {
                defaultValue: "Restore the latest unsaved edits or discard this draft.",
              })}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              className="h-7 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={discardPendingDraft}
            >
              {t("notes.knowledgeEditorDraftDiscard", { defaultValue: "Discard" })}
            </button>
            <button
              type="button"
              className="h-7 rounded-md bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              onClick={restorePendingDraft}
            >
              {t("notes.knowledgeEditorDraftRestore", { defaultValue: "Restore" })}
            </button>
          </div>
        </div>
      ) : null}

      {floatingToolbarPosition ? (
        <div
          className="absolute z-30 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-md border border-border/70 bg-popover px-1.5 py-1 shadow-lg shadow-background/20"
          style={{
            left: floatingToolbarPosition.left,
            top: floatingToolbarPosition.top,
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {canUse("bold") ? (
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              isActive={editor.isActive("bold")}
              title={t("editor.bold")}
            >
              <Bold className="h-3.5 w-3.5" />
            </ToolbarButton>
          ) : null}
          {canUse("italic") ? (
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              isActive={editor.isActive("italic")}
              title={t("editor.italic")}
            >
              <Italic className="h-3.5 w-3.5" />
            </ToolbarButton>
          ) : null}
          {canUse("strike") ? (
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleStrike().run()}
              isActive={editor.isActive("strike")}
              title={t("editor.strikethrough")}
            >
              <Strikethrough className="h-3.5 w-3.5" />
            </ToolbarButton>
          ) : null}
          {canUse("inlineCode") ? (
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleCode().run()}
              isActive={editor.isActive("code")}
              title={t("editor.inlineCode")}
            >
              <Code className="h-3.5 w-3.5" />
            </ToolbarButton>
          ) : null}
          {canUse("link") ? (
            <>
              <ToolbarDivider />
              <ToolbarButton
                onClick={setLink}
                isActive={editor.isActive("link")}
                title={t("editor.link")}
              >
                <Link2 className="h-3.5 w-3.5" />
              </ToolbarButton>
              {editor.isActive("link") ? (
                <ToolbarButton
                  onClick={unsetLink}
                  title={t("editor.unlink", { defaultValue: "Remove link" })}
                >
                  <Unlink className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <EditorContent
        editor={editor}
        className={cn(
          isCanvasChrome ? "px-0 py-0" : "overflow-y-auto px-4 py-3",
          "[&_.ProseMirror]:outline-none",
          "[&_.is-editor-empty:first-child::before]:text-muted-foreground/60",
          "[&_.is-editor-empty:first-child::before]:pointer-events-none",
          "[&_.is-editor-empty:first-child::before]:float-left",
          "[&_.is-editor-empty:first-child::before]:h-0",
          "[&_.is-editor-empty:first-child::before]:text-[13px]",
          contentClassName,
        )}
      />
    </div>
  );
}

function BlockInsertButton({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/45"
      onClick={onClick}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-popover-foreground">{title}</span>
        {hint ? (
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{hint}</span>
        ) : null}
      </span>
    </button>
  );
}

function getCardDataRecord(value: unknown): Record<string, JSONValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? ({ ...(value as Record<string, JSONValue>) } satisfies Record<string, JSONValue>)
    : {};
}

function getCardFieldInputValue(value: JSONValue | undefined): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

function getCardFieldSelectedValues(value: JSONValue | undefined): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value) return [value];
  return [];
}

function getCardFieldWidthClass(field: ReadAnyCardTemplateField): string {
  if (field.width === "full") return "sm:col-span-6";
  if (field.width === "half") return "sm:col-span-3";
  if (field.width === "third") return "sm:col-span-2";
  return field.type === "multiline" || field.type === "multiselect"
    ? "sm:col-span-6"
    : "sm:col-span-3";
}

function ReadAnyCardView({ editor, node, selected, updateAttributes, getPos }: NodeViewProps) {
  const { t } = useTranslation();
  const attrs = node.attrs as ReadAnyCardAttrs;
  const isEditable = editor.isEditable;
  const storage = editor.storage as unknown as Record<string, unknown>;
  const cardTemplates =
    (storage.readanyCard as { cardTemplates?: KnowledgeCardTemplate[] } | undefined)
      ?.cardTemplates ?? [];
  const readOnlyModel = createReadAnyCardReadOnlyModel(attrs, {
    body: "",
    cardTemplates,
  });
  const modelAttrs = readOnlyModel.attrs;
  const { cardType, version, isFutureVersion, isCustomCard } = readOnlyModel;
  const cardTemplate = cardTemplates.find(
    (template) => createReadAnyCardAttrsFromTemplate(template).cardType === cardType,
  );
  const structuredData = getCardDataRecord(modelAttrs.data);
  const allCardFields = cardTemplate ? getReadAnyCardTemplateFields(cardTemplate) : [];
  const cardFields = cardTemplate
    ? getVisibleReadAnyCardTemplateFields(cardTemplate, structuredData)
    : [];
  const missingRequiredFieldCount = cardFields.filter((field) =>
    isReadAnyCardTemplateRequiredValueMissing(field, structuredData[field.key]),
  ).length;
  const isFallbackCard = readOnlyModel.state === "unsupported";
  const Icon = cardIconMap[cardType as keyof typeof cardIconMap] ?? Sparkles;
  const fallbackTitle = t(`notes.knowledgeCards.${cardType}`, { defaultValue: cardType });
  const title = modelAttrs.title || "";
  const body = readOnlyModel.body;
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const formattedDataInput = formatReadAnyCardDataForEditor(modelAttrs.data);
  const [dataInput, setDataInput] = useState(() => formattedDataInput);
  const [dataError, setDataError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeBody = useCallback((element = bodyRef.current) => {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.max(72, element.scrollHeight)}px`;
  }, []);

  useEffect(() => {
    bodyRef.current?.style.setProperty("--readany-card-lines", String(body.split("\n").length));
    resizeBody();
  }, [body, resizeBody]);

  useEffect(() => {
    setDataInput(formattedDataInput);
    setDataError(null);
  }, [formattedDataInput]);

  const updateTitle = (nextTitle: string) => {
    if (!isEditable) return;
    updateAttributes({ title: nextTitle });
  };
  const updateBody = (nextBody: string) => {
    if (!isEditable) return;
    updateAttributes({ markdown: nextBody, text: nextBody });
  };
  const updateTextAttr = (key: "sourceTitle" | "sourceId" | "cfi", value: string) => {
    if (!isEditable) return;
    updateAttributes({ [key]: value.trim() || null });
  };
  const updateStructuredData = (key: string, value: JSONValue) => {
    if (!isEditable) return;
    const nextData = {
      ...getCardDataRecord(modelAttrs.data),
      [key]: value,
    };
    setDataError(null);
    setDataInput(formatReadAnyCardDataForEditor(nextData));
    updateAttributes({ data: nextData });
  };
  const missingRequiredFieldText = t("notes.knowledgeCardFieldRequiredMissing", {
    defaultValue: "Required value missing.",
  });
  const updateNumberField = (field: ReadAnyCardTemplateField, rawValue: string) => {
    const trimmedValue = rawValue.trim();
    if (!trimmedValue) {
      updateStructuredData(field.key, null);
      return;
    }
    const numberValue = Number(trimmedValue);
    if (!Number.isFinite(numberValue)) {
      setDataError(
        t("notes.knowledgeCardFieldNumberInvalid", {
          field: field.label,
          defaultValue: `${field.label} must be a valid number.`,
        }),
      );
      return;
    }
    updateStructuredData(field.key, numberValue);
  };
  const applyDataInput = () => {
    if (!isEditable) return;
    const result = parseReadAnyCardDataFromEditor(dataInput);
    if (!result.ok) {
      setDataError(result.error);
      return;
    }
    setDataError(null);
    updateAttributes({ data: result.data });
    setDataInput(formatReadAnyCardDataForEditor(result.data));
  };
  const convertToBlocks = () => {
    if (!isEditable || typeof getPos !== "function") return;
    const position = getPos();
    if (typeof position !== "number") return;
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: position, to: position + node.nodeSize },
        createReadAnyCardTiptapContent(modelAttrs),
      )
      .run();
  };

  return (
    <NodeViewWrapper
      className={cn(
        "not-prose my-5 rounded-md border border-l-2 bg-background/80 shadow-sm transition-all duration-200",
        !isEditable && "bg-muted/15",
        selected && isEditable
          ? "border-primary/45 border-l-primary ring-2 ring-primary/10"
          : "border-border/55 border-l-primary/40 hover:border-border hover:border-l-primary/70",
      )}
      data-readany-card-type={cardType}
      contentEditable={false}
    >
      <div className="flex items-start gap-3 px-3.5 py-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-sm bg-muted/45 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {cardType}
            </span>
            {isFutureVersion || isFallbackCard || isCustomCard ? (
              <span
                className={cn(
                  "shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium",
                  isFutureVersion || isFallbackCard
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "bg-primary/10 text-primary",
                )}
              >
                {isFutureVersion
                  ? t("notes.knowledgeCardNewerVersion", {
                      version,
                      defaultValue: readOnlyModel.stateLabel ?? `v${version} newer`,
                    })
                  : isFallbackCard
                    ? t("notes.knowledgeCardFallback", { defaultValue: "fallback" })
                    : (readOnlyModel.stateLabel ?? `v${version}`)}
              </span>
            ) : null}
            {readOnlyModel.sourceTitle ? (
              <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                {t("notes.knowledgeCardSource", { defaultValue: "Source" })}:{" "}
                {readOnlyModel.sourceTitle}
              </span>
            ) : null}
            {isEditable ? (
              <button
                type="button"
                className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/45"
                aria-label={t("notes.knowledgeCardConvertToText", {
                  defaultValue: "Convert card to normal text",
                })}
                title={t("notes.knowledgeCardConvertToText", {
                  defaultValue: "Convert card to normal text",
                })}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  convertToBlocks();
                }}
              >
                <FileText className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {isEditable ? (
              <button
                type="button"
                className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/45"
                aria-expanded={isDetailsOpen}
                aria-label={t("notes.knowledgeCardDetails", {
                  defaultValue: "Card details",
                })}
                title={t("notes.knowledgeCardDetails", {
                  defaultValue: "Card details",
                })}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setIsDetailsOpen((open) => !open);
                }}
              >
                <Code className="h-3.5 w-3.5" />
                {t("notes.knowledgeCardDetailsShort", { defaultValue: "Details" })}
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={title}
              onChange={(event) => updateTitle(event.target.value)}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              aria-label={t("notes.knowledgeCardTitleLabel", {
                defaultValue: "Card title",
              })}
              placeholder={fallbackTitle}
              data-readany-card-control="title"
              readOnly={!isEditable}
              aria-readonly={!isEditable}
              tabIndex={isEditable ? 0 : -1}
              className={cn(
                "min-w-0 flex-1 bg-transparent text-[15px] font-semibold leading-6 text-foreground outline-none placeholder:text-muted-foreground/70",
                isEditable ? "focus:text-primary" : "cursor-default",
              )}
            />
          </div>
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(event) => {
              updateBody(event.target.value);
              resizeBody(event.currentTarget);
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            aria-label={t("notes.knowledgeCardBodyLabel", {
              defaultValue: "Card body",
            })}
            placeholder={t("notes.knowledgeCardBodyPlaceholder", {
              defaultValue: "Write directly inside this card...",
            })}
            rows={3}
            data-readany-card-control="body"
            readOnly={!isEditable}
            aria-readonly={!isEditable}
            tabIndex={isEditable ? 0 : -1}
            className={cn(
              "mt-1.5 block min-h-[72px] w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2.5 py-2 text-[13px] leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground/60",
              isEditable ? "focus:border-primary/20 focus:bg-muted/20" : "cursor-default",
            )}
          />
          {isDetailsOpen ? (
            <div
              className="mt-2.5 grid gap-2 rounded-md border border-border/55 bg-muted/20 p-2.5"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="min-w-0 space-y-1">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("notes.knowledgeCardSourceTitle", { defaultValue: "Source title" })}
                  </span>
                  <input
                    defaultValue={modelAttrs.sourceTitle || ""}
                    onBlur={(event) => updateTextAttr("sourceTitle", event.currentTarget.value)}
                    readOnly={!isEditable}
                    className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
                    placeholder={t("notes.knowledgeCardSourceTitlePlaceholder", {
                      defaultValue: "Chapter or document",
                    })}
                  />
                </label>
                <label className="min-w-0 space-y-1">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("notes.knowledgeCardSourceId", { defaultValue: "Source ID" })}
                  </span>
                  <input
                    defaultValue={modelAttrs.sourceId || ""}
                    onBlur={(event) => updateTextAttr("sourceId", event.currentTarget.value)}
                    readOnly={!isEditable}
                    className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
                    placeholder="highlight-1"
                  />
                </label>
                <label className="min-w-0 space-y-1">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    CFI
                  </span>
                  <input
                    defaultValue={modelAttrs.cfi || ""}
                    onBlur={(event) => updateTextAttr("cfi", event.currentTarget.value)}
                    readOnly={!isEditable}
                    className="h-8 w-full rounded-md border border-border/55 bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
                    placeholder="epubcfi(...)"
                  />
                </label>
              </div>
              {cardFields.length > 0 ? (
                <div className="rounded-md border border-border/45 bg-background/65 p-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-foreground">
                      {t("notes.knowledgeCardStructuredFields", {
                        defaultValue: "Structured fields",
                      })}
                    </p>
                    <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      {allCardFields.length === cardFields.length
                        ? cardFields.length
                        : `${cardFields.length}/${allCardFields.length}`}
                    </span>
                    {missingRequiredFieldCount > 0 ? (
                      <span className="rounded-sm bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                        {t("notes.knowledgeCardFieldMissingCount", {
                          count: missingRequiredFieldCount,
                          defaultValue: "{{count}} missing",
                        })}
                      </span>
                    ) : null}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-6">
                    {cardFields.map((field, fieldIndex) => {
                      const currentValue = structuredData[field.key];
                      const isRequiredMissing = isReadAnyCardTemplateRequiredValueMissing(
                        field,
                        currentValue,
                      );
                      const fieldWidthClass = getCardFieldWidthClass(field);
                      const fieldGroup = field.group?.trim();
                      const previousFieldGroup = cardFields[fieldIndex - 1]?.group?.trim();
                      const groupHeading =
                        fieldGroup && fieldGroup !== previousFieldGroup ? (
                          <div className="mt-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-6">
                            <span>{fieldGroup}</span>
                            <span className="h-px flex-1 bg-border/45" />
                          </div>
                        ) : null;
                      const wrapCardField = (fieldElement: ReactNode) => (
                        <Fragment key={field.key}>
                          {groupHeading}
                          {fieldElement}
                        </Fragment>
                      );
                      const missingHint = isRequiredMissing ? (
                        <span className="mt-1 block text-[10px] leading-4 text-destructive">
                          {missingRequiredFieldText}
                        </span>
                      ) : null;
                      if (field.type === "checkbox") {
                        return wrapCardField(
                          <label
                            className={cn(
                              "flex min-h-9 items-start gap-2 rounded-md border px-2.5 py-2",
                              fieldWidthClass,
                              isRequiredMissing
                                ? "border-destructive/45 bg-destructive/5"
                                : "border-border/45 bg-muted/20",
                            )}
                            data-readany-card-field-state={
                              isRequiredMissing ? "missing" : undefined
                            }
                            data-readany-card-field-width={field.width}
                          >
                            <input
                              type="checkbox"
                              defaultChecked={currentValue === true}
                              aria-invalid={isRequiredMissing || undefined}
                              onChange={(event) =>
                                updateStructuredData(field.key, event.currentTarget.checked)
                              }
                              readOnly={!isEditable}
                              disabled={!isEditable}
                              className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs font-medium text-foreground">
                                {field.label}
                                {field.required ? (
                                  <span className="ml-1 text-primary">*</span>
                                ) : null}
                              </span>
                              {field.helpText ? (
                                <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                                  {field.helpText}
                                </span>
                              ) : null}
                              {missingHint}
                            </span>
                          </label>,
                        );
                      }

                      const label = (
                        <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {field.label}
                          {field.required ? <span className="ml-1 text-primary">*</span> : null}
                        </span>
                      );
                      const helpText = field.helpText ? (
                        <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
                          {field.helpText}
                        </span>
                      ) : null;
                      if (field.type === "multiline") {
                        return wrapCardField(
                          <label className={cn("space-y-1", fieldWidthClass)}>
                            {label}
                            <textarea
                              defaultValue={getCardFieldInputValue(currentValue)}
                              onBlur={(event) =>
                                updateStructuredData(field.key, event.currentTarget.value)
                              }
                              readOnly={!isEditable}
                              rows={3}
                              aria-invalid={isRequiredMissing || undefined}
                              data-readany-card-field-state={
                                isRequiredMissing ? "missing" : undefined
                              }
                              data-readany-card-field-width={field.width}
                              className={cn(
                                "min-h-20 w-full resize-y rounded-md border bg-background px-2.5 py-2 text-xs leading-5 text-foreground outline-none placeholder:text-muted-foreground/60",
                                isRequiredMissing
                                  ? "border-destructive/50 focus:border-destructive/70"
                                  : "border-border/55 focus:border-primary/45",
                              )}
                              placeholder={field.placeholder}
                            />
                            {helpText}
                            {missingHint}
                          </label>,
                        );
                      }

                      if (field.type === "select") {
                        return wrapCardField(
                          <label className={cn("space-y-1", fieldWidthClass)}>
                            {label}
                            <select
                              value={getCardFieldInputValue(currentValue)}
                              onChange={(event) =>
                                updateStructuredData(field.key, event.currentTarget.value || null)
                              }
                              disabled={!isEditable}
                              aria-invalid={isRequiredMissing || undefined}
                              data-readany-card-field-state={
                                isRequiredMissing ? "missing" : undefined
                              }
                              data-readany-card-field-width={field.width}
                              className={cn(
                                "h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground outline-none disabled:opacity-70",
                                isRequiredMissing
                                  ? "border-destructive/50 focus:border-destructive/70"
                                  : "border-border/55 focus:border-primary/45",
                              )}
                            >
                              <option value="">
                                {field.placeholder ||
                                  t("notes.knowledgeCardFieldSelectEmpty", {
                                    defaultValue: "Choose...",
                                  })}
                              </option>
                              {(field.options ?? []).map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            {helpText}
                            {missingHint}
                          </label>,
                        );
                      }

                      if (field.type === "multiselect") {
                        const selectedValues = getCardFieldSelectedValues(currentValue);
                        return wrapCardField(
                          <div className={cn("space-y-1", fieldWidthClass)}>
                            {label}
                            <div
                              className={cn(
                                "flex flex-wrap gap-1 rounded-md border bg-background p-1",
                                isRequiredMissing ? "border-destructive/50" : "border-border/55",
                              )}
                              data-readany-card-field-state={
                                isRequiredMissing ? "missing" : undefined
                              }
                              data-readany-card-field-width={field.width}
                            >
                              {(field.options ?? []).map((option) => {
                                const isSelected = selectedValues.includes(option.value);
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    disabled={!isEditable}
                                    className={cn(
                                      "rounded-sm px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-default disabled:opacity-70",
                                      isSelected
                                        ? "bg-primary/12 text-primary"
                                        : "bg-muted/45 text-muted-foreground hover:bg-muted",
                                    )}
                                    onClick={() => {
                                      const nextValues = isSelected
                                        ? selectedValues.filter((value) => value !== option.value)
                                        : [...selectedValues, option.value];
                                      updateStructuredData(field.key, nextValues);
                                    }}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                            {helpText}
                            {missingHint}
                          </div>,
                        );
                      }

                      return wrapCardField(
                        <label className={cn("space-y-1", fieldWidthClass)}>
                          {label}
                          <input
                            type={field.type === "number" ? "number" : "text"}
                            defaultValue={getCardFieldInputValue(currentValue)}
                            onBlur={(event) =>
                              field.type === "number"
                                ? updateNumberField(field, event.currentTarget.value)
                                : updateStructuredData(field.key, event.currentTarget.value)
                            }
                            readOnly={!isEditable}
                            aria-invalid={isRequiredMissing || undefined}
                            data-readany-card-field-state={
                              isRequiredMissing ? "missing" : undefined
                            }
                            data-readany-card-field-width={field.width}
                            className={cn(
                              "h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60",
                              isRequiredMissing
                                ? "border-destructive/50 focus:border-destructive/70"
                                : "border-border/55 focus:border-primary/45",
                            )}
                            placeholder={field.placeholder}
                          />
                          {helpText}
                          {missingHint}
                        </label>,
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <label className="space-y-1">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("notes.knowledgeCardData", { defaultValue: "Card data JSON" })}
                </span>
                <textarea
                  value={dataInput}
                  onChange={(event) => {
                    setDataInput(event.target.value);
                    setDataError(null);
                  }}
                  onBlur={applyDataInput}
                  readOnly={!isEditable}
                  rows={4}
                  spellCheck={false}
                  className="min-h-20 w-full resize-y rounded-md border border-border/55 bg-background px-2.5 py-2 font-mono text-[11px] leading-5 text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
                  placeholder='{"key":"value"}'
                />
              </label>
              {dataError ? (
                <p className="text-[11px] leading-4 text-destructive">
                  {t("notes.knowledgeCardDataInvalid", {
                    error: dataError,
                    defaultValue: `Invalid JSON: ${dataError}`,
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

function ReadAnyInternalLinkView({ node, selected }: NodeViewProps) {
  const label =
    String(
      node.attrs.label || node.attrs.title || node.attrs.documentId || node.attrs.targetPath || "",
    ).trim() || "Linked note";
  const target = node.attrs.documentId || node.attrs.targetPath || label;

  return (
    <NodeViewWrapper
      as="span"
      className={cn(
        "not-prose inline-flex max-w-[18rem] translate-y-[2px] items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[0.86em] font-medium",
        selected
          ? "border-primary/45 bg-primary/15 text-primary ring-2 ring-primary/10"
          : "border-primary/20 bg-primary/10 text-primary",
      )}
      contentEditable={false}
      data-readany-internal-link={target}
      title={label}
    >
      <Network className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </NodeViewWrapper>
  );
}

function ReadAnySourceReferenceView({ node, selected }: NodeViewProps) {
  const label =
    String(node.attrs.label || node.attrs.sourceTitle || "").trim() || "Source reference";

  return (
    <NodeViewWrapper
      as="span"
      className={cn(
        "not-prose inline-flex max-w-[18rem] translate-y-[2px] items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[0.86em] font-medium",
        selected
          ? "border-border bg-muted text-foreground ring-2 ring-primary/10"
          : "border-border/60 bg-muted/55 text-muted-foreground",
      )}
      contentEditable={false}
      data-readany-source-reference={node.attrs.cfi || node.attrs.sourceId || label}
      data-readany-source-id={node.attrs.sourceId || undefined}
      title={label}
    >
      <BookOpen className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </NodeViewWrapper>
  );
}

/* --- Toolbar Components --- */

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}

function ToolbarButton({ onClick, isActive, disabled, title, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex items-center justify-center rounded p-1 transition-all duration-150",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
        "disabled:cursor-not-allowed disabled:opacity-30",
        isActive
          ? "bg-primary/12 text-primary shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95",
      )}
    >
      {children}
    </button>
  );
}

function ToolbarGroup({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function ToolbarDivider() {
  return <div className="mx-1 h-4 w-px bg-border/60" />;
}
