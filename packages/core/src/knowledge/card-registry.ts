import type { JSONValue, KnowledgeCardTemplate } from "../types";

export interface ReadAnyCardAttrs {
  cardType?: string;
  id?: string;
  version?: number;
  title?: string;
  text?: string;
  sourceTitle?: string;
  sourceId?: string;
  cfi?: string;
  markdown?: string;
  data?: unknown;
}

export interface ReadAnyCardMarkdownContext {
  body: string;
  cardTemplates?: KnowledgeCardTemplate[];
}

export interface ReadAnyCardDefinition {
  cardType: string;
  version: number;
  insertLabel: string;
  upgradeAttrs?: (attrs: ReadAnyCardAttrs) => ReadAnyCardAttrs;
  markdownFallback: (attrs: ReadAnyCardAttrs, context: ReadAnyCardMarkdownContext) => string;
}

export type ReadAnyCardReadOnlyState = "supported" | "custom" | "unsupported" | "future";

export interface ReadAnyCardReadOnlyMetadataItem {
  key: "cardType" | "version" | "source" | "sourceId" | "cfi";
  label: string;
  value: string;
}

export interface ReadAnyCardStructuredFieldValue {
  key: string;
  label: string;
  value: string;
  group?: string;
  width?: ReadAnyCardTemplateFieldWidth;
  missing?: boolean;
}

export interface ReadAnyCardReadOnlyModel {
  attrs: ReadAnyCardAttrs;
  cardType: string;
  version: number;
  title: string;
  body: string;
  structuredFields: ReadAnyCardStructuredFieldValue[];
  state: ReadAnyCardReadOnlyState;
  stateLabel?: string;
  insertLabel?: string;
  metadata: ReadAnyCardReadOnlyMetadataItem[];
  sourceTitle?: string;
  sourceId?: string;
  cfi?: string;
  isFallback: boolean;
  isFutureVersion: boolean;
  isCustomCard: boolean;
  isKnownBuiltIn: boolean;
}

export interface CreateReadAnyCardReadOnlyModelOptions extends ReadAnyCardMarkdownContext {
  cardTemplates?: KnowledgeCardTemplate[];
  fallbackTitle?: string;
}

export interface ReadAnyCardTemplateSchema {
  cardType?: string;
  title?: string;
  insertLabel?: string;
  description?: string;
  markdown?: string;
  text?: string;
  sourceTitle?: string;
  sourceId?: string;
  cfi?: string;
  fields?: ReadAnyCardTemplateField[];
  groups?: ReadAnyCardTemplateFieldGroup[];
  attrs?: Record<string, unknown>;
  migrations?: ReadAnyCardTemplateMigration[];
}

export type ReadAnyCardTemplateFieldType =
  | "text"
  | "multiline"
  | "number"
  | "checkbox"
  | "select"
  | "multiselect";

export type ReadAnyCardTemplateFieldWidth = "full" | "half" | "third";

export interface ReadAnyCardTemplateFieldOption {
  value: string;
  label: string;
}

export type ReadAnyCardTemplateFieldConditionOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "empty"
  | "notEmpty";

export interface ReadAnyCardTemplateFieldVisibleWhen {
  fieldKey: string;
  operator: ReadAnyCardTemplateFieldConditionOperator;
  value?: JSONValue;
}

export interface ReadAnyCardTemplateFieldGroup {
  key: string;
  label: string;
  visibleWhen?: ReadAnyCardTemplateFieldVisibleWhen;
}

export interface ReadAnyCardTemplateField {
  key: string;
  label: string;
  type: ReadAnyCardTemplateFieldType;
  group?: string;
  width?: ReadAnyCardTemplateFieldWidth;
  groupVisibleWhen?: ReadAnyCardTemplateFieldVisibleWhen;
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  options?: ReadAnyCardTemplateFieldOption[];
  visibleWhen?: ReadAnyCardTemplateFieldVisibleWhen;
  defaultValue?: JSONValue;
}

export interface ReadAnyCardTemplateMigration {
  fromVersion?: number;
  toVersion?: number;
  dataRenames?: Record<string, string>;
  dataDefaults?: Record<string, unknown>;
  removeData?: string[];
}

export interface CreateCustomReadAnyCardTemplateInput {
  id: string;
  name: string;
  description?: string;
  markdown?: string;
  fields?: ReadAnyCardTemplateField[];
  now?: number;
}

export interface UpdateCustomReadAnyCardTemplateInput {
  template: KnowledgeCardTemplate;
  name: string;
  description?: string;
  markdown?: string;
  fields?: ReadAnyCardTemplateField[];
  now?: number;
}

export type ReadAnyCardDataParseResult =
  | { ok: true; data: JSONValue | null }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JSONValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value !== "number" || Number.isFinite(value);
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

export function formatReadAnyCardDataForEditor(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (!isJsonValue(value)) return "";
  return JSON.stringify(value, null, 2);
}

export function parseReadAnyCardDataFromEditor(input: string): ReadAnyCardDataParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, data: null };

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isJsonValue(parsed)) {
      return { ok: false, error: "Card data must be valid JSON without NaN or Infinity." };
    }
    return { ok: true, data: parsed };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}

function stringAttr(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  return stringAttr(record[key]);
}

function numberAttr(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stringAttr(value);
    if (text) return text;
  }
  return undefined;
}

const READANY_CARD_TEMPLATE_FIELD_TYPES = new Set<ReadAnyCardTemplateFieldType>([
  "text",
  "multiline",
  "number",
  "checkbox",
  "select",
  "multiselect",
]);

const READANY_CARD_TEMPLATE_FIELD_WIDTHS = new Set<ReadAnyCardTemplateFieldWidth>([
  "full",
  "half",
  "third",
]);

const READANY_CARD_TEMPLATE_FIELD_CONDITION_OPERATORS =
  new Set<ReadAnyCardTemplateFieldConditionOperator>([
    "equals",
    "notEquals",
    "contains",
    "notContains",
    "empty",
    "notEmpty",
  ]);

function normalizeTemplateFieldType(value: unknown): ReadAnyCardTemplateFieldType {
  return typeof value === "string" &&
    READANY_CARD_TEMPLATE_FIELD_TYPES.has(value as ReadAnyCardTemplateFieldType)
    ? (value as ReadAnyCardTemplateFieldType)
    : "text";
}

function normalizeTemplateFieldWidth(value: unknown): ReadAnyCardTemplateFieldWidth | undefined {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (READANY_CARD_TEMPLATE_FIELD_WIDTHS.has(normalized as ReadAnyCardTemplateFieldWidth)) {
      return normalized as ReadAnyCardTemplateFieldWidth;
    }
    if (["wide", "block", "12", "100", "1/1"].includes(normalized)) return "full";
    if (["medium", "6", "50", "1/2", "2"].includes(normalized)) return "half";
    if (["compact", "4", "33", "1/3", "3"].includes(normalized)) return "third";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 10 || value === 1) return "full";
    if (value === 6 || value === 2) return "half";
    if (value === 4 || value === 3) return "third";
  }

  return undefined;
}

function normalizeTemplateFieldKey(input: string, fallback: string): string {
  const source = input.trim() || fallback;
  const normalized = source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-\s]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function normalizeTemplateFieldOptionValue(input: unknown, fallback: string): string {
  const text =
    typeof input === "string" || typeof input === "number" || typeof input === "boolean"
      ? String(input).trim()
      : "";
  return text || fallback;
}

function normalizeReadAnyCardTemplateFieldOptions(
  options: unknown,
): ReadAnyCardTemplateFieldOption[] {
  if (!Array.isArray(options)) return [];

  const usedValues = new Set<string>();
  const normalizedOptions: ReadAnyCardTemplateFieldOption[] = [];
  for (const [index, rawOption] of options.entries()) {
    const fallbackValue = `option_${index + 1}`;
    const label = isRecord(rawOption)
      ? (firstString(rawOption.label, rawOption.value) ?? `Option ${index + 1}`)
      : normalizeTemplateFieldOptionValue(rawOption, `Option ${index + 1}`);
    const baseValue = normalizeTemplateFieldOptionValue(
      isRecord(rawOption) ? (rawOption.value ?? rawOption.label) : rawOption,
      fallbackValue,
    );
    let value = baseValue;
    let suffix = 2;
    while (usedValues.has(value)) {
      value = `${baseValue}_${suffix}`;
      suffix += 1;
    }
    usedValues.add(value);
    normalizedOptions.push({ value, label });
  }

  return normalizedOptions.slice(0, 24);
}

function getTemplateFieldOptionValue(
  options: ReadAnyCardTemplateFieldOption[],
  value: unknown,
): string | undefined {
  const text = normalizeTemplateFieldOptionValue(value, "");
  if (!text) return undefined;
  if (options.length === 0) return text;
  return options.find((option) => option.value === text || option.label === text)?.value;
}

function normalizeTemplateFieldConditionOperator(
  value: unknown,
): ReadAnyCardTemplateFieldConditionOperator {
  return typeof value === "string" &&
    READANY_CARD_TEMPLATE_FIELD_CONDITION_OPERATORS.has(
      value as ReadAnyCardTemplateFieldConditionOperator,
    )
    ? (value as ReadAnyCardTemplateFieldConditionOperator)
    : "equals";
}

function normalizeTemplateFieldConditionValue(value: unknown): JSONValue | undefined {
  if (value === undefined) return undefined;
  if (isJsonValue(value)) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  return undefined;
}

function normalizeReadAnyCardTemplateFieldVisibleWhen(
  value: unknown,
  fieldKey?: string,
): ReadAnyCardTemplateFieldVisibleWhen | undefined {
  if (!isRecord(value)) return undefined;
  const rawFieldKey = firstString(value.fieldKey, value.key, value.field);
  if (!rawFieldKey) return undefined;

  const normalizedFieldKey = normalizeTemplateFieldKey(rawFieldKey, "");
  if (!normalizedFieldKey || (fieldKey && normalizedFieldKey === fieldKey)) return undefined;

  const operator = normalizeTemplateFieldConditionOperator(value.operator);
  const condition: ReadAnyCardTemplateFieldVisibleWhen = {
    fieldKey: normalizedFieldKey,
    operator,
  };
  if (operator !== "empty" && operator !== "notEmpty") {
    const conditionValue = normalizeTemplateFieldConditionValue(value.value);
    if (conditionValue !== undefined) condition.value = conditionValue;
  }
  return condition;
}

function normalizeTemplateFieldDefaultValue(
  type: ReadAnyCardTemplateFieldType,
  value: unknown,
  options: ReadAnyCardTemplateFieldOption[] = [],
): JSONValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (type === "checkbox") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      if (text === "true") return true;
      if (text === "false") return false;
    }
    return undefined;
  }

  if (type === "select") {
    const optionValue = getTemplateFieldOptionValue(options, value);
    return optionValue ?? undefined;
  }

  if (type === "multiselect") {
    const values = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[,\n]/)
        : [];
    const selectedValues = values
      .map((item) => getTemplateFieldOptionValue(options, item))
      .filter((item): item is string => !!item);
    return [...new Set(selectedValues)];
  }

  if (type === "number") {
    const numberValue = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

export function normalizeReadAnyCardTemplateFields(fields: unknown): ReadAnyCardTemplateField[] {
  if (!Array.isArray(fields)) return [];

  const usedKeys = new Set<string>();
  const normalizedFields: ReadAnyCardTemplateField[] = [];
  for (const [index, rawField] of fields.entries()) {
    if (!isRecord(rawField)) continue;

    const type = normalizeTemplateFieldType(rawField.type);
    const label = firstString(rawField.label, rawField.key) ?? `Field ${index + 1}`;
    const baseKey = normalizeTemplateFieldKey(
      firstString(rawField.key, rawField.label) ?? "",
      `field_${index + 1}`,
    );
    let key = baseKey;
    let suffix = 2;
    while (usedKeys.has(key)) {
      key = `${baseKey}_${suffix}`;
      suffix += 1;
    }
    usedKeys.add(key);

    const field: ReadAnyCardTemplateField = {
      key,
      label,
      type,
    };
    const group = firstString(rawField.group, rawField.section, rawField.groupLabel);
    if (group) field.group = group.trim();
    const layout = isRecord(rawField.layout) ? rawField.layout : undefined;
    const width = normalizeTemplateFieldWidth(
      rawField.width ?? layout?.width ?? rawField.span ?? rawField.columns,
    );
    if (width) field.width = width;
    const placeholder = stringAttr(rawField.placeholder);
    if (placeholder) field.placeholder = placeholder;
    const helpText = firstString(rawField.helpText, rawField.description);
    if (helpText) field.helpText = helpText;
    if (rawField.required === true) field.required = true;
    const options = normalizeReadAnyCardTemplateFieldOptions(rawField.options);
    if ((type === "select" || type === "multiselect") && options.length > 0) {
      field.options = options;
    }
    const visibleWhen = normalizeReadAnyCardTemplateFieldVisibleWhen(rawField.visibleWhen, key);
    if (visibleWhen) field.visibleWhen = visibleWhen;
    const groupVisibleWhen = normalizeReadAnyCardTemplateFieldVisibleWhen(
      rawField.groupVisibleWhen ?? rawField.groupCondition ?? rawField.sectionVisibleWhen,
    );
    if (field.group && groupVisibleWhen) field.groupVisibleWhen = groupVisibleWhen;
    const defaultValue = normalizeTemplateFieldDefaultValue(type, rawField.defaultValue, options);
    if (defaultValue !== undefined && isJsonValue(defaultValue)) {
      field.defaultValue = defaultValue;
    }
    normalizedFields.push(field);
  }

  return normalizedFields.slice(0, 12);
}

function templateFieldGroupKey(label: string): string {
  return normalizeTemplateFieldKey(label, "group");
}

function normalizeReadAnyCardTemplateFieldGroups(
  groups: unknown,
  fields: ReadAnyCardTemplateField[] = [],
): ReadAnyCardTemplateFieldGroup[] {
  const normalizedGroups: ReadAnyCardTemplateFieldGroup[] = [];
  const indexByKey = new Map<string, number>();
  const indexByLabelKey = new Map<string, number>();

  const upsertGroup = (
    label: string,
    key: string,
    visibleWhen?: ReadAnyCardTemplateFieldVisibleWhen,
  ) => {
    const normalizedLabel = label.trim();
    if (!normalizedLabel) return;
    const labelKey = templateFieldGroupKey(normalizedLabel);
    const normalizedKey = normalizeTemplateFieldKey(key, templateFieldGroupKey(normalizedLabel));
    const existingIndex = indexByKey.get(normalizedKey) ?? indexByLabelKey.get(labelKey);
    if (existingIndex !== undefined) {
      const existing = normalizedGroups[existingIndex];
      normalizedGroups[existingIndex] = {
        ...existing,
        label: existing.label || normalizedLabel,
        ...(visibleWhen ? { visibleWhen } : {}),
      };
      indexByKey.set(normalizedKey, existingIndex);
      indexByLabelKey.set(labelKey, existingIndex);
      return;
    }
    indexByKey.set(normalizedKey, normalizedGroups.length);
    indexByLabelKey.set(labelKey, normalizedGroups.length);
    normalizedGroups.push({
      key: normalizedKey,
      label: normalizedLabel,
      ...(visibleWhen ? { visibleWhen } : {}),
    });
  };

  for (const field of fields) {
    const label = field.group?.trim();
    if (!label) continue;
    upsertGroup(label, templateFieldGroupKey(label), field.groupVisibleWhen);
  }

  if (Array.isArray(groups)) {
    for (const [index, rawGroup] of groups.entries()) {
      if (!isRecord(rawGroup)) continue;
      const label =
        firstString(rawGroup.label, rawGroup.title, rawGroup.name, rawGroup.group) ??
        `Group ${index + 1}`;
      const key = firstString(rawGroup.key, rawGroup.id, rawGroup.name, rawGroup.group) ?? label;
      const visibleWhen = normalizeReadAnyCardTemplateFieldVisibleWhen(
        rawGroup.visibleWhen ?? rawGroup.condition,
      );
      upsertGroup(label, key, visibleWhen);
    }
  }

  return normalizedGroups.slice(0, 12);
}

function createReadAnyCardTemplateFieldGroups(
  fields: ReadAnyCardTemplateField[],
): ReadAnyCardTemplateFieldGroup[] {
  return normalizeReadAnyCardTemplateFieldGroups(undefined, fields).filter(
    (group) => !!group.visibleWhen,
  );
}

function stripTemplateFieldGroupVisibility(
  fields: ReadAnyCardTemplateField[],
): ReadAnyCardTemplateField[] {
  return fields.map(({ groupVisibleWhen: _groupVisibleWhen, ...field }) => field);
}

function attachTemplateFieldGroupVisibility(
  fields: ReadAnyCardTemplateField[],
  groups: ReadAnyCardTemplateFieldGroup[],
): ReadAnyCardTemplateField[] {
  if (groups.length === 0) return fields;
  const groupsByKey = new Map<string, ReadAnyCardTemplateFieldGroup>();
  for (const group of groups) {
    groupsByKey.set(group.key, group);
    groupsByKey.set(templateFieldGroupKey(group.label), group);
  }
  return fields.map((field) => {
    const groupLabel = field.group?.trim();
    if (!groupLabel) return field;
    const group = groupsByKey.get(templateFieldGroupKey(groupLabel));
    if (!group?.visibleWhen) return field;
    return { ...field, groupVisibleWhen: group.visibleWhen };
  });
}

export function createReadAnyCardTemplateFieldDefaults(
  fields: unknown,
): Record<string, JSONValue> | undefined {
  const normalizedFields = normalizeReadAnyCardTemplateFields(fields);
  const defaults = Object.fromEntries(
    normalizedFields
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue as JSONValue]),
  );
  return Object.keys(defaults).length > 0 ? defaults : undefined;
}

function templateSchema(template: KnowledgeCardTemplate): ReadAnyCardTemplateSchema {
  return isRecord(template.schemaJson) ? (template.schemaJson as ReadAnyCardTemplateSchema) : {};
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function callout(kind: string, title: string, body: string, footer?: string): string {
  const lines = [`> [!${kind}] ${title}`];
  if (body) lines.push(prefixLines(body, "> "));
  if (footer) lines.push(`> ${footer}`);
  return lines.join("\n");
}

function unsupportedCardFooter(attrs: ReadAnyCardAttrs): string {
  const version = attrs.version ? `v${attrs.version}` : "v1";
  const source = attrs.sourceTitle || attrs.sourceId;
  return [
    `ReadAny card: ${attrs.cardType || "custom"} ${version}`,
    source ? `Source: ${source}` : undefined,
    attrs.cfi ? `CFI: ${attrs.cfi}` : undefined,
  ]
    .filter(Boolean)
    .join("\n> ");
}

function unsupportedCardCallout(attrs: ReadAnyCardAttrs, body: string): string {
  return callout(
    "note",
    cardTitle(attrs, attrs.cardType || "ReadAny card"),
    body,
    unsupportedCardFooter(attrs),
  );
}

function cardTitle(attrs: ReadAnyCardAttrs, fallback: string): string {
  return attrs.title || attrs.sourceTitle || fallback;
}

function bodyFromAttrs(attrs: ReadAnyCardAttrs, context: ReadAnyCardMarkdownContext): string {
  return attrs.markdown || attrs.text || context.body;
}

function normalizeReadAnyCardAttrsBase(
  input: ReadAnyCardAttrs | Record<string, unknown> | null | undefined,
): ReadAnyCardAttrs {
  const raw = isRecord(input) ? input : {};
  const cardType = stringField(raw, "cardType") ?? stringField(raw, "type") ?? "custom";
  const definition = getReadAnyCardDefinition(cardType);
  const version = numberAttr(raw.version) ?? definition?.version ?? 1;
  const attrs: ReadAnyCardAttrs = { cardType, version };

  const id = stringField(raw, "id");
  const title = stringField(raw, "title");
  const text = firstString(raw.text, raw.body, raw.content, raw.quote, raw.summary);
  const data = isRecord(raw.data) ? raw.data : {};
  const sourceTitle = firstString(
    raw.sourceTitle,
    raw["source-title"],
    raw.sourceLabel,
    raw.chapterTitle,
    raw.chapter,
    data.sourceTitle,
    data.chapterTitle,
  );
  const sourceId = firstString(
    raw.sourceId,
    raw.source,
    raw.highlightId,
    raw.documentId,
    data.sourceId,
    data.highlightId,
    data.documentId,
  );
  const cfi = firstString(raw.cfi, raw.rangeCfi, data.cfi, data.rangeCfi);

  if (id) attrs.id = id;
  if (title) attrs.title = title;
  if (typeof raw.markdown === "string") attrs.markdown = raw.markdown;
  else if (text) attrs.markdown = text;
  if (text) attrs.text = text;
  if (sourceTitle) attrs.sourceTitle = sourceTitle;
  if (sourceId) attrs.sourceId = sourceId;
  if (cfi) attrs.cfi = cfi;
  if ("data" in raw) attrs.data = raw.data;

  return attrs;
}

function withCurrentVersion(attrs: ReadAnyCardAttrs): ReadAnyCardAttrs {
  const definition = getReadAnyCardDefinition(attrs.cardType || "custom");
  if (!definition) return attrs;
  const version = attrs.version ?? definition.version;
  if (version >= definition.version) return attrs;
  return { ...attrs, version: definition.version };
}

function dataRecord(attrs: ReadAnyCardAttrs): Record<string, unknown> {
  return isRecord(attrs.data) ? attrs.data : {};
}

function mergeRecordDefaults(defaults: unknown, value: unknown): unknown {
  if (!isRecord(defaults)) return value === undefined ? defaults : value;
  if (!isRecord(value)) return value === undefined ? { ...defaults } : value;

  const merged: Record<string, unknown> = { ...defaults };
  for (const [key, nextValue] of Object.entries(value)) {
    const defaultValue = defaults[key];
    merged[key] =
      isRecord(defaultValue) && isRecord(nextValue)
        ? mergeRecordDefaults(defaultValue, nextValue)
        : nextValue;
  }
  return merged;
}

function dataPathSegments(path: string): string[] {
  return path
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function hasRecordPath(record: Record<string, unknown>, path: string): boolean {
  const segments = dataPathSegments(path);
  if (segments.length === 0) return false;

  let current: unknown = record;
  for (let index = 0; index < segments.length; index += 1) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segments[index])) {
      return false;
    }
    if (index === segments.length - 1) return true;
    current = current[segments[index]];
  }
  return false;
}

function getRecordPath(record: Record<string, unknown>, path: string): unknown {
  const segments = dataPathSegments(path);
  let current: unknown = record;
  for (const segment of segments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function setRecordPath(record: Record<string, unknown>, path: string, value: unknown) {
  const segments = dataPathSegments(path);
  if (segments.length === 0) return;

  let current: Record<string, unknown> = record;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const next = current[segment];
    if (!isRecord(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]] = value;
}

function deleteRecordPath(record: Record<string, unknown>, path: string) {
  const segments = dataPathSegments(path);
  if (segments.length === 0) return;

  let current: unknown = record;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (!isRecord(current)) return;
    current = current[segments[index]];
  }
  if (isRecord(current)) {
    delete current[segments[segments.length - 1]];
  }
}

function cloneJsonLike<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJsonLike(item)) as T;
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneJsonLike(item)]),
  ) as T;
}

function templateMigrations(template: KnowledgeCardTemplate): ReadAnyCardTemplateMigration[] {
  const migrations = templateSchema(template).migrations;
  if (!Array.isArray(migrations)) return [];
  return migrations
    .filter((migration): migration is ReadAnyCardTemplateMigration => isRecord(migration))
    .map((migration) => ({
      fromVersion: numberAttr(migration.fromVersion),
      toVersion: numberAttr(migration.toVersion),
      dataRenames: isRecord(migration.dataRenames)
        ? Object.fromEntries(
            Object.entries(migration.dataRenames)
              .map(([fromPath, toPath]) => [fromPath.trim(), String(toPath).trim()])
              .filter(([fromPath, toPath]) => fromPath && toPath),
          )
        : undefined,
      dataDefaults: isRecord(migration.dataDefaults) ? migration.dataDefaults : undefined,
      removeData: Array.isArray(migration.removeData)
        ? migration.removeData.map((item) => String(item).trim()).filter(Boolean)
        : undefined,
    }))
    .filter((migration) => !!migration.toVersion)
    .sort((left, right) => (left.toVersion ?? 0) - (right.toVersion ?? 0));
}

function applyTemplateMigrationData(
  data: unknown,
  migration: ReadAnyCardTemplateMigration,
): unknown {
  if (!isRecord(data)) {
    return data === undefined && migration.dataDefaults
      ? cloneJsonLike(migration.dataDefaults)
      : data;
  }
  let nextData = cloneJsonLike(data);

  if (migration.dataRenames) {
    for (const [fromPath, toPath] of Object.entries(migration.dataRenames)) {
      if (!fromPath || !toPath || !hasRecordPath(nextData, fromPath)) continue;
      const value = getRecordPath(nextData, fromPath);
      if (!hasRecordPath(nextData, toPath)) {
        setRecordPath(nextData, toPath, cloneJsonLike(value));
      }
      deleteRecordPath(nextData, fromPath);
    }
  }

  if (migration.dataDefaults) {
    nextData = mergeRecordDefaults(migration.dataDefaults, nextData) as Record<string, unknown>;
  }

  if (migration.removeData) {
    for (const path of migration.removeData) {
      deleteRecordPath(nextData, path);
    }
  }

  return nextData;
}

function applyTemplateMigrations(
  attrs: ReadAnyCardAttrs,
  template: KnowledgeCardTemplate,
): ReadAnyCardAttrs {
  const migrations = templateMigrations(template);
  if (migrations.length === 0) return attrs;

  let nextAttrs = { ...attrs };
  let workingVersion = numberAttr(nextAttrs.version) ?? 1;
  const targetVersion = Math.max(numberAttr(template.version) ?? 1, workingVersion);

  for (const migration of migrations) {
    const toVersion = migration.toVersion ?? 0;
    const fromVersion = migration.fromVersion ?? 0;
    if (toVersion <= workingVersion || toVersion > targetVersion) continue;
    if (fromVersion > 0 && workingVersion < fromVersion) continue;

    nextAttrs = {
      ...nextAttrs,
      data: applyTemplateMigrationData(nextAttrs.data, migration),
      version: toVersion,
    };
    workingVersion = toVersion;
  }

  return nextAttrs;
}

function createTemplateFieldRenameMap(
  previousFields: ReadAnyCardTemplateField[],
  nextFields: ReadAnyCardTemplateField[],
): Record<string, string> | undefined {
  const renames: Record<string, string> = {};
  const count = Math.min(previousFields.length, nextFields.length);

  for (let index = 0; index < count; index += 1) {
    const previousField = previousFields[index];
    const nextField = nextFields[index];
    if (
      previousField.key &&
      nextField.key &&
      previousField.key !== nextField.key &&
      previousField.type === nextField.type
    ) {
      renames[previousField.key] = nextField.key;
    }
  }

  return Object.keys(renames).length > 0 ? renames : undefined;
}

function rewriteTemplateFieldConditions(
  fields: ReadAnyCardTemplateField[],
  fieldRenames: Record<string, string> | undefined,
): ReadAnyCardTemplateField[] {
  if (!fieldRenames) return fields;
  return fields.map((field) => {
    const visibleWhen = field.visibleWhen;
    const nextFieldKey = visibleWhen ? fieldRenames[visibleWhen.fieldKey] : undefined;
    const groupVisibleWhen = field.groupVisibleWhen;
    const nextGroupFieldKey = groupVisibleWhen
      ? fieldRenames[groupVisibleWhen.fieldKey]
      : undefined;
    return {
      ...field,
      ...(visibleWhen && nextFieldKey
        ? { visibleWhen: { ...visibleWhen, fieldKey: nextFieldKey } }
        : {}),
      ...(groupVisibleWhen && nextGroupFieldKey
        ? { groupVisibleWhen: { ...groupVisibleWhen, fieldKey: nextGroupFieldKey } }
        : {}),
    };
  });
}

function createTemplateFieldRenameMigration(
  fieldRenames: Record<string, string> | undefined,
  fromVersion: number,
  toVersion: number,
): ReadAnyCardTemplateMigration | undefined {
  if (!fieldRenames) return undefined;
  return {
    fromVersion,
    toVersion,
    dataRenames: fieldRenames,
  };
}

function customTemplateCardType(template: KnowledgeCardTemplate): string {
  const schema = templateSchema(template);
  return stringAttr(schema.cardType) ?? (template.builtIn ? template.id : `custom:${template.id}`);
}

function findTemplateForCardType(
  cardType: string | undefined,
  templates: KnowledgeCardTemplate[] | undefined,
): KnowledgeCardTemplate | undefined {
  if (!cardType || !templates?.length) return undefined;
  return templates.find(
    (template) => !template.builtIn && customTemplateCardType(template) === cardType,
  );
}

function ensureMarkdown(attrs: ReadAnyCardAttrs, markdown: string | undefined): ReadAnyCardAttrs {
  if (!markdown || attrs.markdown || attrs.text) return attrs;
  return { ...attrs, markdown, text: markdown };
}

function upgradeBookQuoteAttrs(attrs: ReadAnyCardAttrs): ReadAnyCardAttrs {
  const data = dataRecord(attrs);
  return ensureMarkdown(
    {
      ...attrs,
      sourceTitle: attrs.sourceTitle ?? firstString(data.sourceTitle, data.chapterTitle),
      sourceId: attrs.sourceId ?? firstString(data.sourceId, data.highlightId),
      cfi: attrs.cfi ?? firstString(data.cfi, data.rangeCfi),
    },
    firstString(data.quote, data.text, data.markdown),
  );
}

function upgradeAiSummaryAttrs(attrs: ReadAnyCardAttrs): ReadAnyCardAttrs {
  const data = dataRecord(attrs);
  return ensureMarkdown(attrs, firstString(data.summary, data.text, data.markdown));
}

function upgradeAiToolFailureAttrs(attrs: ReadAnyCardAttrs): ReadAnyCardAttrs {
  const data = dataRecord(attrs);
  const toolName = firstString(data.toolName, data.tool, data.name);
  const status = firstString(data.status);
  const error = firstString(data.error, data.message);
  const reason = firstString(data.reason);
  const documentId = firstString(data.documentId, data.fromDocumentId);
  const lines = [
    toolName ? `Tool: ${toolName}` : undefined,
    status ? `Status: ${status}` : undefined,
    error ? `Error: ${error}` : undefined,
    reason ? `Reason: ${reason}` : undefined,
    documentId ? `Document: ${documentId}` : undefined,
  ].filter(Boolean);

  return ensureMarkdown(
    {
      ...attrs,
      title: attrs.title ?? toolName ?? "AI/tool failure",
      sourceId: attrs.sourceId ?? documentId,
    },
    firstString(data.markdown, data.text) ?? lines.join("\n"),
  );
}

function upgradeQaAttrs(attrs: ReadAnyCardAttrs): ReadAnyCardAttrs {
  const data = dataRecord(attrs);
  const question = firstString(data.question, data.q);
  const answer = firstString(data.answer, data.a);
  if (!question && !answer) return attrs;
  return ensureMarkdown(attrs, [`Q: ${question ?? ""}`, `A: ${answer ?? ""}`].join("\n"));
}

function upgradeDiagramAttrs(attrs: ReadAnyCardAttrs): ReadAnyCardAttrs {
  const data = dataRecord(attrs);
  return ensureMarkdown(attrs, firstString(data.markdown, data.diagram, data.text));
}

function upgradeRelatedNotesAttrs(attrs: ReadAnyCardAttrs): ReadAnyCardAttrs {
  const data = dataRecord(attrs);
  if (attrs.markdown || attrs.text || !Array.isArray(data.notes)) return attrs;
  const lines = data.notes
    .map((note) => {
      if (typeof note === "string") return note.trim();
      if (!isRecord(note)) return "";
      return firstString(note.title, note.label, note.id) ?? "";
    })
    .filter(Boolean)
    .map((note) => `- [[${note}]]`);
  return ensureMarkdown(attrs, lines.join("\n"));
}

export function upgradeReadAnyCardAttrs(
  input: ReadAnyCardAttrs | Record<string, unknown> | null | undefined,
): ReadAnyCardAttrs {
  const attrs = normalizeReadAnyCardAttrsBase(input);
  const definition = getReadAnyCardDefinition(attrs.cardType || "custom");
  const upgraded = definition?.upgradeAttrs ? definition.upgradeAttrs(attrs) : attrs;
  return withCurrentVersion(normalizeReadAnyCardAttrsBase(upgraded));
}

export function normalizeReadAnyCardAttrs(
  input: ReadAnyCardAttrs | Record<string, unknown> | null | undefined,
): ReadAnyCardAttrs {
  return upgradeReadAnyCardAttrs(input);
}

export function upgradeReadAnyCardAttrsWithTemplates(
  input: ReadAnyCardAttrs | Record<string, unknown> | null | undefined,
  templates: KnowledgeCardTemplate[] | undefined,
): ReadAnyCardAttrs {
  const attrs = upgradeReadAnyCardAttrs(input);
  const template = findTemplateForCardType(attrs.cardType, templates);
  if (!template) return attrs;

  const migratedAttrs = applyTemplateMigrations(attrs, template);
  const defaults = createReadAnyCardAttrsFromTemplate(template);
  const version = Math.max(
    numberAttr(migratedAttrs.version) ?? 1,
    numberAttr(defaults.version) ?? 1,
  );
  const mergedData =
    defaults.data === undefined && migratedAttrs.data === undefined
      ? undefined
      : mergeRecordDefaults(defaults.data, migratedAttrs.data);
  const mergedAttrs: ReadAnyCardAttrs = {
    ...defaults,
    ...migratedAttrs,
    version,
    title: migratedAttrs.title ?? defaults.title,
    markdown: migratedAttrs.markdown ?? migratedAttrs.text ?? defaults.markdown,
    text: migratedAttrs.text ?? migratedAttrs.markdown ?? defaults.text,
    sourceTitle: migratedAttrs.sourceTitle ?? defaults.sourceTitle,
    sourceId: migratedAttrs.sourceId ?? defaults.sourceId,
    cfi: migratedAttrs.cfi ?? defaults.cfi,
  };
  if (mergedData !== undefined) mergedAttrs.data = mergedData;

  return normalizeReadAnyCardAttrs(mergedAttrs);
}

export const builtInReadAnyCards: ReadAnyCardDefinition[] = [
  {
    cardType: "bookQuote",
    version: 1,
    insertLabel: "Quote",
    upgradeAttrs: upgradeBookQuoteAttrs,
    markdownFallback: (attrs, context) =>
      callout(
        "quote",
        cardTitle(attrs, "Quote"),
        bodyFromAttrs(attrs, context),
        attrs.sourceTitle ? `Source: ${attrs.sourceTitle}` : undefined,
      ),
  },
  {
    cardType: "callout",
    version: 1,
    insertLabel: "Callout",
    markdownFallback: (attrs, context) =>
      callout("note", cardTitle(attrs, "Note"), bodyFromAttrs(attrs, context)),
  },
  {
    cardType: "bookMetadata",
    version: 1,
    insertLabel: "Book metadata",
    markdownFallback: (attrs, context) =>
      callout("info", cardTitle(attrs, "Book metadata"), bodyFromAttrs(attrs, context)),
  },
  {
    cardType: "aiSummary",
    version: 1,
    insertLabel: "AI summary",
    upgradeAttrs: upgradeAiSummaryAttrs,
    markdownFallback: (attrs, context) =>
      callout("summary", cardTitle(attrs, "AI summary"), bodyFromAttrs(attrs, context)),
  },
  {
    cardType: "aiToolFailure",
    version: 1,
    insertLabel: "AI/tool failure",
    upgradeAttrs: upgradeAiToolFailureAttrs,
    markdownFallback: (attrs, context) =>
      callout("failure", cardTitle(attrs, "AI/tool failure"), bodyFromAttrs(attrs, context)),
  },
  {
    cardType: "qa",
    version: 1,
    insertLabel: "Q&A",
    upgradeAttrs: upgradeQaAttrs,
    markdownFallback: (attrs, context) =>
      callout("question", cardTitle(attrs, "Question"), bodyFromAttrs(attrs, context)),
  },
  {
    cardType: "review",
    version: 1,
    insertLabel: "Review",
    markdownFallback: (attrs, context) =>
      callout("tip", cardTitle(attrs, "Review"), bodyFromAttrs(attrs, context)),
  },
  {
    cardType: "mindmap",
    version: 1,
    insertLabel: "Mindmap",
    upgradeAttrs: upgradeDiagramAttrs,
    markdownFallback: (attrs, context) => {
      const body = bodyFromAttrs(attrs, context);
      return [`> [!abstract] ${cardTitle(attrs, "Mindmap")}`, "", "```markmap", body, "```"]
        .filter(Boolean)
        .join("\n");
    },
  },
  {
    cardType: "mermaid",
    version: 1,
    insertLabel: "Mermaid",
    upgradeAttrs: upgradeDiagramAttrs,
    markdownFallback: (attrs, context) => {
      const body = bodyFromAttrs(attrs, context);
      return [`> [!abstract] ${cardTitle(attrs, "Diagram")}`, "", "```mermaid", body, "```"]
        .filter(Boolean)
        .join("\n");
    },
  },
  {
    cardType: "relatedNotes",
    version: 1,
    insertLabel: "Related notes",
    upgradeAttrs: upgradeRelatedNotesAttrs,
    markdownFallback: (attrs, context) =>
      callout("link", cardTitle(attrs, "Related notes"), bodyFromAttrs(attrs, context)),
  },
];

const builtInCardMap = new Map(
  builtInReadAnyCards.map((definition) => [definition.cardType, definition]),
);

export function getReadAnyCardDefinition(cardType: string): ReadAnyCardDefinition | undefined {
  return builtInCardMap.get(cardType);
}

export function createDefaultReadAnyCardAttrs(
  cardType: string,
  options: { title?: string; version?: number } = {},
): ReadAnyCardAttrs {
  const definition = getReadAnyCardDefinition(cardType);
  const version = options.version ?? definition?.version ?? 1;
  const title = options.title ?? definition?.insertLabel ?? cardType;

  if (cardType === "mermaid") {
    return {
      cardType,
      version,
      title,
      markdown: "graph TD\n  A[Idea] --> B[Note]",
    };
  }

  if (cardType === "mindmap") {
    return {
      cardType,
      version,
      title,
      markdown: "# Topic\n## Branch",
    };
  }

  if (cardType === "qa") {
    return {
      cardType,
      version,
      title,
      markdown: "Q:\nA:",
    };
  }

  if (cardType === "aiToolFailure") {
    return {
      cardType,
      version,
      title,
      markdown: "Tool:\nError:\nReason:",
    };
  }

  return {
    cardType,
    version,
    title,
    markdown: "",
  };
}

export function createCustomReadAnyCardTemplate({
  id,
  name,
  description,
  markdown,
  fields,
  now = Date.now(),
}: CreateCustomReadAnyCardTemplateInput): KnowledgeCardTemplate {
  const trimmedName = name.trim();
  const title = trimmedName || "Custom card";
  const normalizedFields = normalizeReadAnyCardTemplateFields(fields);
  const fieldGroups = createReadAnyCardTemplateFieldGroups(normalizedFields);
  const schemaFields = stripTemplateFieldGroupVisibility(normalizedFields);
  const schemaJson: Record<string, JSONValue> = {
    cardType: `custom:${id}`,
    insertLabel: title,
    title,
    markdown: markdown?.trim() ?? "",
  };
  const trimmedDescription = description?.trim();
  if (trimmedDescription) schemaJson.description = trimmedDescription;
  if (schemaFields.length > 0) {
    schemaJson.fields = schemaFields as unknown as JSONValue;
    if (fieldGroups.length > 0) schemaJson.groups = fieldGroups as unknown as JSONValue;
    const defaults = createReadAnyCardTemplateFieldDefaults(schemaFields);
    if (defaults) {
      schemaJson.attrs = { data: defaults };
    }
  }

  return {
    id,
    name: title,
    version: 1,
    schemaJson,
    builtIn: false,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateCustomReadAnyCardTemplate({
  template,
  name,
  description,
  markdown,
  fields,
  now = Date.now(),
}: UpdateCustomReadAnyCardTemplateInput): KnowledgeCardTemplate {
  if (template.builtIn) {
    throw new Error("Built-in card templates cannot be edited.");
  }

  const trimmedName = name.trim();
  const title = trimmedName || template.name || "Custom card";
  const existingSchema = (templateSchema(template) as Record<string, JSONValue>) ?? {};
  const normalizedFields =
    fields === undefined
      ? getReadAnyCardTemplateFields(template)
      : normalizeReadAnyCardTemplateFields(fields);
  const {
    description: _existingDescription,
    fields: _existingFields,
    groups: _existingGroups,
    attrs: _existingAttrs,
    migrations: existingMigrations,
    ...schemaRest
  } = existingSchema;
  const existingFields = getReadAnyCardTemplateFields(template);
  const fieldRenames = createTemplateFieldRenameMap(existingFields, normalizedFields);
  const conditionSafeFields = rewriteTemplateFieldConditions(normalizedFields, fieldRenames);
  const existingAttrs = isRecord(existingSchema.attrs)
    ? (existingSchema.attrs as Record<string, JSONValue>)
    : {};
  const { data: _existingData, ...attrsRest } = existingAttrs;
  const existingAttrData = isRecord(existingAttrs.data)
    ? (existingAttrs.data as Record<string, JSONValue>)
    : {};
  const fieldDefaults = createReadAnyCardTemplateFieldDefaults(normalizedFields);
  const mergedData = fieldDefaults
    ? (mergeRecordDefaults(fieldDefaults, existingAttrData) as Record<string, JSONValue>)
    : existingAttrData;
  const previousVersion = Math.max(1, Math.floor(template.version || 1));
  const nextVersion = previousVersion + 1;
  const renameMigration = createTemplateFieldRenameMigration(
    fieldRenames,
    previousVersion,
    nextVersion,
  );
  const migrations = [
    ...(renameMigration ? [renameMigration] : []),
    ...(Array.isArray(existingMigrations) ? existingMigrations : []),
  ];
  const fieldGroups = createReadAnyCardTemplateFieldGroups(conditionSafeFields);
  const schemaFields = stripTemplateFieldGroupVisibility(conditionSafeFields);
  const schemaJson: Record<string, JSONValue> = {
    ...schemaRest,
    cardType: `custom:${template.id}`,
    insertLabel: title,
    title,
    markdown: markdown?.trim() ?? "",
  };
  const trimmedDescription = description?.trim();
  if (trimmedDescription) schemaJson.description = trimmedDescription;
  if (schemaFields.length > 0) {
    schemaJson.fields = schemaFields as unknown as JSONValue;
  }
  if (fieldGroups.length > 0) schemaJson.groups = fieldGroups as unknown as JSONValue;
  if (migrations.length > 0) schemaJson.migrations = migrations as unknown as JSONValue;
  const nextAttrs: Record<string, JSONValue> =
    Object.keys(mergedData).length > 0 ? { ...attrsRest, data: mergedData } : { ...attrsRest };
  if (Object.keys(nextAttrs).length > 0) schemaJson.attrs = nextAttrs;

  return {
    ...template,
    name: title,
    version: nextVersion,
    schemaJson,
    builtIn: false,
    updatedAt: now,
  };
}

export function createReadAnyCardAttrsFromTemplate(
  template: KnowledgeCardTemplate,
): ReadAnyCardAttrs {
  const schema = templateSchema(template);
  const schemaAttrs = isRecord(schema.attrs) ? schema.attrs : {};
  const fieldDefaults = createReadAnyCardTemplateFieldDefaults(schema.fields);
  const schemaAttrsWithFieldDefaults =
    fieldDefaults && isRecord(schemaAttrs.data)
      ? {
          ...schemaAttrs,
          data: mergeRecordDefaults(fieldDefaults, schemaAttrs.data),
        }
      : fieldDefaults
        ? { ...schemaAttrs, data: fieldDefaults }
        : schemaAttrs;
  const cardType =
    stringAttr(schema.cardType) ?? (template.builtIn ? template.id : `custom:${template.id}`);
  const version = numberAttr(schemaAttrs.version) ?? template.version;
  const attrs = normalizeReadAnyCardAttrs({
    ...schemaAttrsWithFieldDefaults,
    cardType,
    version,
    title: stringAttr(schema.title) ?? stringAttr(schema.insertLabel) ?? template.name,
    markdown: stringAttr(schema.markdown) ?? "",
    text: schema.text,
    sourceTitle: schema.sourceTitle,
    sourceId: schema.sourceId,
    cfi: schema.cfi,
  });

  return attrs;
}

export function getReadAnyCardTemplateInsertLabel(template: KnowledgeCardTemplate): string {
  const schema = templateSchema(template);
  return stringAttr(schema.insertLabel) ?? stringAttr(schema.title) ?? template.name;
}

export function getReadAnyCardTemplateDescription(
  template: KnowledgeCardTemplate,
): string | undefined {
  return stringAttr(templateSchema(template).description);
}

export function getReadAnyCardTemplateFields(
  template: KnowledgeCardTemplate,
): ReadAnyCardTemplateField[] {
  const schema = templateSchema(template);
  const fields = normalizeReadAnyCardTemplateFields(schema.fields);
  const groups = normalizeReadAnyCardTemplateFieldGroups(schema.groups, fields);
  return attachTemplateFieldGroupVisibility(fields, groups);
}

export function getReadAnyCardTemplateFieldGroups(
  template: KnowledgeCardTemplate,
): ReadAnyCardTemplateFieldGroup[] {
  const schema = templateSchema(template);
  const fields = normalizeReadAnyCardTemplateFields(schema.fields);
  return normalizeReadAnyCardTemplateFieldGroups(schema.groups, fields);
}

function isEmptyConditionValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function isConditionValueEqual(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) {
    return actual.some((item) => isConditionValueEqual(item, expected));
  }
  if (Array.isArray(expected)) {
    return expected.some((item) => isConditionValueEqual(actual, item));
  }
  if (typeof actual === "number" || typeof expected === "number") {
    const actualNumber = Number(actual);
    const expectedNumber = Number(expected);
    return Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)
      ? actualNumber === expectedNumber
      : String(actual) === String(expected);
  }
  return actual === expected || String(actual) === String(expected);
}

export function isReadAnyCardTemplateFieldVisible(
  field: ReadAnyCardTemplateField,
  data: Record<string, unknown> | undefined,
): boolean {
  const condition = field.visibleWhen;
  if (!condition) return true;
  const actualValue = data?.[condition.fieldKey];
  if (condition.operator === "empty") return isEmptyConditionValue(actualValue);
  if (condition.operator === "notEmpty") return !isEmptyConditionValue(actualValue);

  const expectedValue = condition.value;
  if (condition.operator === "equals") {
    return isConditionValueEqual(actualValue, expectedValue);
  }
  if (condition.operator === "notEquals") {
    return !isConditionValueEqual(actualValue, expectedValue);
  }
  if (condition.operator === "contains") {
    return Array.isArray(actualValue)
      ? actualValue.some((item) => isConditionValueEqual(item, expectedValue))
      : isConditionValueEqual(actualValue, expectedValue);
  }
  if (condition.operator === "notContains") {
    return Array.isArray(actualValue)
      ? !actualValue.some((item) => isConditionValueEqual(item, expectedValue))
      : !isConditionValueEqual(actualValue, expectedValue);
  }
  return true;
}

export function isReadAnyCardTemplateFieldGroupVisible(
  field: ReadAnyCardTemplateField,
  data: Record<string, unknown> | undefined,
): boolean {
  if (!field.groupVisibleWhen) return true;
  return isReadAnyCardTemplateFieldVisible(
    {
      key: `${field.group ?? "group"}_visibility`,
      label: field.group ?? "Group",
      type: "text",
      visibleWhen: field.groupVisibleWhen,
    },
    data,
  );
}

export function getVisibleReadAnyCardTemplateFields(
  template: KnowledgeCardTemplate,
  data?: Record<string, unknown>,
): ReadAnyCardTemplateField[] {
  return getReadAnyCardTemplateFields(template).filter(
    (field) =>
      isReadAnyCardTemplateFieldGroupVisible(field, data) &&
      isReadAnyCardTemplateFieldVisible(field, data),
  );
}

function formatStructuredFieldValue(
  field: ReadAnyCardTemplateField,
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) return undefined;

  if (field.type === "checkbox") {
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return undefined;
  }

  if (field.type === "select") {
    const optionValue = getTemplateFieldOptionValue(field.options ?? [], value);
    if (!optionValue) return undefined;
    return field.options?.find((option) => option.value === optionValue)?.label ?? optionValue;
  }

  if (field.type === "multiselect") {
    const rawValues = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    const selectedValues = rawValues
      .map((item) => getTemplateFieldOptionValue(field.options ?? [], item))
      .filter((item): item is string => !!item);
    const labels = [...new Set(selectedValues)].map(
      (item) => field.options?.find((option) => option.value === item)?.label ?? item,
    );
    return labels.length > 0 ? labels.join(", ") : undefined;
  }

  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === "string") {
    const text = value.trim();
    return text || undefined;
  }
  if (!isJsonValue(value)) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

export function isReadAnyCardTemplateRequiredValueMissing(
  field: ReadAnyCardTemplateField,
  value: unknown,
): boolean {
  return field.required === true && formatStructuredFieldValue(field, value) === undefined;
}

function createStructuredFieldValues(
  attrs: ReadAnyCardAttrs,
  template: KnowledgeCardTemplate | undefined,
): ReadAnyCardStructuredFieldValue[] {
  if (!template) return [];
  const data = isRecord(attrs.data) ? attrs.data : {};
  return getVisibleReadAnyCardTemplateFields(template, data)
    .map((field) => {
      const value = formatStructuredFieldValue(field, data[field.key]);
      const group = field.group?.trim();
      const width = field.width;
      if (value) {
        return {
          key: field.key,
          label: field.label,
          value,
          ...(group ? { group } : {}),
          ...(width ? { width } : {}),
        };
      }
      if (isReadAnyCardTemplateRequiredValueMissing(field, data[field.key])) {
        return {
          key: field.key,
          label: field.label,
          value: "Missing required value",
          ...(group ? { group } : {}),
          ...(width ? { width } : {}),
          missing: true,
        };
      }
      return undefined;
    })
    .filter((field): field is ReadAnyCardStructuredFieldValue => !!field);
}

export function renderReadAnyCardStructuredFieldsMarkdown(
  fields: ReadAnyCardStructuredFieldValue[],
): string {
  if (fields.length === 0) return "";
  const hasGroups = fields.some((field) => !!field.group);
  let currentGroup: string | undefined;
  const lines = fields.flatMap((field) => {
    const group = field.group?.trim() || undefined;
    const nextLines: string[] = [];
    if (hasGroups && group && group !== currentGroup) {
      nextLines.push(`${group}:`);
    }
    currentGroup = group;
    const valueLines = field.value.split("\n");
    const [firstLine = "", ...restLines] = valueLines;
    const itemPrefix = hasGroups && group ? "  - " : "- ";
    const continuationPrefix = hasGroups && group ? "    " : "  ";
    nextLines.push(
      [
        `${itemPrefix}${field.label}: ${firstLine}`,
        ...restLines.map((line) => `${continuationPrefix}${line}`),
      ].join("\n"),
    );
    return nextLines;
  });
  return ["Fields:", ...lines].join("\n");
}

export function appendReadAnyCardStructuredFieldsMarkdown(
  body: string,
  fields: ReadAnyCardStructuredFieldValue[],
): string {
  const fieldMarkdown = renderReadAnyCardStructuredFieldsMarkdown(fields);
  return [body.trim(), fieldMarkdown].filter(Boolean).join("\n\n");
}

export function createReadAnyCardReadOnlyModel(
  attrs: ReadAnyCardAttrs | Record<string, unknown> | null | undefined,
  options: CreateReadAnyCardReadOnlyModelOptions = { body: "" },
): ReadAnyCardReadOnlyModel {
  const normalizedAttrs = options.cardTemplates?.length
    ? upgradeReadAnyCardAttrsWithTemplates(attrs, options.cardTemplates)
    : normalizeReadAnyCardAttrs(attrs);
  const cardType = normalizedAttrs.cardType || "custom";
  const version = normalizedAttrs.version ?? 1;
  const definition = getReadAnyCardDefinition(cardType);
  const template = findTemplateForCardType(cardType, options.cardTemplates);
  const isCustomCard = cardType.startsWith("custom:");
  const isKnownBuiltIn = !!definition;
  const isFutureVersion = !!definition && version > definition.version;
  const isUnsupported = !definition && !isCustomCard;
  const body = bodyFromAttrs(normalizedAttrs, options);
  const insertLabel = template
    ? getReadAnyCardTemplateInsertLabel(template)
    : definition?.insertLabel;
  const title =
    normalizedAttrs.title ||
    normalizedAttrs.sourceTitle ||
    insertLabel ||
    options.fallbackTitle ||
    cardType;
  const state: ReadAnyCardReadOnlyState = isFutureVersion
    ? "future"
    : isUnsupported
      ? "unsupported"
      : isCustomCard
        ? "custom"
        : "supported";
  const stateLabel =
    state === "future"
      ? `v${version} newer`
      : state === "unsupported"
        ? "fallback"
        : state === "custom"
          ? `v${version}`
          : undefined;
  const metadata: ReadAnyCardReadOnlyMetadataItem[] = [
    { key: "cardType", label: "Card", value: cardType },
    { key: "version", label: "Version", value: `v${version}` },
    normalizedAttrs.sourceTitle
      ? { key: "source", label: "Source", value: normalizedAttrs.sourceTitle }
      : undefined,
    normalizedAttrs.sourceId
      ? { key: "sourceId", label: "Source ID", value: normalizedAttrs.sourceId }
      : undefined,
    normalizedAttrs.cfi ? { key: "cfi", label: "CFI", value: normalizedAttrs.cfi } : undefined,
  ].filter((item): item is ReadAnyCardReadOnlyMetadataItem => !!item);

  return {
    attrs: normalizedAttrs,
    cardType,
    version,
    title,
    body,
    structuredFields: createStructuredFieldValues(normalizedAttrs, template),
    state,
    stateLabel,
    insertLabel,
    metadata,
    sourceTitle: normalizedAttrs.sourceTitle,
    sourceId: normalizedAttrs.sourceId,
    cfi: normalizedAttrs.cfi,
    isFallback: isFutureVersion || isUnsupported,
    isFutureVersion,
    isCustomCard,
    isKnownBuiltIn,
  };
}

export function renderReadAnyCardMarkdownFallback(
  attrs: ReadAnyCardAttrs,
  context: ReadAnyCardMarkdownContext,
): string {
  const model = createReadAnyCardReadOnlyModel(attrs, context);
  const normalizedAttrs = model.attrs;
  const cardType = model.cardType;
  const definition = getReadAnyCardDefinition(cardType);
  const body = appendReadAnyCardStructuredFieldsMarkdown(model.body, model.structuredFields);
  if (definition && (normalizedAttrs.version ?? 1) <= definition.version) {
    return definition.markdownFallback(normalizedAttrs, { ...context, body });
  }

  return unsupportedCardCallout(normalizedAttrs, body);
}
