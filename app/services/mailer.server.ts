import nodemailer from "nodemailer";
import { getEmailTemplate } from "./settings/email-template.service.server";
import { buildAffiliateEmail } from "./email/affiliate-email.server";
import { formatValue, type ValueType } from "../lib/value-type";
import type { AffiliateTemplateValues } from "../lib/affiliate-email-template";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return transporter;
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
  const template = await getEmailTemplate(shop);

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

  await getTransporter().sendMail({
    from: process.env.GMAIL_USER,
    to: affiliateEmail,
    subject,
    html,
    text,
  });
}
