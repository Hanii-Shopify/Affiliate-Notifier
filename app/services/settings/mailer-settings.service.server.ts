import db from "../../db.server";

export async function getGmailCredentials(shop: string) {
  const record = await db.mailerSettings.findUnique({ where: { shop } });

  const gmailUser = record?.gmailUser || process.env.GMAIL_USER || "";
  const gmailAppPassword = record?.gmailAppPassword || process.env.GMAIL_APP_PASSWORD || "";

  return {
    gmailUser,
    gmailAppPassword,
    isConfigured: Boolean(gmailUser && gmailAppPassword),
  };
}

export async function saveGmailCredentials(
  shop: string,
  { gmailUser, gmailAppPassword }: { gmailUser: string; gmailAppPassword?: string },
) {
  const existing = await db.mailerSettings.findUnique({ where: { shop } });

  // A blank password field means "keep the current one" — the saved
  // password is never sent back to the browser, so there's nothing for
  // the form to resubmit unless the merchant actually typed a new one.
  const nextPassword = gmailAppPassword || existing?.gmailAppPassword || null;

  await db.mailerSettings.upsert({
    where: { shop },
    create: { shop, gmailUser, gmailAppPassword: nextPassword },
    update: { gmailUser, gmailAppPassword: nextPassword },
  });
}
