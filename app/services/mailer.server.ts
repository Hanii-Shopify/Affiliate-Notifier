import nodemailer from "nodemailer";
import { getEmailTemplate } from "./settings/email-template.service.server";
import { getGmailCredentials } from "./settings/mailer-settings.service.server";
import { buildAffiliateEmail } from "./email/affiliate-email.server";
import { formatValue, type ValueType } from "../lib/value-type";
import type { AffiliateTemplateValues } from "../lib/affiliate-email-template";

// Built fresh per send rather than cached — credentials can now change
// at runtime via the Settings page, so a module-level singleton would
// keep sending through a stale/old Gmail account until the process
// restarted.
function createTransporter(gmailUser: string, gmailAppPassword: string) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailAppPassword },
  });
}

export async function sendAffiliateUsageEmail({
  shop,
  affiliateName,
  affiliateEmail,
  discountCode,
  commissionType,
  commissionValue,
  orderName,
  orderValue,
  currency,
  totalCommission,
  paidCommission,
  pendingCommission,
}: {
  shop: string;
  affiliateName: string;
  affiliateEmail: string;
  discountCode: string;
  commissionType: ValueType;
  commissionValue: number;
  orderName: string;
  orderValue: string;
  currency: string;
  totalCommission: number;
  paidCommission: number;
  pendingCommission: number;
}) {
  const [template, credentials] = await Promise.all([
    getEmailTemplate(shop),
    getGmailCredentials(shop),
  ]);

  if (!credentials.isConfigured) {
    throw new Error("Gmail sender isn't configured yet — set it up on the Settings page.");
  }

  const values: AffiliateTemplateValues = {
    affiliate_name: affiliateName,
    affiliate_email: affiliateEmail,
    discount_code: discountCode,
    commission_rate: formatValue(commissionType, commissionValue),
    order_name: orderName,
    order_value: `${orderValue} ${currency}`,
    total_commission: `$${totalCommission.toFixed(2)}`,
    paid_commission: `$${paidCommission.toFixed(2)}`,
    pending_commission: `$${pendingCommission.toFixed(2)}`,
    shop_domain: shop,
    store_url: `https://${shop}`,
  };

  const { subject, html, text } = buildAffiliateEmail({
    emailSubject: template.subject,
    emailBlocks: template.blocks,
    detailsRows: template.detailsRows,
    values,
  });

  await createTransporter(credentials.gmailUser, credentials.gmailAppPassword).sendMail({
    from: credentials.gmailUser,
    to: affiliateEmail,
    subject,
    html,
    text,
  });
}

export async function sendTestEmail(shop: string) {
  const credentials = await getGmailCredentials(shop);

  if (!credentials.isConfigured) {
    throw new Error("Enter and save a Gmail address and app password first.");
  }

  await createTransporter(credentials.gmailUser, credentials.gmailAppPassword).sendMail({
    from: credentials.gmailUser,
    to: credentials.gmailUser,
    subject: "Affiliate Notifier — test email",
    text: "This confirms your Gmail sender is set up correctly. Affiliate notifications will be sent from this address.",
  });
}
