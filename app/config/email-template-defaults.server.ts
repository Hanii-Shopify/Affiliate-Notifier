import type { EmailBlock, DetailsRowKey } from "../lib/affiliate-email-template";

export const DEFAULT_EMAIL_SUBJECT =
  "Your code {{discount_code}} was just used!";

export const DEFAULT_EMAIL_BLOCKS: EmailBlock[] = [
  {
    id: "tagline-1",
    type: "tagline",
    text: "Nice work, {{affiliate_name}}!",
    color: null,
    textColor: null,
  },
  {
    id: "heading-1",
    type: "heading",
    text: "Your code was just used",
    color: null,
    textColor: null,
  },
  {
    id: "description-1",
    type: "description",
    text: "Your discount code {{discount_code}} was just used on order {{order_name}} for {{order_value}}. Thanks for driving sales!",
    color: null,
    textColor: null,
  },
  {
    id: "table-1",
    type: "table",
  },
];

export const DEFAULT_DETAILS_ROWS: DetailsRowKey[] = [
  "order_name",
  "order_value",
  "discount_code",
  "commission_rate",
  "total_commission",
  "paid_commission",
  "pending_commission",
];
