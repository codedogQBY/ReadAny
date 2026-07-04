import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useResolvedSrc } from "@/hooks/use-resolved-src";
import { extractLocalBookMetadata } from "@/lib/book/auto-metadata";
import { useLibraryStore } from "@/stores/library-store";
import type { Book, BookReview } from "@readany/core/types";
import {
  type BookMetadataFormValues,
  buildBookMetadataUpdate,
  cn,
  createBookMetadataFormValues,
  createEmptyBookReview,
  getBookProgressPercent,
  hasMissingBookMetadataAutoFillTargets,
  mergeMissingBookMetadataValues,
  splitEditableList,
} from "@readany/core/utils";
import type { TFunction } from "i18next";
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  Cloud,
  Database,
  FileText,
  Folder,
  HardDrive,
  ImagePlus,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface BookDetailsDialogProps {
  book: Book | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NO_GROUP = "__none__";
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
const NO_LANGUAGE = "__none__";
const DATE_PRECISIONS = ["year", "month", "day"] as const;
type DatePrecision = (typeof DATE_PRECISIONS)[number];
const WHEEL_ITEM_HEIGHT = 40;
const WHEEL_LOOP_REPEAT = 21;
const WHEEL_LOOP_CENTER_REPEAT = Math.floor(WHEEL_LOOP_REPEAT / 2);
const YEAR_OPTIONS = Array.from({ length: 220 }, (_, index) =>
  String(new Date().getFullYear() + 5 - index),
);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
type DetailsTab = "basic" | "reviews";

function statusLabel(status: Book["syncStatus"], t: TFunction) {
  if (status === "remote") return t("library.detailsSyncRemote", "Remote only");
  if (status === "downloading") return t("library.detailsSyncDownloading", "Downloading");
  return t("library.detailsSyncLocal", "Local");
}

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
  return new Intl.DateTimeFormat(locale, { year: "numeric" }).format(new Date(Number(year), 0, 1));
}

function datePrecisionLabel(precision: DatePrecision, t: TFunction) {
  if (precision === "day") return t("library.detailsDatePrecisionDay", "Exact date");
  if (precision === "month") return t("library.detailsDatePrecisionMonth", "Year and month");
  return t("library.detailsDatePrecisionYear", "Year only");
}

function formatBookDate(value: number | undefined, locale: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  } catch {
    return "—";
  }
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

function createComparableMetadataValues(values: BookMetadataFormValues) {
  return {
    title: values.title.trim(),
    author: values.author.trim(),
    coverUrl: values.coverUrl.trim(),
    publisher: values.publisher.trim(),
    language: values.language.trim(),
    isbn: values.isbn.trim(),
    publishDate: values.publishDate.trim(),
    rating: values.rating,
    description: values.description.trim(),
    reviews: values.reviews
      .map((review) => ({ id: review.id, content: review.content.trim() }))
      .filter((review) => review.content),
    subjects: splitEditableList(values.subjectsText),
    tags: splitEditableList(values.tagsText),
    groupId: values.groupId || "",
  };
}

export function BookDetailsDialog({ book, open, onOpenChange }: BookDetailsDialogProps) {
  const { t, i18n } = useTranslation();
  const groups = useLibraryStore((state) => state.groups);
  const allTags = useLibraryStore((state) => state.allTags);
  const addTag = useLibraryStore((state) => state.addTag);
  const updateBook = useLibraryStore((state) => state.updateBook);
  const [values, setValues] = useState<BookMetadataFormValues | null>(null);
  const [newTag, setNewTag] = useState("");
  const [editingBasics, setEditingBasics] = useState(false);
  const [editingTitleField, setEditingTitleField] = useState<"title" | "author" | null>(null);
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailsTab>("basic");
  const coverSrc = useResolvedSrc(values?.coverUrl);
  const hydratedBookIdRef = useRef<string | null>(null);
  const autoFilledBookIdRef = useRef<string | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      hydratedBookIdRef.current = null;
      autoFilledBookIdRef.current = null;
      setEditingBasics(false);
      setEditingTitleField(null);
      setEditingReviewId(null);
      setActiveTab("basic");
      return;
    }
    if (!book) return;
    if (hydratedBookIdRef.current === book.id) return;
    hydratedBookIdRef.current = book.id;
    setValues(createBookMetadataFormValues(book));
    setEditingBasics(false);
    setEditingTitleField(null);
    setEditingReviewId(null);
    setActiveTab("basic");
  }, [book, open]);

  useEffect(() => {
    if (!open || !book || !values) return;
    if (autoFilledBookIdRef.current === book.id) return;
    if (!hasMissingBookMetadataAutoFillTargets(values)) return;
    autoFilledBookIdRef.current = book.id;

    let cancelled = false;
    void extractLocalBookMetadata(book).then((metadata) => {
      if (cancelled || !metadata) return;
      setValues((current) => {
        if (!current) return current;
        return mergeMissingBookMetadataValues(current, metadata) ?? current;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [book, open, values]);

  const groupName = useMemo(() => {
    const groupId = values?.groupId ?? book?.groupId;
    if (!groupId) return t("sidebar.uncategorized", "Uncategorized");
    return groups.find((group) => group.id === groupId)?.name ?? t("library.group", "Group");
  }, [book?.groupId, groups, t, values?.groupId]);

  useEffect(() => {
    if (!open || !book || !values) return;
    const currentValues = createComparableMetadataValues(values);
    const persistedValues = createComparableMetadataValues(createBookMetadataFormValues(book));
    if (JSON.stringify(currentValues) === JSON.stringify(persistedValues)) return;

    if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      updateBook(book.id, buildBookMetadataUpdate(book, values));
      autoSaveTimerRef.current = null;
    }, 450);

    return () => {
      if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
    };
  }, [book, open, updateBook, values]);

  if (!book || !values) return null;

  const persistValues = (nextValues: BookMetadataFormValues) => {
    updateBook(book.id, buildBookMetadataUpdate(book, nextValues));
  };

  const hasMetadataChanges = (nextValues: BookMetadataFormValues) => {
    const currentValues = createComparableMetadataValues(nextValues);
    const persistedValues = createComparableMetadataValues(createBookMetadataFormValues(book));
    return JSON.stringify(currentValues) !== JSON.stringify(persistedValues);
  };

  const setField = <K extends keyof BookMetadataFormValues>(
    field: K,
    value: BookMetadataFormValues[K],
  ) => {
    setValues((current) => (current ? { ...current, [field]: value } : current));
  };

  const persistCoverUrl = async (coverUrl: string) => {
    setField("coverUrl", coverUrl);
    await updateBook(book.id, {
      meta: {
        ...book.meta,
        coverUrl,
      },
    });
  };

  const setRating = (rating: number) => {
    setField("rating", values.rating === rating ? null : rating);
  };

  const addReview = () => {
    const review = createEmptyBookReview();
    setField("reviews", [...values.reviews, review]);
    return review.id;
  };

  const handleAddReview = () => {
    const reviewId = addReview();
    setActiveTab("reviews");
    setEditingReviewId(reviewId);
  };

  const updateReview = (reviewId: string, content: string) => {
    setField(
      "reviews",
      values.reviews.map((review) => (review.id === reviewId ? { ...review, content } : review)),
    );
  };

  const removeReview = (reviewId: string) => {
    setField(
      "reviews",
      values.reviews.filter((review) => review.id !== reviewId),
    );
  };

  const progressPct = getBookProgressPercent(book.progress);
  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && values && hasMetadataChanges(values)) {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      persistValues(values);
    }
    onOpenChange(nextOpen);
  };

  const toggleBasicEditing = () => {
    if (editingBasics && hasMetadataChanges(values)) {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      persistValues(values);
    }
    setEditingBasics((current) => !current);
  };

  const handleChangeCover = async () => {
    try {
      const [{ open }, { copyFile, mkdir }, { join }, { getDesktopLibraryRoot }] =
        await Promise.all([
          import("@tauri-apps/plugin-dialog"),
          import("@tauri-apps/plugin-fs"),
          import("@tauri-apps/api/path"),
          import("@/lib/storage/desktop-library-root"),
        ]);
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Images",
            extensions: ["jpg", "jpeg", "png", "webp"],
          },
        ],
      });
      if (!selected || Array.isArray(selected)) return;

      const ext = selected.split(".").pop()?.toLowerCase();
      const safeExt = ext === "jpeg" ? "jpg" : ext || "jpg";
      const libraryRoot = await getDesktopLibraryRoot();
      const coversDir = await join(libraryRoot, "covers");
      await mkdir(coversDir, { recursive: true });
      const relativePath = `covers/${book.id}-custom-${Date.now()}.${safeExt}`;
      await copyFile(selected, await join(libraryRoot, relativePath));
      await persistCoverUrl(relativePath);
      toast.success(t("library.detailsCoverSaved", "Cover saved"));
    } catch (err) {
      console.warn("[BookDetailsDialog] Failed to change cover:", err);
      toast.error(t("common.failed", "Failed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="h-[min(92vh,820px)] max-h-[calc(100vh-24px)] w-[min(1120px,calc(100vw-24px))] max-w-none overflow-hidden p-0">
        <div className="grid h-full min-h-0 grid-cols-[230px_minmax(0,1fr)] bg-background max-lg:grid-cols-[200px_minmax(0,1fr)] max-md:grid-cols-1">
          <aside className="min-h-0 overflow-y-auto border-r bg-gradient-to-b from-muted/25 via-background to-background px-4 py-5 max-md:hidden">
            <div className="mx-auto w-40 max-lg:w-32">
              <div className="book-cover-shadow relative aspect-[28/41] overflow-hidden rounded-md border bg-muted">
                {coverSrc ? (
                  <img src={coverSrc} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-b from-muted to-background p-4 text-center">
                    <FileText className="size-8 text-muted-foreground" />
                    <div className="line-clamp-4 text-sm font-semibold text-foreground">
                      {book.meta.title}
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-3 overflow-hidden rounded-md border bg-background/80">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start rounded-none border-b px-3 text-xs"
                  onClick={() => void handleChangeCover()}
                >
                  <ImagePlus className="size-3.5" />
                  {t("library.detailsChangeCover", "Change cover")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start rounded-none px-3 text-xs text-muted-foreground"
                  onClick={() => void persistCoverUrl("")}
                  disabled={!values.coverUrl && !book.meta.coverUrl}
                >
                  <Trash2 className="size-3.5" />
                  {t("library.detailsClearCover", "Clear cover")}
                </Button>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <div className="rounded-lg border bg-card/45 p-3 shadow-sm">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-muted-foreground">
                    {t("library.detailsProgress", "Progress")}
                  </span>
                  <span className="tabular-nums font-medium text-foreground">{progressPct}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {t(
                    "library.detailsProgressHint",
                    "Keep metadata complete so notes and search stay easier to use.",
                  )}
                </p>
              </div>

              <div className="space-y-2.5 rounded-lg border bg-card/45 p-3 shadow-sm">
                <InfoRow
                  icon={<Cloud className="size-3.5" />}
                  label={t("library.detailsSync", "Sync")}
                  value={statusLabel(book.syncStatus, t)}
                />
                <InfoRow
                  icon={<Folder className="size-3.5" />}
                  label={t("library.group", "Group")}
                  value={groupName}
                />
                <InfoRow
                  icon={<BookOpen className="size-3.5" />}
                  label={t("library.detailsReadingStatus", "Reading status")}
                  value={
                    progressPct > 0
                      ? t("library.detailsReading", "Reading")
                      : t("library.detailsUnread", "Unread")
                  }
                />
                <InfoRow
                  icon={<HardDrive className="size-3.5" />}
                  label={t("library.detailsFormat", "Format")}
                  value={book.format.toUpperCase()}
                />
                <InfoRow
                  icon={<Database className="size-3.5" />}
                  label={t("library.detailsVector", "Vector")}
                  value={
                    book.isVectorized
                      ? t("home.vec_indexed", "Indexed")
                      : t("home.notVectorized", "Not vectorized")
                  }
                />
                <InfoRow
                  icon={<CalendarDays className="size-3.5" />}
                  label={t("library.detailsAddedAt", "Added")}
                  value={formatBookDate(book.addedAt, i18n.language)}
                />
                <InfoRow
                  icon={<CalendarDays className="size-3.5" />}
                  label={t("library.detailsUpdatedAt", "Updated")}
                  value={formatBookDate(book.updatedAt, i18n.language)}
                />
              </div>
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col">
            <DialogHeader className="shrink-0 border-b px-6 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <DialogTitle className="text-base font-semibold">
                    {t("library.detailsTitle", "Book Details")}
                  </DialogTitle>
                  <DialogDescription className="sr-only">
                    {t("library.detailsDesc", "Edit book metadata.")}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <section className="mx-auto max-w-4xl space-y-4">
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0 flex-1">
                    <div className="max-w-3xl space-y-1">
                      <InlineTitleEdit
                        value={values.title}
                        editing={editingTitleField === "title"}
                        className="text-2xl font-semibold leading-tight text-foreground md:text-3xl"
                        placeholder={t("library.detailsBookTitle", "Title")}
                        onStartEdit={() => setEditingTitleField("title")}
                        onDone={() => setEditingTitleField(null)}
                        onChange={(value) => setField("title", value)}
                      />
                      <InlineTitleEdit
                        value={values.author}
                        editing={editingTitleField === "author"}
                        className="text-base text-muted-foreground"
                        placeholder={t("library.detailsUnknownAuthor", "Unknown author")}
                        onStartEdit={() => setEditingTitleField("author")}
                        onDone={() => setEditingTitleField(null)}
                        onChange={(value) => setField("author", value)}
                      />
                    </div>
                    <RatingField
                      className="mt-4"
                      label={t("library.detailsRating", "Rating")}
                      noRatingLabel={t("library.detailsNoRating", "Not rated")}
                      value={values.rating}
                      onChange={setRating}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="inline-flex items-center rounded-lg border bg-muted/20 p-1">
                    <DetailsTabButton
                      active={activeTab === "basic"}
                      label={t("library.detailsTabBasic", "Basic info")}
                      onClick={() => setActiveTab("basic")}
                    />
                    <DetailsTabButton
                      active={activeTab === "reviews"}
                      label={t("library.detailsTabReviews", "Reviews")}
                      count={values.reviews.filter((review) => review.content.trim()).length}
                      onClick={() => setActiveTab("reviews")}
                    />
                  </div>
                  {activeTab === "basic" ? (
                    <Button
                      type="button"
                      variant={editingBasics ? "outline" : "ghost"}
                      size="sm"
                      className="h-8 shrink-0 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={toggleBasicEditing}
                    >
                      {editingBasics
                        ? t("common.done", "Done")
                        : t("library.detailsEditBasicInfo", "Edit basic info")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={handleAddReview}
                    >
                      <Plus className="size-3.5" />
                      {t("library.detailsAddReview", "Add review")}
                    </Button>
                  )}
                </div>

                {activeTab === "basic" ? (
                  <>
                    <div className="overflow-hidden rounded-lg border bg-card/40 shadow-sm">
                      <div className="grid grid-cols-2 divide-x">
                        <div className="space-y-0.5 py-2">
                          {editingBasics ? (
                            <>
                              <InlineTextRow
                                label={t("library.detailsPublisher", "Publisher")}
                                value={values.publisher}
                                onChange={(value) => setField("publisher", value)}
                              />
                              <PublishDateField
                                label={t("library.detailsPublishDate", "Publish date")}
                                value={values.publishDate}
                                onChange={(value) => setField("publishDate", value)}
                                t={t}
                                locale={i18n.language}
                              />
                              <InlineTextRow
                                label={t("library.detailsIsbn", "ISBN")}
                                value={values.isbn}
                                inputClassName="font-mono"
                                onChange={(value) => setField("isbn", value)}
                              />
                            </>
                          ) : (
                            <>
                              <SummaryRow
                                label={t("library.detailsPublisher", "Publisher")}
                                value={values.publisher || "—"}
                              />
                              <SummaryRow
                                label={t("library.detailsPublishDate", "Publish date")}
                                value={formatPublishDate(values.publishDate, i18n.language)}
                              />
                              <SummaryRow
                                label={t("library.detailsIsbn", "ISBN")}
                                value={values.isbn || "—"}
                              />
                            </>
                          )}
                        </div>
                        <div className="space-y-0.5 py-2">
                          {editingBasics ? (
                            <>
                              <InlineFieldRow label={t("library.detailsLanguage", "Language")}>
                                <LanguageSelect
                                  value={values.language}
                                  onChange={(value) => setField("language", value)}
                                />
                              </InlineFieldRow>
                              <InlineFieldRow label={t("library.detailsTags", "Tags")}>
                                <TagSelector
                                  value={values.tagsText}
                                  allTags={allTags}
                                  newTag={newTag}
                                  emptyLabel={t("sidebar.noTags", "No tags yet")}
                                  placeholder={t("sidebar.tagPlaceholder", "Tag name")}
                                  onChange={(value) => setField("tagsText", value)}
                                  onNewTagChange={setNewTag}
                                  onAddTag={(tag) => {
                                    addTag(tag);
                                    setField(
                                      "tagsText",
                                      joinTags([...splitEditableList(values.tagsText), tag]),
                                    );
                                    setNewTag("");
                                  }}
                                />
                              </InlineFieldRow>
                              <InlineFieldRow label={t("library.group", "Group")}>
                                <Select
                                  value={values.groupId || NO_GROUP}
                                  onValueChange={(value) =>
                                    setField("groupId", value === NO_GROUP ? "" : value)
                                  }
                                >
                                  <SelectTrigger
                                    className={cn(
                                      inlineEditableControlClass,
                                      "h-8 w-full shadow-none focus:ring-0",
                                    )}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={NO_GROUP}>
                                      {t("sidebar.uncategorized", "Uncategorized")}
                                    </SelectItem>
                                    {groups.map((group) => (
                                      <SelectItem key={group.id} value={group.id}>
                                        {group.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </InlineFieldRow>
                            </>
                          ) : (
                            <>
                              <SummaryRow
                                label={t("library.detailsLanguage", "Language")}
                                value={
                                  LANGUAGE_PRESETS.find(
                                    (option) => option.value === values.language,
                                  )?.label || "—"
                                }
                              />
                              <SummaryRow
                                label={t("library.detailsTags", "Tags")}
                                valueNode={<TagSummary tags={splitEditableList(values.tagsText)} />}
                                onClick={() => setEditingBasics(true)}
                              />
                              <SummaryRow
                                label={t("library.group", "Group")}
                                value={groupName}
                                onClick={() => setEditingBasics(true)}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <EditableTextCard
                      label={t("library.detailsDescription", "Description")}
                      value={values.description}
                      placeholder={t(
                        "library.detailsDescriptionPlaceholder",
                        "Add a short summary",
                      )}
                      editLabel={t("library.detailsEditDescription", "Edit description")}
                      doneLabel={t("common.done", "Done")}
                      onChange={(value) => setField("description", value)}
                    />
                  </>
                ) : (
                  <div className="space-y-4">
                    <ReviewsField
                      placeholder={t("library.detailsReviewPlaceholder", "Write your thoughts")}
                      editLabel={t("common.edit", "Edit")}
                      doneLabel={t("common.done", "Done")}
                      removeLabel={t("library.detailsRemoveReview", "Remove review")}
                      reviews={values.reviews}
                      locale={i18n.language}
                      editingId={editingReviewId}
                      onEditingIdChange={setEditingReviewId}
                      onAdd={handleAddReview}
                      onUpdate={updateReview}
                      onRemove={removeReview}
                    />
                  </div>
                )}
              </section>
            </div>

            <DialogFooter className="shrink-0 border-t bg-background/95 px-6 py-3">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.close", "Close")}
              </Button>
            </DialogFooter>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 text-muted-foreground">{label}</span>
      <span className="max-w-32 truncate text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

function InlineTitleEdit({
  value,
  editing,
  className,
  placeholder,
  onStartEdit,
  onDone,
  onChange,
}: {
  value: string;
  editing: boolean;
  className: string;
  placeholder: string;
  onStartEdit: () => void;
  onDone: () => void;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(value.length, value.length);
    });
  }, [editing, value.length]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        className={cn(
          "block h-auto w-full min-w-0 rounded-none border-0 bg-transparent p-0 outline-none ring-0 placeholder:text-muted-foreground/70 focus:ring-0",
          className,
        )}
        placeholder={placeholder}
        onBlur={onDone}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onDone();
          if (event.key === "Escape") onDone();
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "block max-w-full cursor-text truncate rounded-sm text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/25",
        className,
      )}
      onClick={onStartEdit}
    >
      {value || placeholder}
    </button>
  );
}

function SummaryRow({
  label,
  value,
  valueNode,
  onClick,
}: {
  label: string;
  value?: string;
  valueNode?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="w-24 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      {valueNode ?? (
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{value}</span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className="flex h-10 w-full cursor-pointer items-center gap-3 px-5 text-left transition-colors hover:bg-background/70"
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return <div className="flex h-10 items-center gap-3 px-5">{content}</div>;
}

function TagSummary({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return <span className="min-w-0 flex-1 text-sm font-medium text-foreground">—</span>;
  }
  const visibleTags = tags.slice(0, 3);
  const hiddenCount = tags.length - visibleTags.length;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
      {visibleTags.map((tag) => (
        <span
          key={tag}
          className="max-w-24 truncate rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
        >
          {tag}
        </span>
      ))}
      {hiddenCount > 0 ? (
        <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
          +{hiddenCount}
        </span>
      ) : null}
    </span>
  );
}

function DetailsTabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 min-w-28 cursor-pointer items-center justify-center gap-2 rounded-md px-4 text-xs font-medium text-muted-foreground transition-colors",
        active && "bg-background text-foreground shadow-sm",
      )}
      onClick={onClick}
    >
      <span>{label}</span>
      {count !== undefined && count > 0 ? (
        <span
          className={cn(
            "rounded-sm px-1.5 py-0.5 text-[10px] leading-none",
            active ? "bg-primary/12 text-primary" : "bg-background/70 text-muted-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function InlineFieldRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-center gap-3 px-5">
      <span className="w-24 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const inlineEditableControlClass =
  "rounded-md border border-border/70 bg-background/65 px-2 shadow-inner transition-colors hover:border-primary/30 focus-within:border-primary/45 focus-within:bg-background focus-within:ring-1 focus-within:ring-primary/15";

function InlineTextRow({
  label,
  value,
  placeholder,
  inputClassName,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  inputClassName?: string;
  onChange: (value: string) => void;
}) {
  return (
    <InlineFieldRow label={label}>
      <input
        value={value}
        className={cn(
          inlineEditableControlClass,
          "h-8 w-full min-w-0 text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/70",
          inputClassName,
        )}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </InlineFieldRow>
  );
}

function PublishDateField({
  label,
  value,
  onChange,
  t,
  locale,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  t: TFunction;
  locale: string;
}) {
  const [draftPrecision, setDraftPrecision] = useState<DatePrecision>(
    value.trim() ? getDatePrecision(value) : "day",
  );
  useEffect(() => {
    if (value.trim()) setDraftPrecision(getDatePrecision(value));
  }, [value]);
  const precision = value.trim() ? getDatePrecision(value) : draftPrecision;
  const parts = normalizeDateParts(value);
  const dayOptions = Array.from({ length: getDaysInMonth(parts.year, parts.month) }, (_, index) =>
    String(index + 1).padStart(2, "0"),
  );
  const setPrecision = (nextPrecision: DatePrecision) => {
    setDraftPrecision(nextPrecision);
    if (value.trim()) onChange(buildPublishDateValue(parts, nextPrecision));
  };
  const setPart = (key: keyof ReturnType<typeof normalizeDateParts>, nextValue: string) => {
    const nextParts = { ...parts, [key]: nextValue };
    const maxDay = getDaysInMonth(nextParts.year, nextParts.month);
    if (Number(nextParts.day) > maxDay) nextParts.day = String(maxDay).padStart(2, "0");
    onChange(buildPublishDateValue(nextParts, precision));
  };

  return (
    <InlineFieldRow label={label}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className={cn(
              inlineEditableControlClass,
              "h-8 w-full justify-between font-normal hover:bg-background/65",
            )}
          >
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {formatPublishDate(value, locale)}
            </span>
            <span className="ml-3 shrink-0 text-xs text-muted-foreground">
              {datePrecisionLabel(precision, t)}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[380px] p-3" align="start">
          <div className="grid grid-cols-3 gap-1 rounded-md bg-muted/45 p-1">
            {DATE_PRECISIONS.map((item) => {
              const selected = precision === item;
              return (
                <button
                  key={item}
                  type="button"
                  className={cn(
                    "h-8 rounded-sm px-2 text-xs font-medium text-muted-foreground transition-colors",
                    selected && "bg-background text-foreground shadow-sm",
                  )}
                  onClick={() => setPrecision(item)}
                >
                  {datePrecisionLabel(item, t)}
                </button>
              );
            })}
          </div>

          <div
            className="mt-3 grid gap-3"
            style={{
              gridTemplateColumns: `repeat(${precision === "day" ? 3 : precision === "month" ? 2 : 1}, minmax(0, 1fr))`,
            }}
          >
            <DatePartColumn
              value={parts.year}
              options={YEAR_OPTIONS}
              onSelect={(year) => setPart("year", year)}
            />
            {precision !== "year" ? (
              <DatePartColumn
                value={parts.month}
                options={MONTH_OPTIONS}
                format={(month) => formatMonthLabel(month, locale)}
                onSelect={(month) => setPart("month", month)}
                loop
              />
            ) : null}
            {precision === "day" ? (
              <DatePartColumn
                value={parts.day}
                options={dayOptions}
                onSelect={(day) => setPart("day", day)}
                loop
              />
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </InlineFieldRow>
  );
}

function DatePartColumn({
  value,
  options,
  format,
  onSelect,
  loop = false,
}: {
  value: string;
  options: string[];
  format?: (value: string) => string;
  onSelect: (value: string) => void;
  loop?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef<number | null>(null);
  const selectedIndex = Math.max(0, options.indexOf(value));
  const wheelOptions = useMemo(
    () =>
      loop
        ? Array.from({ length: WHEEL_LOOP_REPEAT }, (_, repeatIndex) =>
            options.map((option, optionIndex) => ({
              key: `${repeatIndex}-${optionIndex}-${option}`,
              value: option,
            })),
          ).flat()
        : options.map((option, optionIndex) => ({
            key: `${optionIndex}-${option}`,
            value: option,
          })),
    [loop, options],
  );
  const displaySelectedIndex =
    loop && options.length > 0
      ? WHEEL_LOOP_CENTER_REPEAT * options.length + selectedIndex
      : selectedIndex;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: displaySelectedIndex * WHEEL_ITEM_HEIGHT });
  }, [displaySelectedIndex]);

  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    },
    [],
  );

  const settleSelection = () => {
    const el = scrollRef.current;
    if (!el || options.length === 0) return;
    const rawIndex = Math.round(el.scrollTop / WHEEL_ITEM_HEIGHT);
    const nextIndex = loop
      ? ((rawIndex % options.length) + options.length) % options.length
      : Math.max(0, Math.min(options.length - 1, rawIndex));
    const nextValue = options[nextIndex];
    if (nextValue !== undefined && nextValue !== value) onSelect(nextValue);

    const nextDisplayIndex =
      loop && options.length > 0
        ? WHEEL_LOOP_CENTER_REPEAT * options.length + nextIndex
        : nextIndex;
    el.scrollTo({ top: nextDisplayIndex * WHEEL_ITEM_HEIGHT });
  };

  const handleScroll = () => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(settleSelection, 90);
  };

  return (
    <div className="relative overflow-hidden rounded-md border bg-background">
      <div className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2 left-2 z-10 h-10 rounded-md bg-primary/12 ring-1 ring-primary/18" />
      <div
        ref={scrollRef}
        className="relative z-20 h-[200px] snap-y snap-mandatory overflow-y-auto overscroll-contain py-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={handleScroll}
      >
        {wheelOptions.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.key}
              type="button"
              className={cn(
                "flex h-10 w-full snap-center items-center justify-center rounded-md px-2 text-sm text-muted-foreground transition-colors",
                selected && "font-semibold text-foreground",
              )}
              onClick={() => onSelect(option.value)}
            >
              {format ? format(option.value) : option.value}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RatingField({
  label,
  noRatingLabel,
  value,
  className,
  onChange,
}: {
  label: string;
  noRatingLabel: string;
  value: number | null;
  className?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((rating) => {
          const selected = value !== null && rating <= value;
          return (
            <button
              key={rating}
              type="button"
              className="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => onChange(rating)}
              aria-label={`${label} ${rating}`}
            >
              <Star className={cn("size-4", selected && "fill-primary text-primary")} />
            </button>
          );
        })}
      </div>
      <span className="text-xs text-muted-foreground">{value ? `${value}/5` : noRatingLabel}</span>
    </div>
  );
}

function ReviewsField({
  placeholder,
  editLabel,
  doneLabel,
  removeLabel,
  reviews,
  locale,
  editingId,
  onEditingIdChange,
  onAdd,
  onUpdate,
  onRemove,
}: {
  placeholder: string;
  editLabel: string;
  doneLabel: string;
  removeLabel: string;
  reviews: BookReview[];
  locale: string;
  editingId: string | null;
  onEditingIdChange: (reviewId: string | null) => void;
  onAdd: () => void;
  onUpdate: (reviewId: string, content: string) => void;
  onRemove: (reviewId: string) => void;
}) {
  const visibleReviews = reviews.filter(
    (review) => review.content.trim() || review.id === editingId,
  );

  return (
    <section>
      <div className="grid gap-2.5">
        {visibleReviews.length === 0 ? (
          <button
            type="button"
            className="flex min-h-28 w-full cursor-pointer items-center justify-center rounded-lg border border-dashed bg-card/25 px-6 text-center text-sm text-muted-foreground transition-colors hover:border-primary/35 hover:bg-card/55 hover:text-foreground"
            onClick={onAdd}
          >
            {placeholder}
          </button>
        ) : null}
        {visibleReviews.map((review) => (
          <EditableTextCardSurface
            key={review.id}
            meta={formatReviewDate(review.updatedAt || review.createdAt, locale)}
            value={review.content}
            placeholder={placeholder}
            editLabel={editingId === review.id ? doneLabel : editLabel}
            editing={editingId === review.id}
            onEditToggle={() => onEditingIdChange(editingId === review.id ? null : review.id)}
            onChange={(value) => onUpdate(review.id, value)}
            trailingAction={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => onRemove(review.id)}
              >
                <Trash2 className="size-3" />
                <span className="sr-only">{removeLabel}</span>
              </Button>
            }
          />
        ))}
      </div>
    </section>
  );
}

function EditableTextCard({
  label,
  value,
  placeholder,
  editLabel,
  doneLabel,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  editLabel: string;
  doneLabel: string;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button
          type="button"
          variant={editing ? "outline" : "ghost"}
          size="sm"
          className="h-8 shrink-0 px-2.5 text-xs text-muted-foreground hover:text-foreground"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setEditing((current) => !current)}
        >
          {editing ? doneLabel : editLabel}
        </Button>
      </div>
      <EditableTextCardSurface
        value={value}
        placeholder={placeholder}
        editLabel={editing ? doneLabel : editLabel}
        editing={editing}
        showInlineEditAction={false}
        onEditToggle={() => setEditing((current) => !current)}
        onChange={onChange}
      />
    </section>
  );
}

function EditableTextCardSurface({
  meta,
  value,
  placeholder,
  editLabel,
  editing,
  trailingAction,
  showInlineEditAction = true,
  onEditToggle,
  onChange,
}: {
  meta?: string;
  value: string;
  placeholder: string;
  editLabel: string;
  editing: boolean;
  trailingAction?: ReactNode;
  showInlineEditAction?: boolean;
  onEditToggle: () => void;
  onChange: (value: string) => void;
}) {
  const trimmed = value.trim();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasEditingRef = useRef(false);

  useEffect(() => {
    if (!editing) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    resizeTextAreaToContent(textarea);
  }, [editing]);

  useEffect(() => {
    const justStartedEditing = editing && !wasEditingRef.current;
    wasEditingRef.current = editing;
    if (!justStartedEditing) return;
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(value.length, value.length);
    });
  }, [editing, value.length]);

  return (
    <div
      ref={surfaceRef}
      className="group relative rounded-lg border border-border/65 bg-card/45 shadow-sm transition-colors hover:border-primary/25 hover:bg-card/70 focus-within:border-primary/45 focus-within:ring-1 focus-within:ring-primary/20"
      onBlurCapture={(event) => {
        if (!editing) return;
        const nextFocus = event.relatedTarget;
        if (nextFocus instanceof Node && surfaceRef.current?.contains(nextFocus)) return;
        onEditToggle();
      }}
    >
      <div className="min-h-24 p-4">
        {meta ? <div className="mb-3 pr-24 text-xs text-muted-foreground">{meta}</div> : null}
        <div className="min-w-0 flex-1">
          {editing ? (
            <Textarea
              ref={textareaRef}
              value={value}
              className="min-h-24 resize-none overflow-y-auto rounded-md border border-border/70 bg-background/60 p-3 text-sm leading-7 shadow-inner focus-visible:ring-1 focus-visible:ring-primary/20"
              placeholder={placeholder}
              onChange={(event) => {
                resizeTextAreaToContent(event.currentTarget);
                onChange(event.target.value);
              }}
            />
          ) : (
            <button
              type="button"
              className="block min-h-20 w-full cursor-text text-left text-sm leading-7"
              onClick={onEditToggle}
            >
              {trimmed ? (
                <span className="line-clamp-[12] whitespace-pre-wrap text-foreground">
                  {trimmed}
                </span>
              ) : (
                <span className="text-muted-foreground/70">{placeholder}</span>
              )}
            </button>
          )}
        </div>
        {trailingAction || showInlineEditAction ? (
          <div className="absolute top-3 right-3 flex items-center gap-1 rounded-md border bg-background/90 p-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {trailingAction}
            {showInlineEditAction ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onEditToggle}
              >
                {editLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function resizeTextAreaToContent(textarea: HTMLTextAreaElement) {
  const maxHeight = Math.round(window.innerHeight * 0.42);
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
}

function LanguageSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value || NO_LANGUAGE}
      onValueChange={(nextValue) => onChange(nextValue === NO_LANGUAGE ? "" : nextValue)}
    >
      <SelectTrigger
        className={cn(inlineEditableControlClass, "h-8 w-full shadow-none focus:ring-0")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LANGUAGE_PRESETS.map((option) => (
          <SelectItem key={option.value || NO_LANGUAGE} value={option.value || NO_LANGUAGE}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function joinTags(tags: string[]) {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).join(", ");
}

function TagSelector({
  value,
  allTags,
  newTag,
  emptyLabel,
  placeholder,
  onChange,
  onNewTagChange,
  onAddTag,
}: {
  value: string;
  allTags: string[];
  newTag: string;
  emptyLabel: string;
  placeholder: string;
  onChange: (value: string) => void;
  onNewTagChange: (value: string) => void;
  onAddTag: (tag: string) => void;
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            inlineEditableControlClass,
            "h-8 w-full justify-between font-normal hover:bg-background/65",
          )}
        >
          <TagSummary tags={selectedTags} />
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72" align="start">
        <div className="max-h-56 overflow-y-auto">
          {tagOptions.length > 0 ? (
            tagOptions.map((tag) => (
              <DropdownMenuCheckboxItem
                key={tag}
                checked={selectedSet.has(tag)}
                onCheckedChange={() => toggleTag(tag)}
                onSelect={(event) => event.preventDefault()}
              >
                <span className="truncate">{tag}</span>
              </DropdownMenuCheckboxItem>
            ))
          ) : (
            <div className="px-2 py-2 text-xs text-muted-foreground">{emptyLabel}</div>
          )}
        </div>
        <DropdownMenuSeparator />
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Plus className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={newTag}
            className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            placeholder={placeholder}
            onChange={(event) => onNewTagChange(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") submitNewTag();
            }}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
