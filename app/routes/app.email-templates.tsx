import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { authenticate } from "../shopify.server";
import {
  getEmailTemplate,
  saveEmailTemplate,
} from "../services/settings/email-template.service.server";
import {
  AFFILIATE_EMAIL_TEMPLATE_VARIABLES,
  DETAILS_ROW_OPTIONS,
  EMAIL_BLOCK_TEXT_MAX_LENGTH,
  EMAIL_BLOCK_TYPE_OPTIONS,
  SINGLETON_EMAIL_BLOCK_TYPES,
  appendVariable,
  createBlockId,
  createEmailBlock,
  getBlockPreviewLabel,
  getDefaultEmailBlockColor,
  getDefaultEmailButtonTextColor,
  getDetailsRowLabel,
  getEmailBlockTypeLabel,
  moveItem,
  parseDetailsRows,
  parseEmailBlocks,
  type DetailsRowKey,
  type EmailBlock,
  type EmailBlockType,
  type TextEmailBlock,
} from "../lib/affiliate-email-template";
import type { action as previewAction } from "./app.email-templates.preview";

type EmailTemplatesActionData = { ok: true } | { ok: false; error: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getEmailTemplate(session.shop);
  const gmailConfigured = Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

  return { settings, gmailConfigured };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<EmailTemplatesActionData> => {
  const { session } = await authenticate.admin(request);

  try {
    const formData = await request.formData();

    const subject = String(formData.get("subject") ?? "").trim();
    if (!subject) {
      throw new Error("Email subject is required.");
    }

    const detailsRows = parseDetailsRows(String(formData.get("detailsRows") ?? ""));

    const blocks = parseEmailBlocks(String(formData.get("blocks") ?? ""), []);
    if (blocks.length === 0) {
      throw new Error("At least one email block is required.");
    }

    for (const block of blocks) {
      if (block.type === "table") continue;

      const label = getEmailBlockTypeLabel(block.type);
      const trimmedText = block.text.trim();
      if (!trimmedText) {
        throw new Error(`${label} text is required.`);
      }

      const maxLength = EMAIL_BLOCK_TEXT_MAX_LENGTH[block.type];
      if (trimmedText.length > maxLength) {
        throw new Error(`${label} must be ${maxLength} characters or fewer.`);
      }

      block.text = trimmedText;
    }

    await saveEmailTemplate(session.shop, { subject, blocks, detailsRows });

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save email template.",
    };
  }
};

// React Router revalidates every loader on the page after any action
// runs — including the live-preview fetcher's POSTs to
// /app/email-templates/preview, which fire on nearly every keystroke.
// Without this, each of those also re-ran this page's own loader,
// which the sync effect below would then see as "the data changed" and
// use to stomp over whatever the merchant was mid-way through editing.
export function shouldRevalidate({
  formAction,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formAction === "/app/email-templates/preview") return false;
  return defaultShouldRevalidate;
}

type FieldEvent = { target: EventTarget | null; currentTarget: EventTarget | null };
function fieldValue(event: FieldEvent): string {
  return ((event.target ?? event.currentTarget) as { value?: string } | null)?.value ?? "";
}

type VariablePickerProps = { id: string; onInsert: (token: string) => void };
function VariablePicker({ id, onInsert }: VariablePickerProps) {
  return (
    <s-popover id={id}>
      <s-box padding="base">
        <s-stack gap="small-200">
          <s-heading>Insert variable</s-heading>
          <s-text color="subdued">Choose a variable to insert.</s-text>
          <s-stack gap="small-300">
            {AFFILIATE_EMAIL_TEMPLATE_VARIABLES.map((variable) => (
              <s-clickable
                key={variable.key}
                type="button"
                inlineSize="100%"
                padding="small"
                borderRadius="small"
                accessibilityLabel={`Insert ${variable.label}`}
                onClick={(event: { preventDefault: () => void }) => {
                  event.preventDefault();
                  onInsert(variable.token);
                }}
              >
                <s-text>{variable.label}</s-text>
              </s-clickable>
            ))}
          </s-stack>
        </s-stack>
      </s-box>
    </s-popover>
  );
}

type OptionPickerOption = { key: string; label: string; disabled?: boolean };
type OptionPickerProps = {
  id: string;
  title: string;
  emptyText: string;
  options: readonly OptionPickerOption[];
  onSelect: (key: string) => void;
};
// Generic "pick one of these options" popover — reused for "Add row"
// (details-table variables) and "Add field" (email blocks).
function OptionPicker({ id, title, emptyText, options, onSelect }: OptionPickerProps) {
  return (
    <s-popover id={id}>
      <s-box padding="base">
        <s-stack gap="small-200">
          <s-heading>{title}</s-heading>
          {options.length === 0 ? (
            <s-text color="subdued">{emptyText}</s-text>
          ) : (
            <s-stack gap="small-300">
              {options.map((option) => (
                <s-clickable
                  key={option.key}
                  type="button"
                  inlineSize="100%"
                  padding="small"
                  borderRadius="small"
                  disabled={option.disabled}
                  accessibilityLabel={
                    option.disabled ? `${option.label} already added` : `Add ${option.label}`
                  }
                  onClick={(event: { preventDefault: () => void }) => {
                    event.preventDefault();
                    if (option.disabled) return;
                    onSelect(option.key);
                  }}
                >
                  <s-text color={option.disabled ? "subdued" : undefined}>{option.label}</s-text>
                </s-clickable>
              ))}
            </s-stack>
          )}
        </s-stack>
      </s-box>
    </s-popover>
  );
}

type VariableFieldHeaderProps = { label: string; required?: boolean; popoverId: string };
// A tight label + "{ }" row sitting directly above the field, with the
// field's own built-in label hidden.
function VariableFieldHeader({ label, required = false, popoverId }: VariableFieldHeaderProps) {
  return (
    <div className="aen-variable-header">
      <div className="aen-field-label">
        {label}
        {required ? <span className="aen-required">*</span> : null}
      </div>
      <s-button variant="tertiary" commandFor={popoverId} accessibilityLabel={`Insert variable into ${label}`}>
        {"{ }"}
      </s-button>
    </div>
  );
}

type ColorFieldProps = {
  label: string;
  value: string | null;
  defaultColor: string;
  onChange: (value: string | null) => void;
};
function ColorField({ label, value, defaultColor, onChange }: ColorFieldProps) {
  return (
    <div className="aen-color-field">
      <div className="aen-color-field-header">
        <span className="aen-field-label">{label}</span>
      </div>
      <s-color-field
        label={label}
        labelAccessibilityVisibility="exclusive"
        value={value ?? defaultColor}
        onInput={(event: FieldEvent) => onChange(fieldValue(event))}
      />
    </div>
  );
}

type SortableRowProps = {
  id: string;
  index: number;
  group: string;
  className?: string;
  children: (args: { handleRef: (element: Element | null) => void }) => React.ReactNode;
};
// Thin wrapper around @dnd-kit/react's useSortable. group scopes
// dragging to just this list, so the blocks list and a details-table's
// row list (rendered separately, inside its own DragDropProvider) never
// interfere with each other.
function SortableRow({ id, index, group, className, children }: SortableRowProps) {
  const { ref, handleRef, isDragging } = useSortable({ id, index, group });

  return (
    <div ref={ref} className={[className, isDragging ? "aen-sortable--dragging" : ""].filter(Boolean).join(" ")}>
      {children({ handleRef })}
    </div>
  );
}

export default function EmailTemplates() {
  const { settings, gmailConfigured } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const previewFetcher = useFetcher<typeof previewAction>();

  const [subject, setSubject] = useState(settings.subject);
  const [detailsRows, setDetailsRows] = useState<DetailsRowKey[]>(settings.detailsRows);
  const [blocks, setBlocks] = useState<EmailBlock[]>(settings.blocks);
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);

  useEffect(() => {
    // Deliberately only settings.updatedAt — the one field that only
    // changes value when a real save happened. Everything else on
    // `settings` would re-run this on any loader revalidation even
    // when nothing was actually saved, stomping mid-edit state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubject(settings.subject);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetailsRows(settings.detailsRows);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBlocks(settings.blocks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.updatedAt]);

  useEffect(() => {
    if (actionData?.ok === true) {
      shopify.toast.show("Email template saved");
    }
  }, [actionData, shopify]);

  const detailsRowsKey = JSON.stringify(detailsRows);
  const blocksKey = JSON.stringify(blocks);

  const previewSubmit = previewFetcher.submit;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live preview, debounced — every keystroke/click schedules a
  // refresh, but only the last one after a short pause actually fires.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      previewSubmit(
        { emailSubject: subject, emailDetailsRows: detailsRowsKey, emailBlocks: blocksKey },
        { method: "post", action: "/app/email-templates/preview" },
      );
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, detailsRowsKey, blocksKey]);

  const previewData = previewFetcher.data;
  const previewHtml = previewData?.ok === true ? previewData.html : null;
  const previewSubject = previewData?.ok === true ? previewData.subject : "";

  const isSaving = navigation.state === "submitting";

  // Explicit save only — no field auto-submits. isDirty just controls
  // whether Save is enabled; the merchant still has to click it.
  const isDirty =
    subject !== settings.subject ||
    detailsRowsKey !== JSON.stringify(settings.detailsRows) ||
    blocksKey !== JSON.stringify(settings.blocks);

  function updateBlock(id: string, updater: (block: TextEmailBlock) => TextEmailBlock) {
    setBlocks((current) =>
      current.map((block) => (block.id === id && block.type !== "table" ? updater(block) : block)),
    );
  }

  const usedSingletonTypes = new Set(
    blocks.filter((block) => SINGLETON_EMAIL_BLOCK_TYPES.has(block.type)).map((block) => block.type),
  );
  const addFieldOptions = EMAIL_BLOCK_TYPE_OPTIONS.map((option) => ({
    key: option.type,
    label: option.label,
    disabled: usedSingletonTypes.has(option.type),
  }));

  const availableRowOptions = DETAILS_ROW_OPTIONS.map((option) => ({
    key: option.key,
    label: option.label,
    disabled: detailsRows.includes(option.key),
  }));

  return (
    <div className="aen-admin-shell">
      <style>{`
        .aen-admin-shell {
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }

        .aen-templates-layout {
          display: grid;
          grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
          align-items: start;
          gap: 14px;
        }

        .aen-templates-main {
          display: flex;
          flex-direction: column;
          gap: 14px;
          min-width: 0;
        }

        .aen-preview-sidebar {
          position: sticky;
          top: 12px;
        }

        .aen-card {
          overflow: visible;
          background: #ffffff;
          border: 1px solid #e3e3e3;
          border-radius: 14px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03), 0 2px 8px rgba(0, 0, 0, 0.025);
        }

        .aen-preview-card {
          overflow: hidden;
          background: #ffffff;
          border: 1px solid #e3e3e3;
          border-radius: 14px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03), 0 2px 8px rgba(0, 0, 0, 0.025);
        }

        .aen-card-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding: 18px 20px;
          border-bottom: 1px solid #eeeeee;
        }

        .aen-card-body {
          padding: 20px;
        }

        .aen-hero {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
        }

        .aen-eyebrow {
          margin-bottom: 5px;
          font-size: 12px;
          line-height: 1.4;
          font-weight: 600;
          color: #616161;
        }

        .aen-title {
          margin: 0;
          font-size: 20px;
          line-height: 1.35;
          font-weight: 650;
          letter-spacing: -0.01em;
          color: #202223;
        }

        .aen-description {
          max-width: 680px;
          margin-top: 7px;
          font-size: 13px;
          line-height: 1.55;
          color: #616161;
        }

        .aen-section-title {
          margin: 0;
          font-size: 14px;
          line-height: 1.4;
          font-weight: 650;
          color: #303030;
        }

        .aen-helper {
          margin-top: 4px;
          font-size: 12px;
          line-height: 1.5;
          color: #707070;
        }

        .aen-variable-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          position: relative;
        }

        .aen-text-block-row {
          display: flex;
          align-items: flex-start;
          gap: 16px;
        }

        .aen-text-block-row > .aen-variable-field {
          flex: 1;
          min-width: 0;
        }

        .aen-text-block-row > .aen-color-field {
          flex: 0 0 auto;
          width: 180px;
        }

        .aen-text-block-stack {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .aen-variable-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-height: 28px;
        }

        .aen-field-label {
          font-size: 13px;
          line-height: 1.4;
          font-weight: 600;
          color: #303030;
        }

        .aen-required {
          margin-left: 3px;
          color: #8e1f0b;
        }

        .aen-rows-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .aen-row-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border: 1px solid #e3e3e3;
          border-radius: 10px;
          background: #fafafa;
        }

        .aen-row-label {
          flex: 1;
          min-width: 0;
          font-size: 13px;
          font-weight: 600;
          color: #303030;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .aen-row-controls {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }

        .aen-drag-handle {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          padding: 0;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: #8a8a8a;
          cursor: grab;
        }

        .aen-drag-handle:hover {
          background: #eeeeee;
          color: #303030;
        }

        .aen-drag-handle:active {
          cursor: grabbing;
        }

        .aen-sortable--dragging {
          opacity: 0.5;
        }

        .aen-add-row {
          margin-top: 12px;
        }

        .aen-block-item {
          border: 1px solid #e3e3e3;
          border-radius: 10px;
          background: #fafafa;
          overflow: hidden;
        }

        .aen-block-item--expanded {
          background: #ffffff;
        }

        .aen-block-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
        }

        .aen-block-toggle {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          background: none;
          border: 0;
          margin: 0;
          padding: 0;
          font: inherit;
          color: inherit;
          text-align: left;
          cursor: pointer;
        }

        .aen-block-body {
          padding: 12px 12px 16px;
          border-top: 1px solid #eeeeee;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .aen-color-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .aen-color-field-header {
          display: flex;
          align-items: center;
          min-height: 28px;
        }

        .aen-preview-subject {
          padding: 12px 16px;
          border-bottom: 1px solid #eeeeee;
          font-size: 13px;
          line-height: 1.4;
          color: #303030;
        }

        .aen-preview-subject strong {
          color: #707070;
          font-weight: 600;
          margin-right: 6px;
        }

        .aen-preview-frame {
          width: 100%;
          height: 640px;
          border: 0;
          display: block;
          background: #f3f4f6;
          pointer-events: none;
        }

        .aen-save-bar {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          min-height: 42px;
          padding: 10px 16px;
        }

        @media (max-width: 960px) {
          .aen-templates-layout {
            grid-template-columns: 1fr;
          }

          .aen-preview-sidebar {
            position: static;
          }
        }

        @media (max-width: 760px) {
          .aen-card-header,
          .aen-card-body {
            padding: 16px;
          }
        }
      `}</style>

      <Form method="post">
        <input type="hidden" name="detailsRows" value={detailsRowsKey} />
        <input type="hidden" name="blocks" value={blocksKey} />

        <s-page heading="Email templates" inlineSize="large">
          <div className="aen-templates-layout">
            <div className="aen-templates-main">
              <div className="aen-card">
                <div className="aen-card-body">
                  <div className="aen-hero">
                    <div>
                      <div className="aen-eyebrow">Affiliate notifier</div>
                      <h2 className="aen-title">Affiliate usage email</h2>
                      <div className="aen-description">
                        Build the notification affiliates get whenever their code is used, using
                        dynamic order and commission variables. The preview on the right always
                        matches exactly what they receive.
                      </div>
                    </div>

                    {gmailConfigured ? (
                      <s-badge tone="success">Gmail configured</s-badge>
                    ) : (
                      <s-badge tone="critical">Gmail not configured</s-badge>
                    )}
                  </div>
                </div>
              </div>

              {actionData?.ok === false ? (
                <s-banner tone="critical" heading="Unable to save email template">
                  {actionData.error}
                </s-banner>
              ) : null}

              <div className="aen-card">
                <div className="aen-card-header">
                  <div>
                    <h3 className="aen-section-title">Email subject</h3>
                    <div className="aen-helper">Shown as the subject line in the affiliate&rsquo;s inbox.</div>
                  </div>
                </div>

                <div className="aen-card-body">
                  <div className="aen-variable-field">
                    <VariableFieldHeader label="Email subject" required popoverId="subject-variable-popover" />
                    <s-text-field
                      label="Email subject"
                      labelAccessibilityVisibility="exclusive"
                      name="subject"
                      value={subject}
                      onInput={(event: FieldEvent) => setSubject(fieldValue(event))}
                      maxLength={200}
                      required
                    />
                    <VariablePicker
                      id="subject-variable-popover"
                      onInsert={(token) => setSubject((current) => appendVariable(current, token))}
                    />
                  </div>
                </div>
              </div>

              <div className="aen-card">
                <div className="aen-card-header">
                  <div>
                    <h3 className="aen-section-title">Email body</h3>
                    <div className="aen-helper">
                      Each row below is a block in the email. Click one to edit it, add as many
                      headings/text/buttons as you like, and give each its own color.
                    </div>
                  </div>

                  <div>
                    <s-button variant="tertiary" icon="plus" commandFor="add-block-popover">
                      Add field
                    </s-button>

                    <OptionPicker
                      id="add-block-popover"
                      title="Add field"
                      emptyText="No field types available."
                      options={addFieldOptions}
                      onSelect={(type) => {
                        const blockType = type as EmailBlockType;
                        const newBlock = createEmailBlock(blockType, createBlockId(blockType));
                        setBlocks((current) => [...current, newBlock]);
                        setExpandedBlockId(newBlock.id);
                      }}
                    />
                  </div>
                </div>

                <div className="aen-card-body">
                  <div className="aen-rows-list">
                    <DragDropProvider
                      onDragEnd={(event) => {
                        if (event.canceled) return;
                        setBlocks((current) => move(current, event) as EmailBlock[]);
                      }}
                    >
                      {blocks.map((block, index) => {
                        const isExpanded = expandedBlockId === block.id;
                        const label = getBlockPreviewLabel(block);

                        return (
                          <SortableRow
                            key={block.id}
                            id={block.id}
                            index={index}
                            group="email-blocks"
                            className={isExpanded ? "aen-block-item aen-block-item--expanded" : "aen-block-item"}
                          >
                            {({ handleRef }) => (
                              <>
                                <div className="aen-block-header">
                                  <button
                                    ref={handleRef}
                                    type="button"
                                    className="aen-drag-handle"
                                    aria-label={`Drag ${label} to reorder`}
                                  >
                                    <s-icon type="drag-handle" />
                                  </button>

                                  <button
                                    type="button"
                                    className="aen-block-toggle"
                                    aria-expanded={isExpanded}
                                    onClick={() =>
                                      setExpandedBlockId((current) => (current === block.id ? null : block.id))
                                    }
                                  >
                                    <span className="aen-row-label">{label}</span>
                                  </button>

                                  <div className="aen-row-controls">
                                    <s-button
                                      variant="tertiary"
                                      icon="arrow-up"
                                      accessibilityLabel={`Move ${label} up`}
                                      {...(index === 0 ? { disabled: true } : {})}
                                      onClick={() => setBlocks((current) => moveItem(current, index, -1))}
                                    />
                                    <s-button
                                      variant="tertiary"
                                      icon="arrow-down"
                                      accessibilityLabel={`Move ${label} down`}
                                      {...(index === blocks.length - 1 ? { disabled: true } : {})}
                                      onClick={() => setBlocks((current) => moveItem(current, index, 1))}
                                    />
                                    <s-button
                                      variant="tertiary"
                                      tone="critical"
                                      icon="delete"
                                      accessibilityLabel={`Remove ${label}`}
                                      onClick={() => {
                                        setBlocks((current) => current.filter((b) => b.id !== block.id));
                                        setExpandedBlockId((current) => (current === block.id ? null : current));
                                      }}
                                    />
                                  </div>
                                </div>

                                {isExpanded ? (
                                  <div className="aen-block-body">
                                    {block.type === "table" ? (
                                      <TableBlockEditor
                                        detailsRows={detailsRows}
                                        onChange={setDetailsRows}
                                        availableRowOptions={availableRowOptions}
                                      />
                                    ) : (
                                      <TextBlockEditor
                                        block={block}
                                        onChangeText={(text) =>
                                          updateBlock(block.id, (b) => ({ ...b, text }))
                                        }
                                        onChangeColor={(color) =>
                                          updateBlock(block.id, (b) => ({ ...b, color }))
                                        }
                                        onChangeTextColor={(textColor) =>
                                          updateBlock(block.id, (b) => ({ ...b, textColor }))
                                        }
                                      />
                                    )}
                                  </div>
                                ) : null}
                              </>
                            )}
                          </SortableRow>
                        );
                      })}
                    </DragDropProvider>
                  </div>
                </div>
              </div>

              <div className="aen-save-bar">
                <s-button variant="primary" type="submit" {...(isSaving || !isDirty ? { disabled: true } : {})} {...(isSaving ? { loading: true } : {})}>
                  Save
                </s-button>
              </div>
            </div>

            <div className="aen-preview-sidebar">
              <div className="aen-preview-card">
                {previewSubject ? (
                  <div className="aen-preview-subject">
                    <strong>Subject:</strong>
                    {previewSubject}
                  </div>
                ) : null}

                {previewHtml ? (
                  <iframe className="aen-preview-frame" title="Email preview" srcDoc={previewHtml} sandbox="" />
                ) : (
                  <div className="aen-card-body">
                    <s-text color="subdued">Preview loading…</s-text>
                  </div>
                )}
              </div>
            </div>
          </div>
        </s-page>
      </Form>
    </div>
  );
}

type TextBlockEditorProps = {
  block: TextEmailBlock;
  onChangeText: (text: string) => void;
  onChangeColor: (color: string | null) => void;
  onChangeTextColor: (color: string | null) => void;
};
function TextBlockEditor({ block, onChangeText, onChangeColor, onChangeTextColor }: TextBlockEditorProps) {
  const typeLabel = getEmailBlockTypeLabel(block.type);
  const popoverId = `variable-popover-${block.id}`;
  const maxLength = EMAIL_BLOCK_TEXT_MAX_LENGTH[block.type];
  const isDescription = block.type === "description";
  const isButton = block.type === "button";
  const colorLabel = isButton ? "Button background" : "Text color";

  const fieldAndPicker = (
    <div className="aen-variable-field">
      <VariableFieldHeader label={typeLabel} required popoverId={popoverId} />
      {isDescription ? (
        <s-text-area
          label={typeLabel}
          labelAccessibilityVisibility="exclusive"
          value={block.text}
          onInput={(event: FieldEvent) => onChangeText(fieldValue(event))}
          rows={6}
          maxLength={maxLength}
          required
        />
      ) : (
        <s-text-field
          label={typeLabel}
          labelAccessibilityVisibility="exclusive"
          value={block.text}
          onInput={(event: FieldEvent) => onChangeText(fieldValue(event))}
          maxLength={maxLength}
          required
        />
      )}
      <VariablePicker id={popoverId} onInsert={(token) => onChangeText(appendVariable(block.text, token))} />
    </div>
  );

  const colorFields = isButton ? (
    <>
      <ColorField
        label={colorLabel}
        value={block.color}
        defaultColor={getDefaultEmailBlockColor(block.type)}
        onChange={onChangeColor}
      />
      <ColorField
        label="Button text color"
        value={block.textColor}
        defaultColor={getDefaultEmailButtonTextColor()}
        onChange={onChangeTextColor}
      />
    </>
  ) : (
    <ColorField
      label={colorLabel}
      value={block.color}
      defaultColor={getDefaultEmailBlockColor(block.type)}
      onChange={onChangeColor}
    />
  );

  if (isDescription) {
    return (
      <div className="aen-text-block-stack">
        {fieldAndPicker}
        {colorFields}
      </div>
    );
  }

  return (
    <div className="aen-text-block-row">
      {fieldAndPicker}
      {colorFields}
    </div>
  );
}

type TableBlockEditorProps = {
  detailsRows: DetailsRowKey[];
  onChange: (updater: (current: DetailsRowKey[]) => DetailsRowKey[]) => void;
  availableRowOptions: { key: string; label: string; disabled?: boolean }[];
};
function TableBlockEditor({ detailsRows, onChange, availableRowOptions }: TableBlockEditorProps) {
  return (
    <>
      <div className="aen-rows-list">
        <DragDropProvider
          onDragEnd={(event) => {
            if (event.canceled) return;
            onChange((current) => move(current, event) as DetailsRowKey[]);
          }}
        >
          {detailsRows.map((rowKey, rowIndex) => (
            <SortableRow key={rowKey} id={rowKey} index={rowIndex} group="email-details-rows" className="aen-row-item">
              {({ handleRef }) => (
                <>
                  <button
                    ref={handleRef}
                    type="button"
                    className="aen-drag-handle"
                    aria-label={`Drag ${getDetailsRowLabel(rowKey)} to reorder`}
                  >
                    <s-icon type="drag-handle" />
                  </button>

                  <div className="aen-row-label">{getDetailsRowLabel(rowKey)}</div>

                  <div className="aen-row-controls">
                    <s-button
                      variant="tertiary"
                      icon="arrow-up"
                      accessibilityLabel={`Move ${getDetailsRowLabel(rowKey)} up`}
                      {...(rowIndex === 0 ? { disabled: true } : {})}
                      onClick={() => onChange((current) => moveItem(current, rowIndex, -1))}
                    />
                    <s-button
                      variant="tertiary"
                      icon="arrow-down"
                      accessibilityLabel={`Move ${getDetailsRowLabel(rowKey)} down`}
                      {...(rowIndex === detailsRows.length - 1 ? { disabled: true } : {})}
                      onClick={() => onChange((current) => moveItem(current, rowIndex, 1))}
                    />
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      icon="delete"
                      accessibilityLabel={`Remove ${getDetailsRowLabel(rowKey)} row`}
                      onClick={() =>
                        onChange((current) => current.filter((_, currentIndex) => currentIndex !== rowIndex))
                      }
                    />
                  </div>
                </>
              )}
            </SortableRow>
          ))}
        </DragDropProvider>
      </div>

      <div className="aen-add-row">
        <s-button variant="tertiary" commandFor="add-row-popover">
          Add row
        </s-button>

        <OptionPicker
          id="add-row-popover"
          title="Add row"
          emptyText="Every available row has been added."
          options={availableRowOptions}
          onSelect={(key) => onChange((current) => [...current, key as DetailsRowKey])}
        />
      </div>
    </>
  );
}
