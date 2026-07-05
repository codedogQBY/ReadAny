import {
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  EditIcon,
  PlusIcon,
  Trash2Icon,
} from "@/components/ui/Icon";
import { useKeyboardInsets } from "@/hooks/use-keyboard-insets";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { extractLocalBookMetadata } from "@/lib/book/auto-metadata";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { SettingsHeader } from "@/screens/settings/SettingsHeader";
import { useLibraryStore } from "@/stores/library-store";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  spacing,
  useColors,
  withOpacity,
} from "@/styles/theme";
import { Picker } from "@react-native-picker/picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { getPlatformService } from "@readany/core/services";
import type { Book, BookReview } from "@readany/core/types";
import {
  type BookMetadataFormValues,
  buildBookMetadataUpdate,
  createBookMetadataFormValues,
  createEmptyBookReview,
  getBookProgressPercent,
  hasMissingBookMetadataAutoFillTargets,
  mergeMissingBookMetadataValues,
  splitEditableList,
} from "@readany/core/utils";
import * as ImagePicker from "expo-image-picker";
import type { TFunction } from "i18next";
import { Star } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Image,
  type KeyboardTypeOptions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextStyle,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = NativeStackScreenProps<RootStackParamList, "BookDetails">;
type DetailsTab = "basic" | "reviews";
type TextMetadataField = "description";
type OptionPickerTarget = {
  field: "language" | "groupId";
  label: string;
  value: string;
  options: { value: string; label: string }[];
};
type TextEditorTarget =
  | {
      kind: "field";
      field: TextMetadataField;
      label: string;
      value: string;
      placeholder: string;
      multiline?: boolean;
    }
  | {
      kind: "review";
      reviewId: string;
      label: string;
      value: string;
      placeholder: string;
    }
  | {
      kind: "newReview";
      label: string;
      value: string;
      placeholder: string;
    };

type PickedCoverSource = {
  uri: string;
  extension: string;
};

const LANGUAGE_PRESETS = [
  { value: "", label: "—" },
  { value: "zh-CN", label: "中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
  { value: "it", label: "Italiano" },
  { value: "pt", label: "Português" },
  { value: "ru", label: "Русский" },
];
const DATE_PRECISIONS = ["year", "month", "day"] as const;
type DatePrecision = (typeof DATE_PRECISIONS)[number];
const YEAR_OPTIONS = Array.from({ length: 220 }, (_, index) =>
  String(new Date().getFullYear() + 5 - index),
);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));

function getDatePrecision(value: string): DatePrecision {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "day";
  if (/^\d{4}-\d{2}$/.test(value)) return "month";
  return "year";
}

function getTodayParts() {
  const today = new Date();
  return {
    year: String(today.getFullYear()),
    month: String(today.getMonth() + 1).padStart(2, "0"),
    day: String(today.getDate()).padStart(2, "0"),
  };
}

function normalizeDateParts(value: string) {
  const match = value.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  const today = getTodayParts();
  return {
    year: match?.[1] ?? today.year,
    month: match?.[2] ?? today.month,
    day: match?.[3] ?? today.day,
  };
}

function buildPublishDateValue(
  parts: { year: string; month: string; day: string },
  precision: DatePrecision,
) {
  if (precision === "day") return `${parts.year}-${parts.month}-${parts.day}`;
  if (precision === "month") return `${parts.year}-${parts.month}`;
  return parts.year;
}

function getDaysInMonth(year: string, month: string) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function datePrecisionLabel(precision: DatePrecision, t: TFunction) {
  if (precision === "day") return t("library.detailsDatePrecisionDay", "年月日");
  if (precision === "month") return t("library.detailsDatePrecisionMonth", "年月");
  return t("library.detailsDatePrecisionYear", "仅年份");
}

function formatMonthLabel(month: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, { month: "short" }).format(
      new Date(2024, Number(month) - 1, 1),
    );
  } catch {
    return month;
  }
}

function formatPublishDate(value: string, locale: string) {
  const trimmed = value.trim();
  if (!trimmed) return "—";
  const match = trimmed.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!match) return trimmed;
  const [, year, month, day] = match;
  try {
    if (day) {
      return new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(Number(year), Number(month) - 1, Number(day)));
    }
    if (month) {
      return new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "short",
      }).format(new Date(Number(year), Number(month) - 1, 1));
    }
    return new Intl.DateTimeFormat(locale, { year: "numeric" }).format(
      new Date(Number(year), 0, 1),
    );
  } catch {
    return trimmed;
  }
}

function syncStatusLabel(status: Book["syncStatus"], t: TFunction) {
  if (status === "remote") return t("library.detailsSyncRemote", "Remote only");
  if (status === "downloading") return t("library.detailsSyncDownloading", "Downloading");
  return t("library.detailsSyncLocal", "Local");
}

function formatReviewDate(value: number | undefined, locale: string) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function resolveGroupName(
  book: Book,
  groups: { id: string; name: string }[],
  uncategorized: string,
) {
  if (!book.groupId) return uncategorized;
  return groups.find((group) => group.id === book.groupId)?.name ?? uncategorized;
}

function extensionFromMimeType(mimeType?: string | null): string | null {
  switch (mimeType?.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return null;
  }
}

function extensionFromPath(path: string): string | null {
  const cleanPath = path.split("?")[0] ?? path;
  const ext = cleanPath.split(".").pop()?.toLowerCase();
  if (!ext || ext === cleanPath.toLowerCase()) return null;
  return ext === "jpeg" ? "jpg" : ext;
}

async function pickCoverFromPhotoLibrary(): Promise<PickedCoverSource | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 1,
  });
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    extension:
      extensionFromMimeType(asset.mimeType) ||
      extensionFromPath(asset.fileName || "") ||
      extensionFromPath(asset.uri) ||
      "jpg",
  };
}

export function BookDetailsScreen({ route }: Props) {
  const { bookId } = route.params;
  const colors = useColors();
  const layout = useResponsiveLayout();
  const { t, i18n } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardInsets = useKeyboardInsets();
  const books = useLibraryStore((state) => state.books);
  const groups = useLibraryStore((state) => state.groups);
  const allTags = useLibraryStore((state) => state.allTags);
  const addTag = useLibraryStore((state) => state.addTag);
  const loadBooks = useLibraryStore((state) => state.loadBooks);
  const updateBook = useLibraryStore((state) => state.updateBook);
  const book = books.find((item) => item.id === bookId) ?? null;
  const [values, setValues] = useState<BookMetadataFormValues | null>(null);
  const [coverSrc, setCoverSrc] = useState<string | undefined>();
  const [newTag, setNewTag] = useState("");
  const [activeTab, setActiveTab] = useState<DetailsTab>("basic");
  const [textEditorTarget, setTextEditorTarget] = useState<TextEditorTarget | null>(null);
  const [optionPickerTarget, setOptionPickerTarget] = useState<OptionPickerTarget | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const hydratedBookIdRef = useRef<string | null>(null);
  const autoFilledBookIdRef = useRef<string | null>(null);
  const latestValuesRef = useRef<BookMetadataFormValues | null>(null);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  useEffect(() => {
    if (!book) return;
    if (hydratedBookIdRef.current === book.id) return;
    hydratedBookIdRef.current = book.id;
    setValues(createBookMetadataFormValues(book));
  }, [book]);

  useEffect(() => {
    latestValuesRef.current = values;
  }, [values]);

  useEffect(() => {
    if (!book || !values) return;
    if (autoFilledBookIdRef.current === book.id) return;
    if (!hasMissingBookMetadataAutoFillTargets(values)) return;
    autoFilledBookIdRef.current = book.id;

    let cancelled = false;
    void extractLocalBookMetadata(book).then((metadata) => {
      if (cancelled || !metadata) return;
      const nextValues = latestValuesRef.current
        ? mergeMissingBookMetadataValues(latestValuesRef.current, metadata)
        : null;
      if (!nextValues) return;
      setValues(nextValues);
      updateBook(book.id, buildBookMetadataUpdate(book, nextValues));
    });

    return () => {
      cancelled = true;
    };
  }, [book, updateBook, values]);

  useEffect(() => {
    const raw = values?.coverUrl;
    if (!raw) {
      setCoverSrc(undefined);
      return;
    }
    if (raw.startsWith("http") || raw.startsWith("blob") || raw.startsWith("file")) {
      setCoverSrc(raw);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const absPath = await platform.joinPath(appData, raw);
        if (!cancelled) setCoverSrc(absPath);
      } catch {
        if (!cancelled) setCoverSrc(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [values?.coverUrl]);

  const setField = useCallback(
    <K extends keyof BookMetadataFormValues>(field: K, value: BookMetadataFormValues[K]) => {
      setValues((current) => {
        if (!current) return current;
        const next = { ...current, [field]: value };
        if (book) updateBook(book.id, buildBookMetadataUpdate(book, next));
        return next;
      });
    },
    [book, updateBook],
  );

  const persistCoverUrl = useCallback(
    async (coverUrl: string) => {
      if (!book || !values) return;
      const nextValues = { ...values, coverUrl };
      setValues(nextValues);
      await updateBook(book.id, buildBookMetadataUpdate(book, nextValues));
    },
    [book, updateBook, values],
  );

  const setRating = useCallback(
    (rating: number) => {
      if (!book || !values) return;
      const next = { ...values, rating: values.rating === rating ? null : rating };
      setValues(next);
      updateBook(book.id, buildBookMetadataUpdate(book, next));
    },
    [book, updateBook, values],
  );

  const addReview = useCallback(
    (content: string) => {
      if (!book || !values) return;
      const review = { ...createEmptyBookReview(), content };
      const next = { ...values, reviews: [...values.reviews, review] };
      setValues(next);
      updateBook(book.id, buildBookMetadataUpdate(book, next));
    },
    [book, updateBook, values],
  );

  const updateReview = useCallback(
    (reviewId: string, content: string) => {
      if (!book || !values) return;
      const next = {
        ...values,
        reviews: values.reviews.map((review) =>
          review.id === reviewId ? { ...review, content } : review,
        ),
      };
      setValues(next);
      updateBook(book.id, buildBookMetadataUpdate(book, next));
    },
    [book, updateBook, values],
  );

  const removeReview = useCallback(
    (reviewId: string) => {
      if (!book || !values) return;
      const next = {
        ...values,
        reviews: values.reviews.filter((review) => review.id !== reviewId),
      };
      setValues(next);
      updateBook(book.id, buildBookMetadataUpdate(book, next));
    },
    [book, updateBook, values],
  );

  const handleTextEditorDone = useCallback(
    (text: string) => {
      if (!textEditorTarget) return;
      if (textEditorTarget.kind === "field") {
        setField(textEditorTarget.field, text);
      } else if (textEditorTarget.kind === "review") {
        updateReview(textEditorTarget.reviewId, text);
      } else if (text.trim()) {
        addReview(text);
      }
      setTextEditorTarget(null);
    },
    [addReview, setField, textEditorTarget, updateReview],
  );

  const handleChangeCover = useCallback(async () => {
    if (!book || !values) return;
    try {
      const platform = getPlatformService();
      let selected: PickedCoverSource | null = null;
      try {
        selected = await pickCoverFromPhotoLibrary();
      } catch (error) {
        console.warn(
          "[BookDetailsScreen] Photo library picker failed, falling back to file picker:",
          error,
        );
        const file = await platform.pickFile({
          multiple: false,
          filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }],
        });
        if (!file || Array.isArray(file)) return;
        selected = {
          uri: file,
          extension: extensionFromPath(file) || "jpg",
        };
      }
      if (!selected) return;

      const safeExt = selected.extension === "jpeg" ? "jpg" : selected.extension;
      const appData = await platform.getAppDataDir();
      const coversDir = await platform.joinPath(appData, "covers");
      await platform.mkdir(coversDir);
      const relativePath = `covers/${book.id}-custom-${Date.now()}.${safeExt}`;
      const targetPath = await platform.joinPath(appData, relativePath);
      const bytes = await platform.readFile(selected.uri);
      await platform.writeFile(targetPath, bytes);
      await persistCoverUrl(relativePath);
      Alert.alert(t("common.success", "成功"), t("library.detailsCoverSaved", "封面已保存"));
    } catch (error) {
      console.warn("[BookDetailsScreen] Failed to change cover:", error);
      Alert.alert(t("common.failed", "失败"), t("common.failed", "失败"));
    }
  }, [book, persistCoverUrl, t, values]);

  if (!book || !values) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={["top"]}
      >
        <SettingsHeader title={t("library.detailsTitle", "书籍详情")} />
        <View style={styles.missingWrap}>
          <Text style={styles.missingText}>{t("library.bookNotFound", "书籍不存在")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const progressPct = getBookProgressPercent(book.progress);
  const groupName = resolveGroupName(book, groups, t("sidebar.uncategorized", "未分类"));
  const reviewCount = values.reviews.filter((review) => review.content.trim()).length;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      <SettingsHeader title={t("library.detailsTitle", "书籍详情")} />
      <View style={styles.flex}>
        <ScrollView
          style={styles.flex}
          automaticallyAdjustKeyboardInsets={false}
          contentContainerStyle={[
            styles.scrollContent,
            { maxWidth: layout.centeredContentWidth, alignSelf: "center" },
            keyboardInsets.isVisible ? { paddingBottom: 64 + keyboardInsets.bottomInset } : null,
          ]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.heroStage}>
            <View style={styles.coverColumn}>
              <View style={styles.coverStack}>
                <View style={styles.coverShadow} />
                <View style={styles.cover}>
                  {coverSrc ? (
                    <Image
                      source={{ uri: coverSrc }}
                      style={styles.coverImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.coverFallback}>
                      <Text style={styles.coverFallbackTitle} numberOfLines={4}>
                        {book.meta.title}
                      </Text>
                      {book.meta.author ? (
                        <Text style={styles.coverFallbackAuthor} numberOfLines={1}>
                          {book.meta.author}
                        </Text>
                      ) : null}
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.coverActions}>
                <TouchableOpacity
                  style={styles.coverAction}
                  activeOpacity={0.78}
                  onPress={() => void handleChangeCover()}
                >
                  <EditIcon size={12} color={colors.mutedForeground} />
                  <Text style={styles.coverActionText}>
                    {t("library.detailsChangeCover", "更换")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coverAction, !values.coverUrl && styles.coverActionDisabled]}
                  disabled={!values.coverUrl}
                  activeOpacity={0.78}
                  onPress={() => void persistCoverUrl("")}
                >
                  <Trash2Icon size={12} color={colors.mutedForeground} />
                  <Text style={styles.coverActionText}>
                    {t("library.detailsClearCover", "清除")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.heroCopy}>
              <InlineEditableHeroInput
                value={values.title}
                placeholder={t("library.detailsBookTitle", "书名")}
                textStyle={styles.heroTitleText}
                placeholderStyle={styles.heroTitlePlaceholder}
                multiline
                onChangeText={(text) => setField("title", text)}
                styles={styles}
              />
              <InlineEditableHeroInput
                value={values.author}
                placeholder={t("library.detailsUnknownAuthor", "未知作者")}
                textStyle={styles.heroAuthorText}
                placeholderStyle={styles.heroAuthorPlaceholder}
                onChangeText={(text) => setField("author", text)}
                styles={styles}
              />
              <RatingField
                label={t("library.detailsRating", "评分")}
                noRatingLabel={t("library.detailsNoRating", "未评分")}
                value={values.rating}
                onChange={setRating}
                styles={styles}
                colors={colors}
              />
              <View style={styles.progressBlock}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
                </View>
                <Text style={styles.progressText}>
                  {t("library.detailsProgressValue", "{{progress}}% 已读", {
                    progress: progressPct,
                  })}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.metaStrip}>
            <MetaItem
              label={t("library.detailsSync", "同步")}
              value={syncStatusLabel(book.syncStatus, t)}
              styles={styles}
            />
            <MetaItem label={t("library.group", "分组")} value={groupName} styles={styles} />
            <MetaItem
              label={t("library.detailsVector", "向量")}
              value={
                book.isVectorized
                  ? t("home.vec_indexed", "已索引")
                  : t("home.notVectorized", "未索引")
              }
              styles={styles}
            />
            <MetaItem
              label={t("library.detailsFormat", "格式")}
              value={book.format.toUpperCase()}
              styles={styles}
              last
            />
          </View>

          <View style={styles.tabBar}>
            <DetailsTabButton
              active={activeTab === "basic"}
              label={t("library.detailsTabBasic", "基本信息")}
              onPress={() => setActiveTab("basic")}
              styles={styles}
            />
            <DetailsTabButton
              active={activeTab === "reviews"}
              label={t("library.detailsTabReviews", "书评")}
              count={reviewCount}
              onPress={() => setActiveTab("reviews")}
              styles={styles}
            />
          </View>

          {activeTab === "basic" ? (
            <View style={styles.tabContent}>
              <View style={styles.editorPanel}>
                <EditableInfoRow
                  label={t("library.detailsPublisher", "出版社")}
                  value={values.publisher}
                  placeholder="—"
                  onCommit={(text) => setField("publisher", text)}
                  styles={styles}
                />
                <PickerInfoRow
                  label={t("library.detailsLanguage", "语言")}
                  value={values.language}
                  placeholder="—"
                  options={LANGUAGE_PRESETS}
                  onPress={() =>
                    setOptionPickerTarget({
                      field: "language",
                      label: t("library.detailsLanguage", "语言"),
                      value: values.language,
                      options: LANGUAGE_PRESETS,
                    })
                  }
                  styles={styles}
                />
                <DateInfoRow
                  label={t("library.detailsPublishDate", "出版日期")}
                  value={values.publishDate}
                  locale={i18n.language}
                  onPress={() => setDatePickerOpen(true)}
                  styles={styles}
                />
                <EditableInfoRow
                  label={t("library.detailsIsbn", "ISBN")}
                  value={values.isbn}
                  placeholder="—"
                  inputStyle={styles.monospaceValue}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="numbers-and-punctuation"
                  onCommit={(text) => setField("isbn", text)}
                  styles={styles}
                />
                <PickerInfoRow
                  label={t("library.group", "分组")}
                  value={values.groupId}
                  placeholder={t("sidebar.uncategorized", "未分类")}
                  options={[
                    { value: "", label: t("sidebar.uncategorized", "未分类") },
                    ...groups.map((group) => ({ value: group.id, label: group.name })),
                  ]}
                  onPress={() =>
                    setOptionPickerTarget({
                      field: "groupId",
                      label: t("library.group", "分组"),
                      value: values.groupId,
                      options: [
                        { value: "", label: t("sidebar.uncategorized", "未分类") },
                        ...groups.map((group) => ({ value: group.id, label: group.name })),
                      ],
                    })
                  }
                  styles={styles}
                  last
                />
              </View>
              <TagField
                label={t("library.detailsTags", "标签")}
                value={values.tagsText}
                allTags={allTags}
                newTag={newTag}
                emptyLabel={t("sidebar.noTags", "还没有标签")}
                placeholder={t("sidebar.tagPlaceholder", "标签名称")}
                onChange={(text) => setField("tagsText", text)}
                onNewTagChange={setNewTag}
                onAddTag={(tag) => {
                  addTag(tag);
                  setField("tagsText", joinTags([...splitEditableList(values.tagsText), tag]));
                  setNewTag("");
                }}
                styles={styles}
              />
              <EditableLongTextField
                label={t("library.detailsDescription", "简介")}
                value={values.description}
                placeholder={t("library.detailsDescriptionPlaceholder", "补充这本书的简介")}
                editLabel={t("library.detailsEditDescription", "编辑简介")}
                onEdit={() =>
                  setTextEditorTarget({
                    kind: "field",
                    field: "description",
                    label: t("library.detailsDescription", "简介"),
                    value: values.description,
                    placeholder: t("library.detailsDescriptionPlaceholder", "补充这本书的简介"),
                    multiline: true,
                  })
                }
                styles={styles}
              />
            </View>
          ) : (
            <ReviewsField
              label={t("library.detailsReviews", "书评")}
              addLabel={t("library.detailsAddReview", "添加书评")}
              placeholder={t("library.detailsReviewPlaceholder", "写下你对这本书的想法")}
              editLabel={t("common.edit", "编辑")}
              removeLabel={t("library.detailsRemoveReview", "删除书评")}
              reviews={values.reviews}
              locale={i18n.language}
              onAdd={() =>
                setTextEditorTarget({
                  kind: "newReview",
                  label: t("library.detailsAddReview", "添加书评"),
                  value: "",
                  placeholder: t("library.detailsReviewPlaceholder", "写下你对这本书的想法"),
                })
              }
              onEdit={(review) =>
                setTextEditorTarget({
                  kind: "review",
                  reviewId: review.id,
                  label: t("library.detailsReviews", "书评"),
                  value: review.content,
                  placeholder: t("library.detailsReviewPlaceholder", "写下你对这本书的想法"),
                })
              }
              onRemove={removeReview}
              styles={styles}
              colors={colors}
            />
          )}
        </ScrollView>
      </View>
      <TextEditSheet
        target={textEditorTarget}
        doneLabel={t("common.done", "完成")}
        cancelLabel={t("common.cancel", "取消")}
        styles={styles}
        onClose={() => setTextEditorTarget(null)}
        onDone={handleTextEditorDone}
      />
      <OptionPickerSheet
        target={optionPickerTarget}
        doneLabel={t("common.done", "完成")}
        cancelLabel={t("common.cancel", "取消")}
        styles={styles}
        onClose={() => setOptionPickerTarget(null)}
        onDone={(target, value) => {
          setField(target.field, value);
          setOptionPickerTarget(null);
        }}
      />
      <DatePickerSheet
        visible={datePickerOpen}
        value={values.publishDate}
        locale={i18n.language}
        title={t("library.detailsPublishDate", "出版日期")}
        doneLabel={t("common.done", "完成")}
        cancelLabel={t("common.cancel", "取消")}
        t={t}
        styles={styles}
        onClose={() => setDatePickerOpen(false)}
        onDone={(nextValue) => {
          setField("publishDate", nextValue);
          setDatePickerOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

function DetailsTabButton({
  active,
  label,
  count,
  onPress,
  styles,
}: {
  active: boolean;
  label: string;
  count?: number;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity
      style={[styles.tabButton, active && styles.tabButtonActive]}
      activeOpacity={0.82}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.tabButtonText, active && styles.tabButtonTextActive]}>{label}</Text>
      {typeof count === "number" && count > 0 ? (
        <View style={[styles.tabCountBadge, active && styles.tabCountBadgeActive]}>
          <Text style={[styles.tabCount, active && styles.tabCountActive]}>{count}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function InlineEditableHeroInput({
  value,
  placeholder,
  textStyle,
  placeholderStyle,
  multiline,
  onChangeText,
  styles,
}: {
  value: string;
  placeholder: string;
  textStyle: StyleProp<TextStyle>;
  placeholderStyle: StyleProp<TextStyle>;
  multiline?: boolean;
  onChangeText: (value: string) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TextInput
      value={value}
      placeholder={placeholder}
      placeholderTextColor={styles.heroInputPlaceholder.color}
      multiline={multiline}
      style={[styles.heroInlineInput, value.trim() ? textStyle : placeholderStyle]}
      onChangeText={onChangeText}
      returnKeyType={multiline ? "default" : "done"}
      textAlignVertical={multiline ? "top" : "center"}
    />
  );
}

function EditableInfoRow({
  label,
  value,
  placeholder,
  inputStyle,
  autoCapitalize,
  autoCorrect,
  keyboardType,
  onCommit,
  styles,
  last,
}: {
  label: string;
  value: string;
  placeholder: string;
  inputStyle?: StyleProp<TextStyle>;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  keyboardType?: KeyboardTypeOptions;
  onCommit: (value: string) => void;
  styles: ReturnType<typeof makeStyles>;
  last?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<TextInput>(null);
  const display = value.trim();
  const showPlaceholder = !display;

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    if (!editing) return;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setNativeProps({
        selection: { start: draft.length, end: draft.length },
      });
    }, 80);
    return () => clearTimeout(timer);
  }, [draft.length, editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };

  return (
    <TouchableOpacity
      style={[styles.infoRow, last && styles.infoRowLast, editing && styles.infoRowEditing]}
      activeOpacity={0.82}
      onPress={() => setEditing(true)}
      accessibilityRole="button"
    >
      <View style={styles.infoRowLabelWrap}>
        <Text style={styles.infoRowLabel}>{label}</Text>
      </View>
      <View style={styles.infoRowValueWrap}>
        {editing ? (
          <TextInput
            ref={inputRef}
            value={draft}
            placeholder={placeholder}
            placeholderTextColor={styles.infoRowPlaceholder.color}
            style={[styles.infoRowInput, inputStyle]}
            autoCapitalize={autoCapitalize}
            autoCorrect={autoCorrect}
            keyboardType={keyboardType}
            onBlur={commit}
            onChangeText={setDraft}
            onSubmitEditing={commit}
            returnKeyType="done"
          />
        ) : (
          <>
            <Text
              style={[
                showPlaceholder ? styles.infoRowPlaceholder : styles.infoRowValue,
                inputStyle,
              ]}
              numberOfLines={1}
            >
              {showPlaceholder ? placeholder : display}
            </Text>
            <EditIcon size={12} color={styles.infoRowAffordance.color} />
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

function PickerInfoRow({
  label,
  value,
  placeholder,
  options,
  onPress,
  styles,
  last,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: { value: string; label: string }[];
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  last?: boolean;
}) {
  const matched = options.find((option) => option.value === value)?.label;
  const hasValue = Boolean(value.trim() && matched);
  const display = matched ?? placeholder;

  return (
    <TouchableOpacity
      style={[styles.infoRow, last && styles.infoRowLast]}
      activeOpacity={0.82}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={styles.infoRowLabelWrap}>
        <Text style={styles.infoRowLabel}>{label}</Text>
      </View>
      <View style={styles.infoRowValueWrap}>
        <Text style={hasValue ? styles.infoRowValue : styles.infoRowPlaceholder} numberOfLines={1}>
          {display}
        </Text>
        <ChevronRightIcon size={14} color={styles.infoRowAffordance.color} />
      </View>
    </TouchableOpacity>
  );
}

function DateInfoRow({
  label,
  value,
  locale,
  onPress,
  styles,
  last,
}: {
  label: string;
  value: string;
  locale: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.infoRow, last && styles.infoRowLast]}
      activeOpacity={0.82}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={styles.infoRowLabelWrap}>
        <Text style={styles.infoRowLabel}>{label}</Text>
      </View>
      <View style={styles.infoRowValueWrap}>
        <Text
          style={value.trim() ? styles.infoRowValue : styles.infoRowPlaceholder}
          numberOfLines={1}
        >
          {formatPublishDate(value, locale)}
        </Text>
        <CalendarIcon size={14} color={styles.infoRowAffordance.color} />
      </View>
    </TouchableOpacity>
  );
}

function RatingField({
  label,
  noRatingLabel,
  value,
  onChange,
  styles,
  colors,
}: {
  label: string;
  noRatingLabel: string;
  value: number | null;
  onChange: (value: number) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  return (
    <View style={styles.ratingBlock}>
      <View style={styles.ratingRow}>
        {[1, 2, 3, 4, 5].map((rating) => {
          const selected = value !== null && rating <= value;
          return (
            <TouchableOpacity
              key={rating}
              style={[styles.ratingButton, selected && styles.ratingButtonActive]}
              activeOpacity={0.78}
              onPress={() => onChange(rating)}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${rating}`}
            >
              <Star
                size={17}
                color={selected ? colors.primary : colors.mutedForeground}
                fill={selected ? colors.primary : "transparent"}
                strokeWidth={2}
              />
            </TouchableOpacity>
          );
        })}
        <Text style={styles.ratingValue}>{value ? `${value}/5` : noRatingLabel}</Text>
      </View>
    </View>
  );
}

function ReviewsField({
  label,
  addLabel,
  placeholder,
  editLabel,
  removeLabel,
  reviews,
  locale,
  onAdd,
  onEdit,
  onRemove,
  styles,
  colors,
}: {
  label: string;
  addLabel: string;
  placeholder: string;
  editLabel: string;
  removeLabel: string;
  reviews: BookReview[];
  locale: string;
  onAdd: () => void;
  onEdit: (review: BookReview) => void;
  onRemove: (reviewId: string) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TouchableOpacity
          style={styles.inlineTextButton}
          activeOpacity={0.82}
          onPress={onAdd}
          accessibilityRole="button"
        >
          <PlusIcon size={13} color={colors.primary} />
          <Text style={styles.inlineTextButtonText}>{addLabel}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.reviewsList}>
        {reviews.length === 0 ? (
          <TouchableOpacity
            style={styles.reviewsEmptyCard}
            activeOpacity={0.82}
            onPress={onAdd}
            accessibilityRole="button"
          >
            <Text style={styles.reviewsEmptyText}>{placeholder}</Text>
          </TouchableOpacity>
        ) : null}
        {reviews.map((review) => (
          <ReadOnlyTextCard
            key={review.id}
            value={review.content}
            meta={formatReviewDate(review.updatedAt || review.createdAt, locale)}
            placeholder={placeholder}
            editLabel={editLabel}
            onEdit={() => onEdit(review)}
            styles={styles}
            colors={colors}
            trailingAction={
              <TouchableOpacity
                style={styles.longTextIconButton}
                activeOpacity={0.78}
                onPress={() => onRemove(review.id)}
                accessibilityRole="button"
                accessibilityLabel={removeLabel}
              >
                <Trash2Icon size={13} color={colors.mutedForeground} />
              </TouchableOpacity>
            }
          />
        ))}
      </View>
    </View>
  );
}

function EditableLongTextField({
  label,
  value,
  placeholder,
  editLabel,
  onEdit,
  styles,
}: {
  label: string;
  value: string;
  placeholder: string;
  editLabel: string;
  onEdit: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TouchableOpacity
          style={styles.inlineTextButton}
          activeOpacity={0.82}
          onPress={onEdit}
          accessibilityRole="button"
        >
          <EditIcon size={13} color={styles.inlineTextButtonText.color} />
          <Text style={styles.inlineTextButtonText}>{editLabel}</Text>
        </TouchableOpacity>
      </View>
      <ReadOnlyTextCard
        value={value}
        placeholder={placeholder}
        editLabel={editLabel}
        onEdit={onEdit}
        showInlineEditAction={false}
        styles={styles}
      />
    </View>
  );
}

function ReadOnlyTextCard({
  meta,
  value,
  placeholder,
  editLabel,
  trailingAction,
  showInlineEditAction = true,
  onEdit,
  styles,
  colors,
}: {
  meta?: string;
  value: string;
  placeholder: string;
  editLabel: string;
  trailingAction?: React.ReactNode;
  showInlineEditAction?: boolean;
  onEdit: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors?: ThemeColors;
}) {
  const display = value.trim();
  const actionColor = colors?.primary ?? styles.longTextActionText.color;

  return (
    <View style={styles.longTextCard}>
      {trailingAction || showInlineEditAction ? (
        <View style={styles.longTextToolbar}>
          {trailingAction}
          {showInlineEditAction ? (
            <TouchableOpacity
              style={styles.longTextAction}
              activeOpacity={0.82}
              onPress={onEdit}
              accessibilityRole="button"
            >
              <EditIcon size={13} color={actionColor} />
              <Text style={styles.longTextActionText}>{editLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      <View style={styles.longTextContent}>
        <TouchableOpacity
          style={[
            styles.longTextBody,
            trailingAction || showInlineEditAction ? styles.longTextBodyWithToolbar : null,
          ]}
          activeOpacity={0.82}
          onPress={onEdit}
          accessibilityRole="button"
        >
          {meta ? <Text style={styles.longTextMeta}>{meta}</Text> : null}
          <Text style={display ? styles.longTextDisplay : styles.longTextPlaceholder}>
            {display || placeholder}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function TextEditSheet({
  target,
  doneLabel,
  cancelLabel,
  styles,
  onClose,
  onDone,
}: {
  target: TextEditorTarget | null;
  doneLabel: string;
  cancelLabel: string;
  styles: ReturnType<typeof makeStyles>;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<TextInput>(null);
  const keyboardInsets = useKeyboardInsets();
  const multiline = Boolean(target && (target.kind !== "field" || target.multiline));

  useEffect(() => {
    setDraft(target?.value ?? "");
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setNativeProps({
        selection: { start: target.value.length, end: target.value.length },
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [target]);

  return (
    <Modal visible={Boolean(target)} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.sheetRoot, { paddingBottom: keyboardInsets.bottomInset }]}>
        <Pressable style={styles.sheetOverlay} onPress={onClose} />
        <View style={[styles.textSheet, multiline && styles.textSheetTall]}>
          <View style={styles.sheetHandle} />
          <View style={styles.textSheetHeader}>
            <TouchableOpacity
              style={styles.textSheetGhostButton}
              activeOpacity={0.82}
              onPress={onClose}
            >
              <Text style={styles.textSheetGhostButtonText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <Text style={styles.textSheetTitle}>{target?.label ?? ""}</Text>
            <TouchableOpacity
              style={styles.textSheetDoneButton}
              activeOpacity={0.82}
              onPress={() => onDone(draft)}
            >
              <Text style={styles.textSheetDoneButtonText}>{doneLabel}</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            ref={inputRef}
            style={[styles.textSheetInput, multiline ? styles.textSheetMultilineInput : undefined]}
            value={draft}
            placeholder={target?.placeholder}
            placeholderTextColor={styles.placeholder.color}
            multiline={multiline}
            textAlignVertical={multiline ? "top" : "center"}
            returnKeyType={multiline ? "default" : "done"}
            onChangeText={setDraft}
            onSubmitEditing={() => {
              if (multiline) return;
              onDone(draft);
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

function OptionPickerSheet({
  target,
  doneLabel,
  cancelLabel,
  styles,
  onClose,
  onDone,
}: {
  target: OptionPickerTarget | null;
  doneLabel: string;
  cancelLabel: string;
  styles: ReturnType<typeof makeStyles>;
  onClose: () => void;
  onDone: (target: OptionPickerTarget, value: string) => void;
}) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft(target?.value ?? "");
  }, [target]);

  return (
    <Modal visible={Boolean(target)} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Pressable style={styles.sheetOverlay} onPress={onClose} />
        <View style={styles.pickerSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.textSheetHeader}>
            <TouchableOpacity
              style={styles.textSheetGhostButton}
              activeOpacity={0.82}
              onPress={onClose}
            >
              <Text style={styles.textSheetGhostButtonText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <Text style={styles.textSheetTitle}>{target?.label ?? ""}</Text>
            <TouchableOpacity
              style={styles.textSheetDoneButton}
              activeOpacity={0.82}
              onPress={() => {
                if (target) onDone(target, draft);
              }}
            >
              <Text style={styles.textSheetDoneButtonText}>{doneLabel}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.pickerSheetSurface}>
            <Picker
              selectedValue={draft}
              onValueChange={(nextValue) => {
                if (typeof nextValue === "string") setDraft(nextValue);
              }}
              itemStyle={styles.pickerItem}
              style={styles.nativePicker}
            >
              {(target?.options ?? []).map((option) => (
                <Picker.Item
                  key={option.value || "none"}
                  label={option.label}
                  value={option.value}
                />
              ))}
            </Picker>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DatePickerSheet({
  visible,
  value,
  locale,
  title,
  doneLabel,
  cancelLabel,
  t,
  styles,
  onClose,
  onDone,
}: {
  visible: boolean;
  value: string;
  locale: string;
  title: string;
  doneLabel: string;
  cancelLabel: string;
  t: TFunction;
  styles: ReturnType<typeof makeStyles>;
  onClose: () => void;
  onDone: (value: string) => void;
}) {
  const [draftPrecision, setDraftPrecision] = useState<DatePrecision>(
    value.trim() ? getDatePrecision(value) : "day",
  );
  const [draftParts, setDraftParts] = useState(() => normalizeDateParts(value));

  useEffect(() => {
    if (!visible) return;
    setDraftPrecision(value.trim() ? getDatePrecision(value) : "day");
    setDraftParts(normalizeDateParts(value));
  }, [value, visible]);

  const dayOptions = useMemo(
    () =>
      Array.from({ length: getDaysInMonth(draftParts.year, draftParts.month) }, (_, index) =>
        String(index + 1).padStart(2, "0"),
      ),
    [draftParts.year, draftParts.month],
  );

  const setPart = (key: keyof ReturnType<typeof normalizeDateParts>, nextValue: string) => {
    setDraftParts((current) => {
      const nextParts = { ...current, [key]: nextValue };
      const maxDay = getDaysInMonth(nextParts.year, nextParts.month);
      if (Number(nextParts.day) > maxDay) nextParts.day = String(maxDay).padStart(2, "0");
      return nextParts;
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Pressable style={styles.sheetOverlay} onPress={onClose} />
        <View style={styles.pickerSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.textSheetHeader}>
            <TouchableOpacity
              style={styles.textSheetGhostButton}
              activeOpacity={0.82}
              onPress={onClose}
            >
              <Text style={styles.textSheetGhostButtonText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <Text style={styles.textSheetTitle}>{title}</Text>
            <TouchableOpacity
              style={styles.textSheetDoneButton}
              activeOpacity={0.82}
              onPress={() => onDone(buildPublishDateValue(draftParts, draftPrecision))}
            >
              <Text style={styles.textSheetDoneButtonText}>{doneLabel}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.segmentRow}>
            {DATE_PRECISIONS.map((item) => {
              const selected = draftPrecision === item;
              return (
                <TouchableOpacity
                  key={item}
                  style={[styles.segmentButton, selected && styles.segmentButtonActive]}
                  activeOpacity={0.82}
                  onPress={() => setDraftPrecision(item)}
                >
                  <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>
                    {datePrecisionLabel(item, t)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.datePickerColumns}>
            <PickerColumn
              value={draftParts.year}
              options={YEAR_OPTIONS}
              onSelect={(nextValue) => setPart("year", nextValue)}
              styles={styles}
            />
            {draftPrecision !== "year" ? (
              <PickerColumn
                value={draftParts.month}
                options={MONTH_OPTIONS}
                format={(month) => formatMonthLabel(month, locale)}
                onSelect={(nextValue) => setPart("month", nextValue)}
                styles={styles}
              />
            ) : null}
            {draftPrecision === "day" ? (
              <PickerColumn
                value={draftParts.day}
                options={dayOptions}
                onSelect={(nextValue) => setPart("day", nextValue)}
                styles={styles}
              />
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function PickerColumn({
  value,
  options,
  format,
  onSelect,
  styles,
}: {
  value: string;
  options: string[];
  format?: (value: string) => string;
  onSelect: (value: string) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.pickerWheel}>
      <Picker
        selectedValue={value}
        onValueChange={(nextValue) => {
          if (typeof nextValue === "string" && nextValue !== value) onSelect(nextValue);
        }}
        itemStyle={styles.pickerItem}
        style={styles.nativePicker}
      >
        {options.map((option) => (
          <Picker.Item key={option} label={format ? format(option) : option} value={option} />
        ))}
      </Picker>
    </View>
  );
}

function joinTags(tags: string[]) {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).join(", ");
}

function TagField({
  label,
  value,
  allTags,
  newTag,
  emptyLabel,
  placeholder,
  onChange,
  onNewTagChange,
  onAddTag,
  styles,
}: {
  label: string;
  value: string;
  allTags: string[];
  newTag: string;
  emptyLabel: string;
  placeholder: string;
  onChange: (value: string) => void;
  onNewTagChange: (value: string) => void;
  onAddTag: (tag: string) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const selectedTags = splitEditableList(value);
  const tagOptions = Array.from(new Set([...allTags, ...selectedTags]));
  const selectedSet = new Set(selectedTags);
  const toggleTag = (tag: string) => {
    onChange(
      selectedSet.has(tag)
        ? joinTags(selectedTags.filter((item) => item !== tag))
        : joinTags([...selectedTags, tag]),
    );
  };
  const submitNewTag = () => {
    const tag = newTag.trim();
    if (!tag) return;
    onAddTag(tag);
  };

  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
      </View>
      <View style={styles.tagPanel}>
        {tagOptions.length > 0 ? (
          <View style={styles.tagChipWrap}>
            {tagOptions.map((tag) => {
              const selected = selectedSet.has(tag);
              return (
                <TouchableOpacity
                  key={tag}
                  style={[styles.tagChip, selected && styles.tagChipSelected]}
                  activeOpacity={0.82}
                  onPress={() => toggleTag(tag)}
                >
                  <Text style={[styles.tagChipText, selected && styles.tagChipTextSelected]}>
                    {tag}
                  </Text>
                  {selected ? (
                    <CheckIcon size={12} color={styles.tagChipTextSelected.color} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <Text style={styles.emptyTagsText}>{emptyLabel}</Text>
        )}
        <View style={styles.newTagRow}>
          <PlusIcon size={15} color={styles.fieldLabel.color} />
          <TextInput
            style={styles.newTagInput}
            value={newTag}
            placeholder={placeholder}
            placeholderTextColor={styles.placeholder.color}
            returnKeyType="done"
            onChangeText={onNewTagChange}
            onSubmitEditing={submitNewTag}
          />
          {newTag.trim().length > 0 ? (
            <TouchableOpacity style={styles.newTagAdd} activeOpacity={0.82} onPress={submitNewTag}>
              <CheckIcon size={14} color={styles.newTagAddIcon.color} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function MetaItem({
  label,
  value,
  styles,
  last,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
  last?: boolean;
}) {
  return (
    <View style={[styles.metaItem, last && styles.metaItemLast]}>
      <Text style={styles.metaItemLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.metaItemValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1 },
    flex: { flex: 1 },
    scrollContent: {
      width: "100%",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: 64,
      gap: 26,
    },
    heroStage: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: spacing.lg,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withOpacity(colors.border, 0.82),
    },
    coverColumn: {
      width: 108,
      alignItems: "center",
      gap: spacing.sm,
    },
    coverStack: {
      width: 104,
      height: 150,
      position: "relative",
      justifyContent: "center",
    },
    coverShadow: {
      position: "absolute",
      left: 12,
      right: 4,
      bottom: 3,
      height: 122,
      borderRadius: radius.md,
      backgroundColor: "#000",
      opacity: 0.12,
      transform: [{ rotate: "-3deg" }],
    },
    cover: {
      width: 96,
      height: 140,
      overflow: "hidden",
      borderRadius: radius.sm,
      backgroundColor: colors.muted,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.16,
      shadowRadius: 18,
      elevation: 6,
    },
    coverImage: {
      width: "100%",
      height: "100%",
    },
    coverFallback: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.md,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    coverFallbackTitle: {
      color: colors.foreground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      textAlign: "center",
      lineHeight: 18,
    },
    coverFallbackAuthor: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      textAlign: "center",
      marginTop: spacing.md,
    },
    coverActions: {
      width: "100%",
      flexDirection: "row",
      gap: spacing.xs,
    },
    coverAction: {
      flex: 1,
      minHeight: 28,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.92),
      backgroundColor: withOpacity(colors.card, 0.68),
      paddingHorizontal: spacing.xs,
    },
    coverActionDisabled: {
      opacity: 0.42,
    },
    coverActionText: {
      color: colors.foreground,
      fontSize: 10,
      fontWeight: fontWeight.medium,
    },
    heroCopy: {
      flex: 1,
      minWidth: 0,
      paddingBottom: 2,
    },
    heroTitleText: {
      color: colors.foreground,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      lineHeight: 25,
      minHeight: 52,
    },
    heroTitlePlaceholder: {
      color: withOpacity(colors.mutedForeground, 0.72),
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      lineHeight: 25,
      minHeight: 52,
    },
    heroAuthorText: {
      marginTop: 7,
      color: colors.mutedForeground,
      fontSize: fontSize.sm,
      lineHeight: 19,
      minHeight: 24,
    },
    heroAuthorPlaceholder: {
      marginTop: 7,
      color: withOpacity(colors.mutedForeground, 0.72),
      fontSize: fontSize.sm,
      lineHeight: 19,
      minHeight: 24,
    },
    heroInlineInput: {
      width: "100%",
      margin: 0,
      padding: 0,
      backgroundColor: "transparent",
    },
    heroInputPlaceholder: {
      color: withOpacity(colors.mutedForeground, 0.72),
    },
    ratingBlock: {
      marginTop: spacing.md,
    },
    ratingRow: {
      minHeight: 34,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    ratingButton: {
      width: 30,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.sm,
      backgroundColor: withOpacity(colors.card, 0.58),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.72),
    },
    ratingButtonActive: {
      borderColor: withOpacity(colors.primary, 0.42),
      backgroundColor: withOpacity(colors.primary, 0.12),
    },
    ratingValue: {
      marginLeft: spacing.xs,
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
    },
    progressBlock: {
      marginTop: spacing.lg,
      gap: 7,
    },
    progressTrack: {
      height: 3,
      overflow: "hidden",
      borderRadius: radius.full,
      backgroundColor: colors.muted,
    },
    progressFill: {
      height: "100%",
      borderRadius: radius.full,
      backgroundColor: colors.primary,
    },
    progressText: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      fontVariant: ["tabular-nums"],
    },
    metaStrip: {
      flexDirection: "row",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.8),
    },
    metaItem: {
      flex: 1,
      minWidth: 0,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: withOpacity(colors.border, 0.72),
    },
    metaItemLast: {
      borderRightWidth: 0,
    },
    metaItemLabel: {
      color: colors.mutedForeground,
      fontSize: 10,
      fontWeight: fontWeight.medium,
      marginBottom: 3,
    },
    metaItemValue: {
      color: colors.foreground,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
      flexShrink: 1,
    },
    tabBar: {
      flexDirection: "row",
      gap: 4,
      padding: 4,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.82),
      backgroundColor: withOpacity(colors.muted, 0.16),
    },
    tabButton: {
      flex: 1,
      minHeight: 40,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      borderRadius: radius.sm,
    },
    tabButtonActive: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.72),
      backgroundColor: withOpacity(colors.card, 0.88),
    },
    tabButtonText: {
      color: colors.mutedForeground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
    },
    tabButtonTextActive: {
      color: colors.foreground,
      fontWeight: fontWeight.semibold,
    },
    tabCountBadge: {
      minWidth: 18,
      height: 18,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.sm,
      backgroundColor: withOpacity(colors.mutedForeground, 0.1),
      paddingHorizontal: 5,
    },
    tabCountBadgeActive: {
      backgroundColor: withOpacity(colors.primary, 0.12),
    },
    tabCount: {
      color: colors.mutedForeground,
      fontSize: 10,
      fontWeight: fontWeight.semibold,
      textAlign: "center",
      fontVariant: ["tabular-nums"],
    },
    tabCountActive: {
      color: colors.primary,
    },
    tabContent: {
      gap: spacing.lg,
    },
    editorPanel: {
      overflow: "hidden",
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.72),
      backgroundColor: withOpacity(colors.card, 0.46),
    },
    field: {
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.lg,
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withOpacity(colors.border, 0.72),
      gap: 9,
    },
    fieldLabel: {
      color: colors.mutedForeground,
      fontSize: 11,
      fontWeight: fontWeight.medium,
    },
    fieldHeader: {
      minHeight: 18,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    infoRow: {
      minHeight: 54,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withOpacity(colors.border, 0.58),
    },
    infoRowLast: {
      borderBottomWidth: 0,
    },
    infoRowEditing: {
      backgroundColor: withOpacity(colors.primary, 0.07),
    },
    infoRowLabelWrap: {
      width: 92,
      minWidth: 92,
    },
    infoRowLabel: {
      color: colors.mutedForeground,
      fontSize: 11,
      fontWeight: fontWeight.medium,
      letterSpacing: 0,
    },
    infoRowValueWrap: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 6,
    },
    infoRowInput: {
      flex: 1,
      minHeight: 36,
      margin: 0,
      paddingHorizontal: spacing.sm,
      paddingVertical: 0,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.primary, 0.28),
      backgroundColor: withOpacity(colors.background, 0.46),
      color: colors.foreground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      textAlign: "right",
    },
    infoRowValue: {
      flexShrink: 1,
      color: colors.foreground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      textAlign: "right",
    },
    infoRowPlaceholder: {
      color: withOpacity(colors.mutedForeground, 0.72),
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      textAlign: "right",
    },
    infoRowAffordance: {
      color: withOpacity(colors.mutedForeground, 0.48),
    },
    monospaceValue: {
      fontVariant: ["tabular-nums"],
    },
    reviewsList: {
      gap: spacing.sm,
    },
    reviewsEmptyCard: {
      minHeight: 128,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderStyle: "dashed",
      borderColor: withOpacity(colors.border, 0.9),
      backgroundColor: withOpacity(colors.card, 0.26),
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.xl,
    },
    reviewsEmptyText: {
      color: colors.mutedForeground,
      fontSize: fontSize.sm,
      lineHeight: 20,
      textAlign: "center",
    },
    inlineTextButton: {
      minHeight: 30,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      backgroundColor: withOpacity(colors.primary, 0.08),
    },
    inlineTextButtonText: {
      color: colors.primary,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
    },
    longTextCard: {
      position: "relative",
      overflow: "hidden",
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.66),
      backgroundColor: withOpacity(colors.card, 0.42),
    },
    longTextToolbar: {
      position: "absolute",
      top: spacing.sm,
      right: spacing.sm,
      zIndex: 3,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.66),
      backgroundColor: withOpacity(colors.background, 0.9),
      padding: 2,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.07,
      shadowRadius: 8,
      elevation: 2,
    },
    longTextContent: {
      position: "relative",
      backgroundColor: withOpacity(colors.background, 0.08),
    },
    longTextMeta: {
      paddingRight: 104,
      marginBottom: spacing.sm,
      color: colors.mutedForeground,
      fontSize: 10,
      fontVariant: ["tabular-nums"],
    },
    longTextIconButton: {
      width: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.sm,
    },
    longTextAction: {
      minHeight: 28,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
    },
    longTextActionText: {
      color: colors.primary,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
    },
    longTextBody: {
      minHeight: 112,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: spacing.lg,
    },
    longTextBodyWithToolbar: {
      paddingRight: 112,
    },
    longTextDisplay: {
      color: colors.foreground,
      fontSize: fontSize.sm,
      lineHeight: 20,
    },
    longTextPlaceholder: {
      color: withOpacity(colors.mutedForeground, 0.72),
      fontSize: fontSize.sm,
      lineHeight: 20,
    },
    sheetRoot: {
      flex: 1,
      justifyContent: "flex-end",
    },
    sheetOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.42)",
    },
    textSheet: {
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.86),
      backgroundColor: colors.card,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: Platform.OS === "ios" ? 34 : spacing.lg,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -12 },
      shadowOpacity: 0.2,
      shadowRadius: 22,
      elevation: 18,
    },
    textSheetTall: {
      height: "68%",
      minHeight: 430,
    },
    pickerSheet: {
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.86),
      backgroundColor: colors.card,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: Platform.OS === "ios" ? 34 : spacing.lg,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -12 },
      shadowOpacity: 0.2,
      shadowRadius: 22,
      elevation: 18,
    },
    pickerSheetSurface: {
      overflow: "hidden",
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.82),
      backgroundColor: withOpacity(colors.background, 0.38),
    },
    sheetHandle: {
      alignSelf: "center",
      width: 38,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: withOpacity(colors.mutedForeground, 0.28),
      marginBottom: spacing.sm,
    },
    textSheetHeader: {
      minHeight: 42,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    textSheetTitle: {
      flex: 1,
      color: colors.foreground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      textAlign: "center",
    },
    textSheetGhostButton: {
      minWidth: 54,
      minHeight: 34,
      alignItems: "flex-start",
      justifyContent: "center",
    },
    textSheetGhostButtonText: {
      color: colors.mutedForeground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
    },
    textSheetDoneButton: {
      minWidth: 54,
      minHeight: 34,
      alignItems: "flex-end",
      justifyContent: "center",
    },
    textSheetDoneButtonText: {
      color: colors.primary,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    textSheetInput: {
      minHeight: 44,
      marginTop: spacing.sm,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.86),
      backgroundColor: withOpacity(colors.background, 0.72),
      color: colors.foreground,
      fontSize: fontSize.base,
      lineHeight: 22,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    textSheetMultilineInput: {
      flex: 1,
      minHeight: 300,
      textAlignVertical: "top",
    },
    placeholder: {
      color: colors.mutedForeground,
    },
    segmentRow: {
      flexDirection: "row",
      gap: spacing.xs,
      padding: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withOpacity(colors.border, 0.62),
    },
    segmentButton: {
      flex: 1,
      minHeight: 32,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.sm,
      backgroundColor: "transparent",
    },
    segmentButtonActive: {
      backgroundColor: withOpacity(colors.primary, 0.14),
    },
    segmentText: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
    },
    segmentTextActive: {
      color: colors.primary,
      fontWeight: fontWeight.semibold,
    },
    datePickerColumns: {
      height: 200,
      flexDirection: "row",
      gap: spacing.sm,
      padding: spacing.sm,
    },
    pickerWheel: {
      flex: 1,
      minWidth: 0,
      position: "relative",
      overflow: "hidden",
      borderRadius: radius.sm,
      backgroundColor: withOpacity(colors.background, 0.46),
    },
    nativePicker: {
      width: "100%",
      height: 200,
    },
    pickerItem: {
      color: colors.foreground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
    },
    tagPanel: {
      overflow: "hidden",
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.72),
      backgroundColor: withOpacity(colors.card, 0.42),
      paddingTop: spacing.md,
    },
    tagChipWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
    },
    tagChip: {
      minHeight: 30,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.82),
      backgroundColor: withOpacity(colors.background, 0.42),
      paddingHorizontal: spacing.sm,
    },
    tagChipSelected: {
      borderColor: withOpacity(colors.primary, 0.38),
      backgroundColor: withOpacity(colors.primary, 0.1),
    },
    tagChipText: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
    },
    tagChipTextSelected: {
      color: colors.primary,
      fontWeight: fontWeight.semibold,
    },
    emptyTagsText: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withOpacity(colors.border, 0.62),
    },
    newTagRow: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withOpacity(colors.border, 0.58),
      backgroundColor: withOpacity(colors.background, 0.22),
    },
    newTagInput: {
      flex: 1,
      minHeight: 40,
      color: colors.foreground,
      fontSize: fontSize.sm,
      paddingVertical: 0,
    },
    newTagAdd: {
      width: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.sm,
      backgroundColor: colors.primary,
    },
    newTagAddIcon: {
      color: colors.primaryForeground,
    },
    missingWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xxl,
    },
    missingText: {
      color: colors.mutedForeground,
      fontSize: fontSize.sm,
    },
  });
