import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { buildAffiliateEmail } from "../services/email/affiliate-email.server";
import {
  parseEmailBlocks,
  parseDetailsRows,
  type AffiliateTemplateValues,
} from "../lib/affiliate-email-template";
import {
  DEFAULT_DETAILS_ROWS,
  DEFAULT_EMAIL_BLOCKS,
} from "../config/email-template-defaults.server";

// Renders a live preview of the merchant's in-progress edits using the
// exact same buildAffiliateEmail() function the order webhook calls for
// real sends — never a second, hand-maintained copy of the markup that
// could drift out of sync.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const emailSubject = String(formData.get("emailSubject") ?? "");
  const emailBlocks = parseEmailBlocks(
    String(formData.get("emailBlocks") ?? ""),
    DEFAULT_EMAIL_BLOCKS,
  );
  const detailsRowsRaw = String(formData.get("emailDetailsRows") ?? "");
  const detailsRows = detailsRowsRaw ? parseDetailsRows(detailsRowsRaw) : DEFAULT_DETAILS_ROWS;

  const values: AffiliateTemplateValues = {
    affiliate_name: "Jamie Rivera",
    affiliate_email: "jamie@example.com",
    discount_code: "JAMIE10",
    commission_rate: "10%",
    order_name: "#1012",
    order_value: "$85.00",
    total_commission: "$240.00",
    paid_commission: "$150.00",
    pending_commission: "$90.00",
    shop_domain: session.shop,
    store_url: `https://${session.shop}`,
  };

  const { subject, html } = buildAffiliateEmail({
    emailSubject,
    emailBlocks,
    detailsRows,
    values,
  });

  return { ok: true, subject, html };
};
