import {
  getDetailsRowLabel,
  renderAffiliateEmailTemplate,
  type AffiliateTemplateValues,
  type DetailsRowKey,
  type EmailBlock,
  type TextEmailBlock,
} from "../../lib/affiliate-email-template";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlWithLineBreaks(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

function isSafeHexColor(value: string | null): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function buildTableHtml(detailsRows: DetailsRowKey[], values: AffiliateTemplateValues): string {
  const rows = detailsRows
    .map(
      (key) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e1e3e5;color:#6d7175;font-size:13px;">${escapeHtml(getDetailsRowLabel(key))}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e1e3e5;color:#202223;font-size:13px;text-align:right;">${escapeHtml(values[key])}</td>
      </tr>`,
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e1e3e5;border-radius:8px;overflow:hidden;">
      ${rows}
    </table>`;
}

function buildTextBlockHtml(block: TextEmailBlock, values: AffiliateTemplateValues): string {
  const rendered = escapeHtmlWithLineBreaks(
    renderAffiliateEmailTemplate(block.text, values),
  );
  const color = isSafeHexColor(block.color) ? block.color : null;

  switch (block.type) {
    case "tagline":
      return `<p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:${color ?? "#6d7175"};">${rendered}</p>`;
    case "heading":
      return `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:${color ?? "#202223"};">${rendered}</h1>`;
    case "description":
      return `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${color ?? "#202223"};">${rendered}</p>`;
    case "button": {
      const textColor = isSafeHexColor(block.textColor) ? block.textColor : "#ffffff";
      const background = color ?? "#202223";
      return `
        <a href="${escapeHtml(values.store_url)}" style="display:inline-block;margin:8px 0 0;padding:12px 20px;border-radius:6px;background:${background};color:${textColor};text-decoration:none;font-size:14px;font-weight:600;">
          ${rendered}
        </a>`;
    }
    default:
      return "";
  }
}

function buildBlockHtml(
  block: EmailBlock,
  detailsRows: DetailsRowKey[],
  values: AffiliateTemplateValues,
): string {
  if (block.type === "table") return buildTableHtml(detailsRows, values);
  return buildTextBlockHtml(block, values);
}

function buildBlockText(
  block: EmailBlock,
  detailsRows: DetailsRowKey[],
  values: AffiliateTemplateValues,
): string {
  if (block.type === "table") {
    return detailsRows.map((key) => `${getDetailsRowLabel(key)}: ${values[key]}`).join("\n");
  }
  const rendered = renderAffiliateEmailTemplate(block.text, values);
  return block.type === "button" ? `${rendered}: ${values.store_url}` : rendered;
}

export function buildAffiliateEmail({
  emailSubject,
  emailBlocks,
  detailsRows,
  values,
}: {
  emailSubject: string;
  emailBlocks: EmailBlock[];
  detailsRows: DetailsRowKey[];
  values: AffiliateTemplateValues;
}): { subject: string; html: string; text: string } {
  const subject = renderAffiliateEmailTemplate(emailSubject, values);
  const contentBlocksHtml = emailBlocks
    .map((block) => buildBlockHtml(block, detailsRows, values))
    .join("");
  const contentBlocksText = emailBlocks
    .map((block) => buildBlockText(block, detailsRows, values))
    .join("\n\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f2f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f2f3;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;">
            <tr>
              <td>${contentBlocksHtml}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text: contentBlocksText };
}
