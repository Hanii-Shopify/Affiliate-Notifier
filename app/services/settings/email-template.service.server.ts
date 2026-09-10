import db from "../../db.server";
import {
  parseEmailBlocks,
  parseDetailsRows,
  type EmailBlock,
  type DetailsRowKey,
} from "../../lib/affiliate-email-template";
import {
  DEFAULT_DETAILS_ROWS,
  DEFAULT_EMAIL_BLOCKS,
  DEFAULT_EMAIL_SUBJECT,
} from "../../config/email-template-defaults.server";

export async function getEmailTemplate(shop: string) {
  const record = await db.emailTemplate.findUnique({ where: { shop } });

  return {
    subject: record?.subject ?? DEFAULT_EMAIL_SUBJECT,
    blocks: parseEmailBlocks(record?.blocks, DEFAULT_EMAIL_BLOCKS),
    detailsRows: record?.detailsRows
      ? parseDetailsRows(record.detailsRows)
      : DEFAULT_DETAILS_ROWS,
    updatedAt: record?.updatedAt.toISOString() ?? null,
  };
}

export async function saveEmailTemplate(
  shop: string,
  {
    subject,
    blocks,
    detailsRows,
  }: { subject: string; blocks: EmailBlock[]; detailsRows: DetailsRowKey[] },
) {
  await db.emailTemplate.upsert({
    where: { shop },
    create: {
      shop,
      subject,
      blocks: JSON.stringify(blocks),
      detailsRows: JSON.stringify(detailsRows),
    },
    update: {
      subject,
      blocks: JSON.stringify(blocks),
      detailsRows: JSON.stringify(detailsRows),
    },
  });
}
