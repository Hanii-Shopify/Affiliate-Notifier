import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  getGmailCredentials,
  saveGmailCredentials,
} from "../services/settings/mailer-settings.service.server";
import { sendTestEmail } from "../services/mailer.server";
import { isValidEmail } from "../lib/validation";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const credentials = await getGmailCredentials(session.shop);

  return {
    gmailUser: credentials.gmailUser,
    hasAppPassword: Boolean(credentials.gmailAppPassword),
    isConfigured: credentials.isConfigured,
  };
};

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save") {
    const gmailUser = String(formData.get("gmailUser") ?? "").trim();
    const gmailAppPassword = String(formData.get("gmailAppPassword") ?? "").trim();

    if (!gmailUser || !isValidEmail(gmailUser)) {
      return { ok: false, error: "Enter a valid Gmail address." };
    }

    await saveGmailCredentials(session.shop, {
      gmailUser,
      gmailAppPassword: gmailAppPassword || undefined,
    });

    return { ok: true, message: "Settings saved." };
  }

  if (intent === "sendTest") {
    try {
      await sendTestEmail(session.shop);
      return { ok: true, message: "Test email sent — check the inbox." };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to send test email.",
      };
    }
  }

  return { ok: false, error: "Unknown action." };
};

type FieldEvent = { target: EventTarget | null; currentTarget: EventTarget | null };
function fieldValue(event: FieldEvent): string {
  return ((event.target ?? event.currentTarget) as { value?: string } | null)?.value ?? "";
}

export default function Settings() {
  const { gmailUser: savedGmailUser, hasAppPassword, isConfigured } = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<ActionResult>();
  const testFetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();

  const [gmailUser, setGmailUser] = useState(savedGmailUser);
  const [gmailAppPassword, setGmailAppPassword] = useState("");

  const isSaving = saveFetcher.state !== "idle";
  const isSendingTest = testFetcher.state !== "idle";

  const emailError =
    gmailUser.trim() !== "" && !isValidEmail(gmailUser) ? "Enter a valid email address." : undefined;

  const isDirty = gmailUser !== savedGmailUser || gmailAppPassword.trim() !== "";
  const isValid = isValidEmail(gmailUser) && (hasAppPassword || gmailAppPassword.trim() !== "");

  useEffect(() => {
    if (saveFetcher.data?.ok === true) {
      shopify.toast.show(saveFetcher.data.message);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGmailAppPassword("");
    } else if (saveFetcher.data?.ok === false) {
      shopify.toast.show(saveFetcher.data.error, { isError: true });
    }
  }, [saveFetcher.data, shopify]);

  useEffect(() => {
    if (testFetcher.data?.ok === true) {
      shopify.toast.show(testFetcher.data.message);
    } else if (testFetcher.data?.ok === false) {
      shopify.toast.show(testFetcher.data.error, { isError: true });
    }
  }, [testFetcher.data, shopify]);

  return (
    <s-page heading="Settings">
      <s-section heading="Gmail sender">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" alignItems="center" gap="small">
            {isConfigured ? (
              <s-badge tone="success">Configured</s-badge>
            ) : (
              <s-badge tone="critical">Not configured</s-badge>
            )}
            <s-text color="subdued">
              Affiliate notification emails are sent from this Gmail address.
            </s-text>
          </s-stack>

          <s-email-field
            label="Gmail address"
            value={gmailUser}
            required
            error={emailError}
            onInput={(event: FieldEvent) => setGmailUser(fieldValue(event))}
          ></s-email-field>

          <s-password-field
            label="Gmail app password"
            value={gmailAppPassword}
            placeholder={hasAppPassword ? "Leave blank to keep the current password" : "16-character app password"}
            onInput={(event: FieldEvent) => setGmailAppPassword(fieldValue(event))}
          ></s-password-field>

          <s-box padding="base" background="subdued" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">How to get an app password</s-text>
              <s-text color="subdued">
                This isn&apos;t your normal Gmail password. Turn on 2-Step Verification on the
                Gmail account, then generate one at{" "}
                <s-link href="https://myaccount.google.com/apppasswords" target="_blank">
                  myaccount.google.com/apppasswords
                </s-link>{" "}
                and paste it here (spaces don&apos;t matter).
              </s-text>
            </s-stack>
          </s-box>

          <s-stack direction="inline" gap="small">
            <s-button
              variant="primary"
              disabled={!isValid || !isDirty || isSaving}
              {...(isSaving ? { loading: true } : {})}
              onClick={() =>
                saveFetcher.submit(
                  { intent: "save", gmailUser, gmailAppPassword },
                  { method: "post" },
                )
              }
            >
              Save
            </s-button>

            <s-button
              variant="secondary"
              disabled={!isConfigured || isSendingTest}
              {...(isSendingTest ? { loading: true } : {})}
              onClick={() => testFetcher.submit({ intent: "sendTest" }, { method: "post" })}
            >
              Send test email
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}
