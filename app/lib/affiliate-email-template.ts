export const EMAIL_BLOCK_TYPE_OPTIONS = [
  { type: "tagline", label: "Tagline", description: "Small eyebrow text above the heading." },
  { type: "heading", label: "Heading", description: "A large headline." },
  { type: "description", label: "Text", description: "A paragraph of body text." },
  { type: "table", label: "Details table", description: "Order, discount, and commission details." },
  { type: "button", label: "Button", description: "A call-to-action button." },
] as const;

export type EmailBlockType = (typeof EMAIL_BLOCK_TYPE_OPTIONS)[number]["type"];

// Only one details table makes sense in a single email.
export const SINGLETON_EMAIL_BLOCK_TYPES = new Set<EmailBlockType>(["table"]);

export type TextEmailBlock = {
  id: string;
  type: "tagline" | "heading" | "description" | "button";
  text: string;
  color: string | null;
  textColor: string | null;
};

export type TableEmailBlock = {
  id: string;
  type: "table";
};

export type EmailBlock = TextEmailBlock | TableEmailBlock;

export const EMAIL_BLOCK_TEXT_MAX_LENGTH: Record<TextEmailBlock["type"], number> = {
  tagline: 200,
  heading: 200,
  description: 2000,
  button: 100,
};

const DEFAULT_TEXT_BY_TYPE: Record<TextEmailBlock["type"], string> = {
  tagline: "Nice work!",
  heading: "Your code was just used",
  description: "A new order came in.",
  button: "Visit store",
};

const DEFAULT_COLOR_BY_TYPE: Record<TextEmailBlock["type"], string> = {
  tagline: "#6d7175",
  heading: "#202223",
  description: "#202223",
  button: "#202223",
};

export function getDefaultEmailBlockColor(type: TextEmailBlock["type"]): string {
  return DEFAULT_COLOR_BY_TYPE[type];
}

export function getDefaultEmailButtonTextColor(): string {
  return "#ffffff";
}

export function getEmailBlockTypeLabel(type: EmailBlockType): string {
  return EMAIL_BLOCK_TYPE_OPTIONS.find((option) => option.type === type)!.label;
}

export function createBlockId(type: EmailBlockType): string {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmailBlock(type: EmailBlockType, id: string): EmailBlock {
  if (type === "table") {
    return { id, type: "table" };
  }
  return {
    id,
    type,
    text: DEFAULT_TEXT_BY_TYPE[type],
    color: null,
    textColor: type === "button" ? null : null,
  };
}

function isTextBlockType(type: unknown): type is TextEmailBlock["type"] {
  return type === "tagline" || type === "heading" || type === "description" || type === "button";
}

function isSafeHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function parseEmailBlocks(
  value: string | null | undefined,
  fallback: EmailBlock[],
): EmailBlock[] {
  if (!value) return fallback;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return fallback;

    const blocks: EmailBlock[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const { id, type } = entry as { id?: unknown; type?: unknown };
      if (typeof id !== "string") continue;

      if (type === "table") {
        blocks.push({ id, type: "table" });
      } else if (isTextBlockType(type)) {
        const text = typeof entry.text === "string" ? entry.text : "";
        blocks.push({
          id,
          type,
          text,
          color: isSafeHexColor(entry.color) ? entry.color : null,
          textColor: isSafeHexColor(entry.textColor) ? entry.textColor : null,
        });
      }
    }

    return blocks.length > 0 ? blocks : fallback;
  } catch {
    return fallback;
  }
}

export const AFFILIATE_EMAIL_TEMPLATE_VARIABLES = [
  { key: "affiliate_name", token: "{{affiliate_name}}", label: "Affiliate name", description: "The affiliate's name." },
  { key: "affiliate_email", token: "{{affiliate_email}}", label: "Affiliate email", description: "The affiliate's email address." },
  { key: "discount_code", token: "{{discount_code}}", label: "Discount code", description: "Their Shopify discount code." },
  { key: "commission_rate", token: "{{commission_rate}}", label: "Your commission", description: "Their commission rate, e.g. 10% or $5.00." },
  { key: "order_name", token: "{{order_name}}", label: "Order", description: "The order that used their code, e.g. #1012." },
  { key: "order_value", token: "{{order_value}}", label: "Order amount", description: "The order's total value." },
  { key: "total_commission", token: "{{total_commission}}", label: "Total earned", description: "Commission earned all-time." },
  { key: "paid_commission", token: "{{paid_commission}}", label: "Paid", description: "Commission already paid out." },
  { key: "pending_commission", token: "{{pending_commission}}", label: "Pending", description: "Commission not yet paid." },
  { key: "shop_domain", token: "{{shop_domain}}", label: "Shop domain", description: "The store's myshopify.com domain." },
  { key: "store_url", token: "{{store_url}}", label: "Store URL", description: "The storefront homepage URL." },
] as const;

export type AffiliateTemplateVariableKey =
  (typeof AFFILIATE_EMAIL_TEMPLATE_VARIABLES)[number]["key"];

export type AffiliateTemplateValues = Record<AffiliateTemplateVariableKey, string>;

const ALLOWED_VARIABLE_KEYS = new Set<string>(
  AFFILIATE_EMAIL_TEMPLATE_VARIABLES.map((variable) => variable.key),
);

function isAllowedVariableKey(key: string): key is AffiliateTemplateVariableKey {
  return ALLOWED_VARIABLE_KEYS.has(key);
}

export function renderAffiliateEmailTemplate(
  template: string,
  values: AffiliateTemplateValues,
): string {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (match, key: string) =>
    isAllowedVariableKey(key) ? values[key] : match,
  );
}

export function appendVariable(value: string, token: string): string {
  if (!value) return token;
  const needsSpace = !value.endsWith(" ") && !value.endsWith("\n");
  return `${value}${needsSpace ? " " : ""}${token}`;
}

// The collapsed row's label previews the block's actual text (per-type,
// so a merchant can tell two headings apart without opening either one)
// instead of just the generic type name.
export function getBlockPreviewLabel(block: EmailBlock): string {
  const typeLabel = getEmailBlockTypeLabel(block.type);
  if (block.type === "table") return typeLabel;

  const trimmed = block.text.trim();
  if (!trimmed) return `${typeLabel} — empty`;

  const preview = trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
  return `${typeLabel}: ${preview}`;
}

// Generic so it can reorder either the details-table rows or the blocks
// list — same swap logic either way.
export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(targetIndex, 0, item);
  return next;
}

export const DETAILS_ROW_OPTIONS = [
  { key: "order_name", label: "Recent order number" },
  { key: "order_value", label: "Recent order amount" },
  { key: "discount_code", label: "Discount code" },
  { key: "commission_rate", label: "Your commission" },
  { key: "total_commission", label: "Total earned" },
  { key: "paid_commission", label: "Paid" },
  { key: "pending_commission", label: "Pending" },
] as const;

export type DetailsRowKey = (typeof DETAILS_ROW_OPTIONS)[number]["key"];

const ALLOWED_DETAILS_ROW_KEYS = new Set<string>(
  DETAILS_ROW_OPTIONS.map((option) => option.key),
);

function isDetailsRowKey(value: unknown): value is DetailsRowKey {
  return typeof value === "string" && ALLOWED_DETAILS_ROW_KEYS.has(value);
}

export function getDetailsRowLabel(key: DetailsRowKey): string {
  return DETAILS_ROW_OPTIONS.find((option) => option.key === key)!.label;
}

export function parseDetailsRows(value: string | null | undefined): DetailsRowKey[] {
  if (!value) return DETAILS_ROW_OPTIONS.map((option) => option.key);

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return DETAILS_ROW_OPTIONS.map((option) => option.key);

    const keys = parsed.filter(isDetailsRowKey);
    // De-duplicate while preserving order, in case of corrupt/hand-edited data.
    const seen = new Set<DetailsRowKey>();
    const deduped: DetailsRowKey[] = [];
    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(key);
    }

    return deduped;
  } catch {
    return DETAILS_ROW_OPTIONS.map((option) => option.key);
  }
}
