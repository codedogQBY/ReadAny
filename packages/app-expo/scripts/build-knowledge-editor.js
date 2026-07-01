/**
 * Build a self-contained Tiptap knowledge editor for React Native WebView.
 *
 * Run: node scripts/build-knowledge-editor.js
 */
const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const ASSETS_DIR = path.resolve(__dirname, "../assets/editor");
const TEMPLATE = path.resolve(ASSETS_DIR, "knowledge-editor.template.html");
const OUTPUT = path.resolve(ASSETS_DIR, "knowledge-editor.html");
const MARKER = "<!-- __READANY_KNOWLEDGE_EDITOR_BUNDLE_INSERT_POINT_9d5b2a7c__ -->";

async function buildKnowledgeEditor() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  const entryContent = `
    import { Editor, Node, mergeAttributes } from "@tiptap/core";
    import Link from "@tiptap/extension-link";
    import Placeholder from "@tiptap/extension-placeholder";
    import TaskItem from "@tiptap/extension-task-item";
    import TaskList from "@tiptap/extension-task-list";
    import StarterKit from "@tiptap/starter-kit";
    import {
      createReadAnyCardAttrsFromTemplate,
      createReadAnyCardReadOnlyModel,
      createReadAnyCardTiptapContent,
      formatReadAnyCardDataForEditor,
      getReadAnyCardTemplateFields,
      getVisibleReadAnyCardTemplateFields,
      isReadAnyCardTemplateRequiredValueMissing,
      parseReadAnyCardDataFromEditor,
    } from "@readany/core/knowledge";

    const EMPTY_DOC = { type: "doc", content: [] };
    let editor = null;
    let ready = false;
    let pendingInit = null;
    let changeTimer = null;
    let cardTemplates = [];
    let cardBodyPlaceholder = "Write inside this card...";
    let cardConvertToTextLabel = "Convert card to normal text";
    let imageUnavailableTitle = "Image attachment is not available on this device yet.";
    let imageUnavailableHint = "Sync again or keep the original device online to restore it.";

    const post = (payload) => {
      try {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      } catch (error) {
        console.error("[KnowledgeEditor] postMessage failed", error);
      }
    };

    const isDoc = (value) => value && typeof value === "object" && value.type === "doc";
    const normalizeDoc = (value) => (isDoc(value) ? value : EMPTY_DOC);
    const setCardTemplates = (value) => {
      cardTemplates = Array.isArray(value)
        ? value.filter((template) => template && typeof template === "object" && !template.builtIn)
        : [];
    };
    const createCardModel = (attrs = {}) =>
      createReadAnyCardReadOnlyModel(attrs, { body: "", cardTemplates });
    const findCardTemplate = (cardType) =>
      cardTemplates.find(
        (template) => createReadAnyCardAttrsFromTemplate(template).cardType === cardType,
      );
    const getCardDataRecord = (value) =>
      value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
    const getFieldInputValue = (value) => (value === undefined || value === null ? "" : String(value));
    const getFieldSelectedValues = (value) =>
      Array.isArray(value) ? value.map(String) : typeof value === "string" && value ? [value] : [];

    const setTheme = (theme = {}) => {
      const root = document.documentElement;
      const entries = {
        background: theme.background,
        foreground: theme.foreground,
        card: theme.card,
        border: theme.border,
        muted: theme.muted,
        mutedForeground: theme.mutedForeground,
        primary: theme.primary,
        destructive: theme.destructive,
      };
      for (const [key, value] of Object.entries(entries)) {
        if (typeof value === "string" && value) {
          root.style.setProperty("--" + key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()), value);
        }
      }
    };

    const scheduleHeight = () => {
      requestAnimationFrame(() => {
        const height = Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || 260);
        post({ type: "heightChanged", height });
      });
    };

    const selectionState = () => {
      if (!editor) return {};
      return {
        marks: {
          bold: editor.isActive("bold"),
          italic: editor.isActive("italic"),
          strike: editor.isActive("strike"),
          code: editor.isActive("code"),
          bulletList: editor.isActive("bulletList"),
          orderedList: editor.isActive("orderedList"),
          taskList: editor.isActive("taskList") || editor.isActive("taskItem"),
          blockquote: editor.isActive("blockquote"),
          link: editor.isActive("link"),
        },
        linkHref: editor.getAttributes("link").href || null,
        headingLevel: editor.isActive("heading", { level: 1 })
          ? 1
          : editor.isActive("heading", { level: 2 })
            ? 2
            : editor.isActive("heading", { level: 3 })
              ? 3
              : null,
        canUndo: editor.can().undo(),
        canRedo: editor.can().redo(),
      };
    };

    const postSelection = () => {
      post({ type: "selectionChanged", ...selectionState() });
    };

    const createContentPayload = (requestId) => {
      if (!editor) return;
      return {
        type: "contentChanged",
        ...(typeof requestId === "string" && requestId ? { requestId } : {}),
        contentJson: editor.getJSON(),
        plainText: editor.getText(),
      };
    };

    const postContent = () => {
      if (!editor) return;
      clearTimeout(changeTimer);
      changeTimer = setTimeout(() => {
        const payload = createContentPayload();
        if (!payload) return;
        post(payload);
        scheduleHeight();
      }, 180);
    };

    const postContentNow = (requestId) => {
      if (!editor) return;
      clearTimeout(changeTimer);
      const payload = createContentPayload(requestId);
      if (!payload) return;
      post(payload);
      scheduleHeight();
    };

    const syncEditableControls = () => {
      if (!editor) return;
      const editable = editor.isEditable;
      document.documentElement.classList.toggle("readany-editor-readonly", !editable);
      document
        .querySelectorAll(".readany-card-title, .readany-card-preview, .readany-card-field, .readany-card-data")
        .forEach((element) => {
          element.readOnly = !editable;
          element.tabIndex = editable ? 0 : -1;
          element.setAttribute("aria-readonly", editable ? "false" : "true");
        });
      document.querySelectorAll(".readany-card-convert").forEach((element) => {
        element.disabled = !editable;
        element.tabIndex = editable ? 0 : -1;
        element.setAttribute("aria-hidden", editable ? "false" : "true");
      });
    };

    const updateCardAttrs = (node, getPos, attrs) => {
      if (!editor || !editor.isEditable || typeof getPos !== "function") return;
      const pos = getPos();
      if (typeof pos !== "number") return;
      const nextAttrs = { ...(node.attrs || {}), ...attrs };
      editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, nextAttrs));
      postContent();
      scheduleHeight();
    };

    const fitTextArea = (element) => {
      if (!element) return;
      element.style.height = "auto";
      element.style.height = Math.max(72, element.scrollHeight) + "px";
    };

    const cardMetaText = (attrs = {}) => {
      const model = createCardModel(attrs);
      return [
        model.cardType,
        model.state === "supported" ? "" : model.stateLabel || "v" + model.version,
      ]
        .filter(Boolean)
        .join(" · ");
    };

    const ReadAnyCard = Node.create({
      name: "readanyCard",
      group: "block",
      atom: true,
      draggable: true,
      selectable: true,

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
        return [
          "readany-card",
          mergeAttributes(HTMLAttributes, {
            "data-card-type": HTMLAttributes.cardType || "callout",
            "data-card-version": String(HTMLAttributes.version || 1),
          }),
        ];
      },

      addNodeView() {
        return ({ node, getPos }) => {
          let currentNode = node;
          const attrs = currentNode.attrs || {};
          const readOnlyModel = createCardModel(attrs);
          const modelAttrs = readOnlyModel.attrs || attrs;
          const dom = document.createElement("div");
          dom.className = "readany-card";
          dom.contentEditable = "false";
          dom.dataset.cardType = readOnlyModel.cardType;

          const icon = document.createElement("div");
          icon.className = "readany-card-icon";
          icon.textContent = "◇";

          const body = document.createElement("div");
          body.className = "readany-card-body";

          const header = document.createElement("div");
          header.className = "readany-card-header";

          const meta = document.createElement("div");
          meta.className = "readany-card-meta";
          meta.textContent = cardMetaText(attrs);
          header.appendChild(meta);

          const convertButton = document.createElement("button");
          convertButton.className = "readany-card-convert";
          convertButton.type = "button";
          convertButton.textContent = "Aa";
          convertButton.title = cardConvertToTextLabel;
          convertButton.setAttribute("aria-label", cardConvertToTextLabel);
          convertButton.disabled = editor?.isEditable === false;
          convertButton.tabIndex = editor?.isEditable === false ? -1 : 0;
          convertButton.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!editor?.isEditable || typeof getPos !== "function") return;
            const pos = getPos();
            if (typeof pos !== "number") return;
            editor
              .chain()
              .focus()
              .insertContentAt(
                { from: pos, to: pos + currentNode.nodeSize },
                createReadAnyCardTiptapContent(
                  createCardModel(currentNode.attrs || {}).attrs || currentNode.attrs || {},
                ),
              )
              .run();
          });
          header.appendChild(convertButton);
          body.appendChild(header);

          const title = document.createElement("input");
          title.className = "readany-card-title";
          title.type = "text";
          title.value = modelAttrs.title || "";
          title.placeholder = readOnlyModel.title;
          title.readOnly = editor?.isEditable === false;
          title.tabIndex = editor?.isEditable === false ? -1 : 0;
          title.addEventListener("input", () => {
            if (!editor?.isEditable) return;
            updateCardAttrs(currentNode, getPos, { title: title.value });
          });
          body.appendChild(title);

          const text = readOnlyModel.body;
          const preview = document.createElement("textarea");
          preview.className = "readany-card-preview";
          preview.value = text;
          preview.placeholder = cardBodyPlaceholder;
          preview.rows = Math.max(3, Math.min(8, String(text).split("\\n").length + 1));
          preview.readOnly = editor?.isEditable === false;
          preview.tabIndex = editor?.isEditable === false ? -1 : 0;
          requestAnimationFrame(() => fitTextArea(preview));
          preview.addEventListener("input", () => {
            if (!editor?.isEditable) return;
            preview.rows = Math.max(3, Math.min(8, preview.value.split("\\n").length + 1));
            fitTextArea(preview);
            updateCardAttrs(currentNode, getPos, {
              markdown: preview.value,
              text: preview.value,
            });
          });
          body.appendChild(preview);

          const source = document.createElement("div");
          source.className = "readany-card-source";
          source.style.display = readOnlyModel.sourceTitle ? "block" : "none";
          source.textContent = readOnlyModel.sourceTitle || "";
          body.appendChild(source);

          const details = document.createElement("details");
          details.className = "readany-card-details";

          const detailsSummary = document.createElement("summary");
          detailsSummary.className = "readany-card-details-summary";
          detailsSummary.textContent = "Details";
          details.appendChild(detailsSummary);

          const detailGrid = document.createElement("div");
          detailGrid.className = "readany-card-detail-grid";
          details.appendChild(detailGrid);

          const structuredFields = document.createElement("div");
          structuredFields.className = "readany-card-structured-fields";
          details.appendChild(structuredFields);
          let dataInput = null;
          let dataError = null;

          const updateStructuredData = (key, value) => {
            const nextData = {
              ...getCardDataRecord(createCardModel(currentNode.attrs || {}).attrs?.data),
              [key]: value,
            };
            if (dataError) {
              dataError.style.display = "none";
              dataError.textContent = "";
            }
            if (dataInput) {
              dataInput.value = formatReadAnyCardDataForEditor(nextData);
            }
            updateCardAttrs(currentNode, getPos, { data: nextData });
          };

          const renderStructuredFields = (model) => {
            structuredFields.textContent = "";
            const template = findCardTemplate(model.cardType);
            const currentData = getCardDataRecord(model.attrs?.data);
            const allFields = template ? getReadAnyCardTemplateFields(template) : [];
            const fields = template ? getVisibleReadAnyCardTemplateFields(template, currentData) : [];
            if (fields.length === 0) {
              structuredFields.style.display = "none";
              return;
            }
            structuredFields.style.display = "block";

            const heading = document.createElement("div");
            heading.className = "readany-card-structured-heading";
            heading.textContent = "Structured fields";
            const count = document.createElement("span");
            count.className = "readany-card-structured-count";
            count.textContent = allFields.length === fields.length ? String(fields.length) : fields.length + "/" + allFields.length;
            heading.appendChild(count);
            const missingCount = fields.filter((field) =>
              isReadAnyCardTemplateRequiredValueMissing(field, currentData[field.key]),
            ).length;
            if (missingCount > 0) {
              const missing = document.createElement("span");
              missing.className = "readany-card-structured-missing-count";
              missing.textContent = missingCount + " missing";
              heading.appendChild(missing);
            }
            structuredFields.appendChild(heading);

            const grid = document.createElement("div");
            grid.className = "readany-card-structured-grid";
            let currentGroup = "";
            fields.forEach((field) => {
              const fieldGroup = typeof field.group === "string" ? field.group.trim() : "";
              if (fieldGroup && fieldGroup !== currentGroup) {
                const groupHeading = document.createElement("div");
                groupHeading.className = "readany-card-structured-group-heading";
                groupHeading.textContent = fieldGroup;
                grid.appendChild(groupHeading);
              }
              currentGroup = fieldGroup;
              const currentValue = currentData[field.key];
              const isRequiredMissing = isReadAnyCardTemplateRequiredValueMissing(field, currentValue);
              const applyFieldLayout = (element) => {
                if (field.width === "full" || field.width === "half" || field.width === "third") {
                  element.classList.add("readany-card-field-width-" + field.width);
                  element.setAttribute("data-readany-card-field-width", field.width);
                }
              };
              const applyMissingState = (element) => {
                element.classList.toggle("readany-card-field-missing", isRequiredMissing);
                if (isRequiredMissing) {
                  element.setAttribute("data-readany-card-field-state", "missing");
                } else {
                  element.removeAttribute("data-readany-card-field-state");
                }
              };
              const appendRequiredMarker = (element) => {
                if (!field.required) return;
                const marker = document.createElement("span");
                marker.className = "readany-card-field-required-marker";
                marker.textContent = " *";
                element.appendChild(marker);
              };
              const appendMissingHint = (element) => {
                if (!isRequiredMissing) return;
                const hint = document.createElement("span");
                hint.className = "readany-card-field-missing-hint";
                hint.textContent = "Required value missing.";
                element.appendChild(hint);
              };
              if (field.type === "checkbox") {
                const label = document.createElement("label");
                label.className = "readany-card-structured-checkbox";
                applyFieldLayout(label);
                applyMissingState(label);
                const input = document.createElement("input");
                input.type = "checkbox";
                input.checked = currentValue === true;
                if (isRequiredMissing) input.setAttribute("aria-invalid", "true");
                input.disabled = editor?.isEditable === false;
                input.addEventListener("change", () => {
                  if (!editor?.isEditable) return;
                  updateStructuredData(field.key, input.checked);
                });
                label.appendChild(input);
                const text = document.createElement("span");
                text.textContent = field.label;
                appendRequiredMarker(text);
                label.appendChild(text);
                appendMissingHint(label);
                grid.appendChild(label);
                return;
              }

              const label = document.createElement("label");
              label.className = "readany-card-field-label";
              applyFieldLayout(label);
              applyMissingState(label);
              const caption = document.createElement("span");
              caption.textContent = field.label;
              appendRequiredMarker(caption);
              label.appendChild(caption);

              if (field.type === "multiline") {
                const textarea = document.createElement("textarea");
                textarea.className = "readany-card-data readany-card-structured-textarea";
                textarea.value = getFieldInputValue(currentValue);
                textarea.placeholder = field.placeholder || "";
                textarea.rows = 3;
                textarea.readOnly = editor?.isEditable === false;
                textarea.tabIndex = editor?.isEditable === false ? -1 : 0;
                if (isRequiredMissing) textarea.setAttribute("aria-invalid", "true");
                textarea.addEventListener("blur", () => {
                  if (!editor?.isEditable) return;
                  updateStructuredData(field.key, textarea.value);
                });
                label.appendChild(textarea);
              } else if (field.type === "select") {
                const select = document.createElement("select");
                select.className = "readany-card-field readany-card-select";
                select.value = getFieldInputValue(currentValue);
                select.disabled = editor?.isEditable === false;
                select.tabIndex = editor?.isEditable === false ? -1 : 0;
                if (isRequiredMissing) select.setAttribute("aria-invalid", "true");
                const emptyOption = document.createElement("option");
                emptyOption.value = "";
                emptyOption.textContent = field.placeholder || "Choose...";
                select.appendChild(emptyOption);
                for (const option of field.options || []) {
                  const optionElement = document.createElement("option");
                  optionElement.value = option.value;
                  optionElement.textContent = option.label;
                  select.appendChild(optionElement);
                }
                select.addEventListener("change", () => {
                  if (!editor?.isEditable) return;
                  updateStructuredData(field.key, select.value || null);
                });
                label.appendChild(select);
              } else if (field.type === "multiselect") {
                const selectedValues = getFieldSelectedValues(currentValue);
                const choices = document.createElement("div");
                choices.className = "readany-card-multiselect";
                if (isRequiredMissing) choices.setAttribute("aria-invalid", "true");
                for (const option of field.options || []) {
                  const button = document.createElement("button");
                  button.type = "button";
                  button.className = "readany-card-choice";
                  const isSelected = selectedValues.includes(option.value);
                  button.classList.toggle("readany-card-choice-selected", isSelected);
                  button.textContent = option.label;
                  button.disabled = editor?.isEditable === false;
                  button.addEventListener("click", () => {
                    if (!editor?.isEditable) return;
                    const nextValues = isSelected
                      ? selectedValues.filter((value) => value !== option.value)
                      : [...selectedValues, option.value];
                    updateStructuredData(field.key, nextValues);
                  });
                  choices.appendChild(button);
                }
                label.appendChild(choices);
              } else {
                const input = document.createElement("input");
                input.className = "readany-card-field";
                input.type = field.type === "number" ? "number" : "text";
                input.value = getFieldInputValue(currentValue);
                input.placeholder = field.placeholder || "";
                input.readOnly = editor?.isEditable === false;
                input.tabIndex = editor?.isEditable === false ? -1 : 0;
                if (isRequiredMissing) input.setAttribute("aria-invalid", "true");
                input.addEventListener("blur", () => {
                  if (!editor?.isEditable) return;
                  if (field.type === "number") {
                    const rawValue = input.value.trim();
                    if (!rawValue) {
                      updateStructuredData(field.key, null);
                      return;
                    }
                    const numberValue = Number(rawValue);
                    if (!Number.isFinite(numberValue)) {
                      if (dataError) {
                        dataError.textContent = field.label + " must be a valid number.";
                        dataError.style.display = "block";
                      }
                      return;
                    }
                    updateStructuredData(field.key, numberValue);
                    return;
                  }
                  updateStructuredData(field.key, input.value);
                });
                label.appendChild(input);
              }
              appendMissingHint(label);
              grid.appendChild(label);
            });
            structuredFields.appendChild(grid);
          };

          const createTextField = (labelText, key, placeholder = "") => {
            const label = document.createElement("label");
            label.className = "readany-card-field-label";
            const labelCaption = document.createElement("span");
            labelCaption.textContent = labelText;
            label.appendChild(labelCaption);
            const input = document.createElement("input");
            input.className = "readany-card-field";
            input.type = "text";
            input.placeholder = placeholder;
            input.value = modelAttrs?.[key] || "";
            input.readOnly = editor?.isEditable === false;
            input.tabIndex = editor?.isEditable === false ? -1 : 0;
            input.addEventListener("blur", () => {
              if (!editor?.isEditable) return;
              updateCardAttrs(currentNode, getPos, { [key]: input.value.trim() || null });
            });
            label.appendChild(input);
            detailGrid.appendChild(label);
            return input;
          };

          const sourceTitleInput = createTextField("Source", "sourceTitle", "Chapter");
          const sourceIdInput = createTextField("Source ID", "sourceId", "highlight-1");
          const cfiInput = createTextField("CFI", "cfi", "epubcfi(...)");

          const dataLabel = document.createElement("label");
          dataLabel.className = "readany-card-field-label readany-card-data-label";
          const dataCaption = document.createElement("span");
          dataCaption.textContent = "Data JSON";
          dataLabel.appendChild(dataCaption);
          dataInput = document.createElement("textarea");
          dataInput.className = "readany-card-data";
          dataInput.value = formatReadAnyCardDataForEditor(modelAttrs?.data);
          dataInput.placeholder = '{"key":"value"}';
          dataInput.rows = 4;
          dataInput.readOnly = editor?.isEditable === false;
          dataInput.tabIndex = editor?.isEditable === false ? -1 : 0;
          dataError = document.createElement("div");
          dataError.className = "readany-card-data-error";
          dataError.style.display = "none";
          dataInput.addEventListener("input", () => {
            dataError.style.display = "none";
            dataError.textContent = "";
          });
          dataInput.addEventListener("blur", () => {
            if (!editor?.isEditable) return;
            const parsed = parseReadAnyCardDataFromEditor(dataInput.value);
            if (!parsed.ok) {
              dataError.textContent = "Invalid JSON: " + parsed.error;
              dataError.style.display = "block";
              return;
            }
            dataError.style.display = "none";
            dataError.textContent = "";
            dataInput.value = formatReadAnyCardDataForEditor(parsed.data);
            updateCardAttrs(currentNode, getPos, { data: parsed.data });
          });
          dataLabel.appendChild(dataInput);
          dataLabel.appendChild(dataError);
          details.appendChild(dataLabel);
          body.appendChild(details);
          renderStructuredFields(readOnlyModel);

          dom.appendChild(icon);
          dom.appendChild(body);
          return {
            dom,
            update(nextNode) {
              if (nextNode.type.name !== "readanyCard") return false;
              currentNode = nextNode;
              const nextAttrs = nextNode.attrs || {};
              const nextModel = createCardModel(nextAttrs);
              const nextModelAttrs = nextModel.attrs || nextAttrs;
              dom.dataset.cardType = nextModel.cardType;
              meta.textContent = cardMetaText(nextAttrs);
              title.value = nextModelAttrs.title || "";
              title.placeholder = nextModel.title;
              title.readOnly = editor?.isEditable === false;
              title.tabIndex = editor?.isEditable === false ? -1 : 0;
              convertButton.disabled = editor?.isEditable === false;
              convertButton.tabIndex = editor?.isEditable === false ? -1 : 0;
              const nextText = nextModel.body;
              if (preview.value !== nextText) preview.value = nextText;
              preview.rows = Math.max(3, Math.min(8, String(nextText).split("\\n").length + 1));
              preview.readOnly = editor?.isEditable === false;
              preview.tabIndex = editor?.isEditable === false ? -1 : 0;
              fitTextArea(preview);
              source.style.display = nextModel.sourceTitle ? "block" : "none";
              source.textContent = nextModel.sourceTitle || "";
              renderStructuredFields(nextModel);
              const editable = editor?.isEditable !== false;
              [sourceTitleInput, sourceIdInput, cfiInput, dataInput].forEach((field) => {
                field.readOnly = !editable;
                field.tabIndex = editable ? 0 : -1;
                field.setAttribute("aria-readonly", editable ? "false" : "true");
              });
              if (document.activeElement !== sourceTitleInput) {
                sourceTitleInput.value = nextModelAttrs.sourceTitle || "";
              }
              if (document.activeElement !== sourceIdInput) {
                sourceIdInput.value = nextModelAttrs.sourceId || "";
              }
              if (document.activeElement !== cfiInput) {
                cfiInput.value = nextModelAttrs.cfi || "";
              }
              if (document.activeElement !== dataInput) {
                dataInput.value = formatReadAnyCardDataForEditor(nextModelAttrs.data);
                dataError.style.display = "none";
                dataError.textContent = "";
              }
              return true;
            },
          };
        };
      },
    });

    const ReadAnyInternalLink = Node.create({
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
        return ({ node }) => {
          const span = document.createElement("span");
          span.className = "readany-internal-link";
          span.contentEditable = "false";
          const update = (nextNode) => {
            const attrs = nextNode.attrs || {};
            const label =
              attrs.label || attrs.title || attrs.documentId || attrs.targetPath || "Linked note";
            span.dataset.readanyInternalLink = attrs.documentId || attrs.targetPath || label;
            span.textContent = label;
          };
          update(node);
          return {
            dom: span,
            update(nextNode) {
              if (nextNode.type.name !== "readanyInternalLink") return false;
              update(nextNode);
              return true;
            },
          };
        };
      },
    });

    const ReadAnySourceReference = Node.create({
      name: "readanySourceReference",
      group: "inline",
      inline: true,
      atom: true,
      selectable: true,

      addAttributes() {
        return {
          label: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-label") || element.textContent || null,
            renderHTML: (attributes) =>
              attributes.label ? { "data-label": attributes.label } : {},
          },
          sourceTitle: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute("data-source-title") || element.textContent || null,
            renderHTML: (attributes) =>
              attributes.sourceTitle ? { "data-source-title": attributes.sourceTitle } : {},
          },
          sourceId: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute("data-source-id") ||
              element.getAttribute("data-readany-source-id") ||
              null,
            renderHTML: (attributes) =>
              attributes.sourceId ? { "data-source-id": attributes.sourceId } : {},
          },
          cfi: {
            default: null,
            parseHTML: (element) => {
              const cfi = element.getAttribute("data-cfi");
              if (cfi) return cfi;
              const legacyReference = element.getAttribute("data-readany-source-reference") || "";
              return legacyReference.startsWith("epubcfi(") ? legacyReference : null;
            },
            renderHTML: (attributes) => (attributes.cfi ? { "data-cfi": attributes.cfi } : {}),
          },
        };
      },

      parseHTML() {
        return [{ tag: "span[data-readany-source-reference]" }];
      },

      renderHTML({ node, HTMLAttributes }) {
        const label = node.attrs.label || node.attrs.sourceTitle || "Source reference";
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
        return ({ node }) => {
          const span = document.createElement("span");
          span.className = "readany-source-reference";
          span.contentEditable = "false";
          const update = (nextNode) => {
            const attrs = nextNode.attrs || {};
            const label = attrs.label || attrs.sourceTitle || "Source reference";
            span.dataset.readanySourceReference = attrs.cfi || attrs.sourceId || label;
            if (attrs.sourceId) span.dataset.readanySourceId = attrs.sourceId;
            else delete span.dataset.readanySourceId;
            span.textContent = label;
          };
          update(node);
          return {
            dom: span,
            update(nextNode) {
              if (nextNode.type.name !== "readanySourceReference") return false;
              update(nextNode);
              return true;
            },
          };
        };
      },
    });

    const KnowledgeImage = Node.create({
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
        return ["img", mergeAttributes(HTMLAttributes, { "data-readany-image": "true" })];
      },

      addNodeView() {
        return ({ node }) => {
          const attrs = node.attrs || {};
          let currentAttrs = attrs;
          const figure = document.createElement("figure");
          figure.className = "readany-image";
          figure.contentEditable = "false";

          const image = document.createElement("img");
          const fallback = document.createElement("div");
          fallback.className = "readany-image-missing";

          const icon = document.createElement("div");
          icon.className = "readany-image-missing-icon";
          icon.textContent = "!";
          fallback.appendChild(icon);

          const text = document.createElement("div");
          text.className = "readany-image-missing-text";
          fallback.appendChild(text);

          const title = document.createElement("div");
          title.className = "readany-image-missing-title";
          text.appendChild(title);

          const hint = document.createElement("div");
          hint.className = "readany-image-missing-hint";
          text.appendChild(hint);

          const updateFallback = (nextAttrs = {}, failed = false) => {
            const src = typeof nextAttrs.src === "string" ? nextAttrs.src.trim() : "";
            const attachmentId =
              typeof nextAttrs.attachmentId === "string" ? nextAttrs.attachmentId.trim() : "";
            const unresolved = attachmentId && (!src || src.startsWith("readany-attachment://"));
            const missing = failed || !src || unresolved;
            title.textContent =
              nextAttrs.fileName || nextAttrs.title || nextAttrs.alt || imageUnavailableTitle;
            hint.textContent = imageUnavailableHint;
            image.style.display = missing ? "none" : "block";
            fallback.style.display = missing ? "flex" : "none";
          };

          image.src = attrs.src || "";
          image.alt = attrs.alt || "";
          image.title = attrs.title || "";
          image.addEventListener("error", () => updateFallback(currentAttrs, true));
          figure.appendChild(image);
          figure.appendChild(fallback);

          if (attrs.alt) {
            const caption = document.createElement("figcaption");
            caption.textContent = attrs.alt;
            figure.appendChild(caption);
          }

          updateFallback(attrs);

          return {
            dom: figure,
            update(nextNode) {
              if (nextNode.type.name !== "image") return false;
              const nextAttrs = nextNode.attrs || {};
              currentAttrs = nextAttrs;
              image.src = nextAttrs.src || "";
              image.alt = nextAttrs.alt || "";
              image.title = nextAttrs.title || "";
              updateFallback(nextAttrs);
              const nextAlt = nextAttrs.alt || "";
              let caption = figure.querySelector("figcaption");
              if (nextAlt && !caption) {
                caption = document.createElement("figcaption");
                figure.appendChild(caption);
              }
              if (caption) {
                if (nextAlt) caption.textContent = nextAlt;
                else caption.remove();
              }
              return true;
            },
          };
        };
      },
    });

    const createEditor = (payload = {}) => {
      const el = document.getElementById("editor");
      if (!el) throw new Error("Editor root not found");
      setTheme(payload.theme);
      setCardTemplates(payload.cardTemplates);
      cardBodyPlaceholder =
        typeof payload.cardBodyPlaceholder === "string" && payload.cardBodyPlaceholder
          ? payload.cardBodyPlaceholder
          : "Write inside this card...";
      cardConvertToTextLabel =
        typeof payload.cardConvertToTextLabel === "string" && payload.cardConvertToTextLabel
          ? payload.cardConvertToTextLabel
          : "Convert card to normal text";
      imageUnavailableTitle =
        typeof payload.imageUnavailableTitle === "string" && payload.imageUnavailableTitle
          ? payload.imageUnavailableTitle
          : "Image attachment is not available on this device yet.";
      imageUnavailableHint =
        typeof payload.imageUnavailableHint === "string" && payload.imageUnavailableHint
          ? payload.imageUnavailableHint
          : "Sync again or keep the original device online to restore it.";
      editor?.destroy();
      editor = new Editor({
        element: el,
        extensions: [
          StarterKit.configure({
            heading: { levels: [1, 2, 3] },
            dropcursor: false,
            gapcursor: false,
          }),
          Link.configure({
            autolink: true,
            openOnClick: false,
          }),
          TaskList,
          TaskItem.configure({
            nested: true,
          }),
          ReadAnyInternalLink,
          ReadAnySourceReference,
          KnowledgeImage,
          ReadAnyCard,
          Placeholder.configure({
            placeholder: payload.placeholder || "",
            emptyEditorClass: "is-editor-empty",
          }),
        ],
        content: normalizeDoc(payload.contentJson),
        editable: payload.readOnly !== true,
        editorProps: {
          attributes: {
            class: "readany-prosemirror",
          },
        },
        onCreate: () => {
          post({ type: "ready" });
          syncEditableControls();
          postSelection();
          scheduleHeight();
        },
        onUpdate: () => postContent(),
        onSelectionUpdate: () => postSelection(),
        onTransaction: () => {
          syncEditableControls();
          scheduleHeight();
        },
        onFocus: () => post({ type: "focusChanged", focused: true }),
        onBlur: () => {
          postContentNow();
          post({ type: "focusChanged", focused: false });
        },
      });
      ready = true;
    };

    const scrollToOutline = (index) => {
      if (!editor) return;
      const numericIndex = Number(index);
      if (!Number.isFinite(numericIndex) || numericIndex < 0) return;
      const headings = Array.from(
        document.querySelectorAll(".readany-prosemirror h1, .readany-prosemirror h2, .readany-prosemirror h3, .readany-prosemirror h4, .readany-prosemirror h5, .readany-prosemirror h6"),
      );
      const target = headings[Math.floor(numericIndex)];
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
    };

    const runCommand = (command, attrs = {}) => {
      if (!editor) return;
      const readOnlyAllowedCommands = new Set(["focus", "blur", "scrollToOutline"]);
      if (!editor.isEditable && !readOnlyAllowedCommands.has(command)) {
        postSelection();
        scheduleHeight();
        return;
      }
      const chain = editor.chain().focus();
      switch (command) {
        case "undo":
          editor.chain().focus().undo().run();
          break;
        case "redo":
          editor.chain().focus().redo().run();
          break;
        case "bold":
          chain.toggleBold().run();
          break;
        case "italic":
          chain.toggleItalic().run();
          break;
        case "strike":
          chain.toggleStrike().run();
          break;
        case "code":
          chain.toggleCode().run();
          break;
        case "setLink":
          if (typeof attrs.href === "string" && attrs.href.trim()) {
            editor.chain().focus().extendMarkRange("link").setLink({ href: attrs.href.trim() }).run();
          }
          break;
        case "unsetLink":
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
          break;
        case "heading":
          chain.toggleHeading({ level: attrs.level || 2 }).run();
          break;
        case "bulletList":
          chain.toggleBulletList().run();
          break;
        case "orderedList":
          chain.toggleOrderedList().run();
          break;
        case "taskList":
          chain.toggleTaskList().run();
          break;
        case "blockquote":
          chain.toggleBlockquote().run();
          break;
        case "codeBlock":
          chain.toggleCodeBlock().run();
          break;
        case "horizontalRule":
          chain.setHorizontalRule().run();
          break;
        case "insertImage": {
          if (typeof attrs.src === "string" && attrs.src.trim()) {
            chain
              .insertContent({
                type: "image",
                attrs: {
                  src: attrs.src.trim(),
                  alt: typeof attrs.alt === "string" ? attrs.alt.trim() : "",
                  title: typeof attrs.title === "string" ? attrs.title.trim() : "",
                  attachmentId:
                    typeof attrs.attachmentId === "string" ? attrs.attachmentId.trim() : "",
                  fileName: typeof attrs.fileName === "string" ? attrs.fileName.trim() : "",
                },
              })
              .run();
          }
          break;
        }
        case "insertInternalLink": {
          const linkAttrs = attrs && typeof attrs === "object" ? attrs : {};
          const label =
            typeof linkAttrs.label === "string" && linkAttrs.label.trim()
              ? linkAttrs.label.trim()
              : typeof linkAttrs.title === "string" && linkAttrs.title.trim()
                ? linkAttrs.title.trim()
                : typeof linkAttrs.documentId === "string"
                  ? linkAttrs.documentId.trim()
                  : "";
          if (label) {
            chain
              .insertContent({
                type: "readanyInternalLink",
                attrs: {
                  label,
                  title: label,
                  documentId:
                    typeof linkAttrs.documentId === "string" && linkAttrs.documentId.trim()
                      ? linkAttrs.documentId.trim()
                      : null,
                  targetPath:
                    typeof linkAttrs.targetPath === "string" && linkAttrs.targetPath.trim()
                      ? linkAttrs.targetPath.trim()
                      : null,
                },
              })
              .run();
          }
          break;
        }
        case "insertSourceReference": {
          const sourceAttrs = attrs && typeof attrs === "object" ? attrs : {};
          const label =
            typeof sourceAttrs.label === "string" && sourceAttrs.label.trim()
              ? sourceAttrs.label.trim()
              : typeof sourceAttrs.sourceTitle === "string" && sourceAttrs.sourceTitle.trim()
                ? sourceAttrs.sourceTitle.trim()
                : "";
          if (label) {
            chain
              .insertContent([
                {
                  type: "readanySourceReference",
                  attrs: {
                    label,
                    sourceTitle:
                      typeof sourceAttrs.sourceTitle === "string" &&
                      sourceAttrs.sourceTitle.trim()
                        ? sourceAttrs.sourceTitle.trim()
                        : label,
                    sourceId:
                      typeof sourceAttrs.sourceId === "string" && sourceAttrs.sourceId.trim()
                        ? sourceAttrs.sourceId.trim()
                        : null,
                    cfi:
                      typeof sourceAttrs.cfi === "string" && sourceAttrs.cfi.trim()
                        ? sourceAttrs.cfi.trim()
                        : null,
                  },
                },
                { type: "text", text: " " },
              ])
              .run();
          }
          break;
        }
        case "insertCard": {
          const cardAttrs = attrs && typeof attrs === "object" ? attrs : {};
          chain
            .insertContent({
              type: "readanyCard",
              attrs: {
                cardType:
                  typeof cardAttrs.cardType === "string" && cardAttrs.cardType
                    ? cardAttrs.cardType
                    : "callout",
                version: typeof cardAttrs.version === "number" ? cardAttrs.version : 1,
                id: typeof cardAttrs.id === "string" ? cardAttrs.id : null,
                title: typeof cardAttrs.title === "string" ? cardAttrs.title : null,
                text: typeof cardAttrs.text === "string" ? cardAttrs.text : null,
                sourceTitle:
                  typeof cardAttrs.sourceTitle === "string" ? cardAttrs.sourceTitle : null,
                sourceId: typeof cardAttrs.sourceId === "string" ? cardAttrs.sourceId : null,
                cfi: typeof cardAttrs.cfi === "string" ? cardAttrs.cfi : null,
                markdown: typeof cardAttrs.markdown === "string" ? cardAttrs.markdown : "",
                data: cardAttrs.data ?? null,
              },
            })
            .run();
          break;
        }
        case "focus":
          editor.commands.focus(attrs.position || "end");
          break;
        case "scrollToOutline":
          scrollToOutline(attrs.index);
          break;
        case "blur":
          editor.commands.blur();
          break;
        default:
          post({ type: "error", code: "unknown_command", message: "Unknown editor command: " + command });
      }
      postSelection();
      scheduleHeight();
    };

    const receive = (message) => {
      try {
        if (!message || typeof message !== "object") return;
        switch (message.type) {
          case "init":
            pendingInit = message;
            createEditor(message);
            break;
          case "setContent":
            if ("cardTemplates" in message) setCardTemplates(message.cardTemplates);
            editor?.commands.setContent(normalizeDoc(message.contentJson));
            postContent();
            break;
          case "setCardTemplates":
            setCardTemplates(message.cardTemplates);
            break;
          case "setTheme":
            setTheme(message.theme);
            break;
          case "setEditable":
            editor?.setEditable(message.editable !== false);
            syncEditableControls();
            postSelection();
            scheduleHeight();
            break;
          case "focus":
            runCommand("focus", { position: message.position });
            break;
          case "blur":
            runCommand("blur");
            break;
          case "runCommand":
            runCommand(message.command, message.attrs);
            break;
          case "requestContent":
            postContentNow(message.requestId);
            break;
          default:
            post({ type: "error", code: "unknown_message", message: "Unknown bridge message: " + message.type });
        }
      } catch (error) {
        post({
          type: "error",
          code: "bridge_error",
          message: error && error.message ? error.message : String(error),
        });
      }
    };

    window.__ReadAnyKnowledgeEditor = { receive };

    window.addEventListener("message", (event) => {
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        receive(data);
      } catch (error) {
        post({ type: "error", code: "parse_error", message: String(error) });
      }
    });

    document.addEventListener("DOMContentLoaded", () => {
      post({ type: "loaded" });
      if (pendingInit && !ready) createEditor(pendingInit);
    });
  `;

  const entryFile = path.resolve(__dirname, "../.knowledge-editor-entry.mjs");
  fs.writeFileSync(entryFile, entryContent);

  try {
    const result = await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      format: "iife",
      target: "es2020",
      minify: true,
      write: false,
      resolveExtensions: [".ts", ".tsx", ".js", ".mjs"],
    });

    const bundledJS = result.outputFiles[0].text;
    const template = fs.readFileSync(TEMPLATE, "utf-8");
    const parts = template.split(MARKER);
    if (parts.length < 2) {
      throw new Error("Knowledge editor template marker not found");
    }
    const html = `${parts[0]}<script>\n${bundledJS}\n</script>${parts.slice(1).join(MARKER)}`;
    fs.writeFileSync(OUTPUT, html);
    console.log(`Built knowledge-editor.html (${Math.round(html.length / 1024)}KB)`);
  } finally {
    if (fs.existsSync(entryFile)) fs.unlinkSync(entryFile);
  }
}

buildKnowledgeEditor().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
