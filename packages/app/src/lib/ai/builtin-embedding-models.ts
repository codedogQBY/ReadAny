/**
 * Preset built-in embedding models that run locally via Transformers.js
 * These models are downloaded from HuggingFace and cached in the browser/filesystem.
 */

export interface BuiltinEmbeddingModel {
  id: string;
  /** HuggingFace model ID, e.g. "Xenova/all-MiniLM-L6-v2" */
  hfModelId: string;
  /** Display name */
  name: string;
  /** Approximate download size */
  size: string;
  /** Output embedding dimension */
  dimension: number;
  /** i18n key for description, e.g. "settings.vm_model_desc_miniLM" */
  descriptionKey: string;
  /** i18n key for language hint, e.g. "settings.vm_lang_en" */
  languagesKey: string;
  /** Whether recommended */
  recommended?: boolean;
}

export const BUILTIN_EMBEDDING_MODELS: BuiltinEmbeddingModel[] = [
  {
    id: "all-MiniLM-L6-v2",
    hfModelId: "Xenova/all-MiniLM-L6-v2",
    name: "all-MiniLM-L6-v2",
    size: "~23 MB",
    dimension: 384,
    descriptionKey: "settings.vm_model_desc_miniLM",
    languagesKey: "settings.vm_lang_en",
    recommended: true,
  },
  {
    id: "bge-small-en-v1.5",
    hfModelId: "Xenova/bge-small-en-v1.5",
    name: "BGE Small EN v1.5",
    size: "~33 MB",
    dimension: 384,
    descriptionKey: "settings.vm_model_desc_bgeEn",
    languagesKey: "settings.vm_lang_en",
  },
  {
    id: "bge-small-zh-v1.5",
    hfModelId: "Xenova/bge-small-zh-v1.5",
    name: "BGE Small ZH v1.5",
    size: "~47 MB",
    dimension: 512,
    descriptionKey: "settings.vm_model_desc_bgeZh",
    languagesKey: "settings.vm_lang_zh",
  },
  {
    id: "multilingual-e5-small",
    hfModelId: "Xenova/multilingual-e5-small",
    name: "Multilingual E5 Small",
    size: "~118 MB",
    dimension: 384,
    descriptionKey: "settings.vm_model_desc_e5",
    languagesKey: "settings.vm_lang_multi",
  },
];
