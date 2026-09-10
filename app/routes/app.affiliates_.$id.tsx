import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  activateAffiliateDiscount,
  deactivateAffiliateDiscount,
  deleteAffiliateDiscount,
  updateAffiliateDiscount,
} from "../services/shopify-discounts.server";
import { formatValue, type ValueType } from "../lib/value-type";
import { isValidEmail } from "../lib/validation";
import { formatDateTime } from "../lib/format";
import { sendAffiliateUsageEmail } from "../services/mailer.server";

const RECORD_PAYOUT_MODAL_ID = "record-payout-modal";
const DELETE_MODAL_ID = "delete-affiliate-modal";
const EDIT_MODAL_ID = "edit-affiliate-modal";

function isValueType(value: FormDataEntryValue | null): value is ValueType {
  return value === "PERCENTAGE" || value === "FIXED_AMOUNT";
}

type OverlayElement = HTMLElement & { hideOverlay?: () => void };
function hideOverlay(id: string) {
  (document.getElementById(id) as OverlayElement | null)?.hideOverlay?.();
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const affiliate = await db.affiliate.findUnique({
    where: { id: params.id },
    include: {
      usageEvents: { orderBy: { createdAt: "desc" } },
      payouts: { orderBy: { paidAt: "desc" } },
    },
  });

  if (!affiliate || affiliate.shop !== session.shop) {
    throw new Response("Affiliate not found.", { status: 404 });
  }

  const totalRevenue = affiliate.usageEvents.reduce(
    (sum, event) => sum + Number(event.orderValue),
    0,
  );
  const totalCommission = affiliate.usageEvents.reduce(
    (sum, event) => sum + Number(event.commissionEarned),
    0,
  );
  const paidCommission = affiliate.payouts.reduce(
    (sum, payout) => sum + Number(payout.amount),
    0,
  );
  const pendingCommission = Math.max(0, totalCommission - paidCommission);

  return {
    affiliate: {
      id: affiliate.id,
      name: affiliate.name,
      email: affiliate.email,
      discountCode: affiliate.discountCode,
      discountType: affiliate.discountType as ValueType,
      discountValue: affiliate.discountValue,
      commissionType: affiliate.commissionType as ValueType,
      commissionValue: affiliate.commissionValue,
      active: affiliate.active,
    },
    totalRevenue,
    totalDiscountUsage: affiliate.usageEvents.length,
    totalCommission,
    paidCommission,
    pendingCommission,
    events: affiliate.usageEvents.map((event) => ({
      id: event.id,
      orderName: event.orderName,
      orderValue: Number(event.orderValue),
      currency: event.currency,
      commissionEarned: Number(event.commissionEarned),
      emailSent: event.emailSent,
      createdAt: event.createdAt.toISOString(),
    })),
    payouts: affiliate.payouts.map((payout) => ({
      id: payout.id,
      amount: Number(payout.amount),
      paidAt: payout.paidAt.toISOString(),
    })),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const affiliate = await db.affiliate.findUnique({ where: { id: params.id } });
  if (!affiliate || affiliate.shop !== session.shop) {
    return { error: "Affiliate not found." };
  }

  if (intent === "update") {
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const discountType = isValueType(formData.get("discountType"))
      ? (formData.get("discountType") as ValueType)
      : "PERCENTAGE";
    const discountValue = Number(formData.get("discountValue"));
    const commissionType = isValueType(formData.get("commissionType"))
      ? (formData.get("commissionType") as ValueType)
      : "PERCENTAGE";
    const commissionValue = Number(formData.get("commissionValue"));
    const customCode = String(formData.get("discountCode") ?? "").trim();

    if (!name || !email || !discountValue || !commissionValue) {
      return { error: "Name, email, discount, and commission are all required." };
    }

    if (!isValidEmail(email)) {
      return { error: "Enter a valid email address." };
    }

    try {
      const { discountCode } = await updateAffiliateDiscount(
        admin,
        affiliate.shopifyDiscountId,
        { name, discountType, discountValue, customCode: customCode || undefined },
      );

      await db.affiliate.update({
        where: { id: affiliate.id },
        data: {
          name,
          email,
          discountType,
          discountValue,
          commissionType,
          commissionValue,
          ...(discountCode ? { discountCode } : {}),
        },
      });

      return { success: true, message: "Affiliate updated." };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { error: "That discount code is already in use." };
      }
      return {
        error: error instanceof Error ? error.message : "Failed to update affiliate.",
      };
    }
  }

  if (intent === "recordPayout") {
    const amount = Number(formData.get("amount"));
    if (!amount || amount <= 0) {
      return { error: "Enter an amount greater than zero." };
    }

    const [usageEvents, payouts] = await Promise.all([
      db.usageEvent.findMany({
        where: { affiliateId: affiliate.id },
        select: { commissionEarned: true },
      }),
      db.payout.findMany({
        where: { affiliateId: affiliate.id },
        select: { amount: true },
      }),
    ]);
    const totalCommission = usageEvents.reduce(
      (sum, event) => sum + Number(event.commissionEarned),
      0,
    );
    const paidCommission = payouts.reduce((sum, payout) => sum + Number(payout.amount), 0);
    const pendingCommission = Math.max(0, totalCommission - paidCommission);

    if (amount > pendingCommission) {
      return {
        error: `Can't exceed the pending payout of $${pendingCommission.toFixed(2)}.`,
      };
    }

    await db.payout.create({
      data: { affiliateId: affiliate.id, amount },
    });
    return { success: true, message: "Payment recorded." };
  }

  if (intent === "pause" || intent === "resume") {
    try {
      if (intent === "pause") {
        await deactivateAffiliateDiscount(admin, affiliate.shopifyDiscountId);
      } else {
        await activateAffiliateDiscount(admin, affiliate.shopifyDiscountId);
      }
      await db.affiliate.update({
        where: { id: affiliate.id },
        data: { active: intent === "resume" },
      });
      return {
        success: true,
        message: intent === "pause" ? "Affiliate paused." : "Affiliate resumed.",
      };
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : `Failed to ${intent} affiliate.`,
      };
    }
  }

  if (intent === "resendEmail") {
    const usageEventId = String(formData.get("usageEventId") ?? "");
    const usageEvent = await db.usageEvent.findUnique({
      where: { id: usageEventId },
    });

    if (!usageEvent || usageEvent.affiliateId !== affiliate.id) {
      return { error: "Order not found." };
    }

    const [allEvents, allPayouts] = await Promise.all([
      db.usageEvent.findMany({
        where: { affiliateId: affiliate.id },
        select: { commissionEarned: true },
      }),
      db.payout.findMany({
        where: { affiliateId: affiliate.id },
        select: { amount: true },
      }),
    ]);
    const totalCommission = allEvents.reduce(
      (sum, event) => sum + Number(event.commissionEarned),
      0,
    );
    const paidCommission = allPayouts.reduce((sum, payout) => sum + Number(payout.amount), 0);
    const pendingCommission = Math.max(0, totalCommission - paidCommission);

    try {
      await sendAffiliateUsageEmail({
        shop: session.shop,
        affiliateName: affiliate.name,
        affiliateEmail: affiliate.email,
        discountCode: affiliate.discountCode,
        commissionType: affiliate.commissionType as ValueType,
        commissionValue: affiliate.commissionValue,
        orderName: usageEvent.orderName,
        orderValue: usageEvent.orderValue.toString(),
        currency: usageEvent.currency,
        totalCommission,
        paidCommission,
        pendingCommission,
      });
      await db.usageEvent.update({
        where: { id: usageEventId },
        data: { emailSent: true, emailError: null },
      });
      return { success: true, message: "Email resent." };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.usageEvent.update({
        where: { id: usageEventId },
        data: { emailError: message },
      });
      return { error: `Failed to resend email: ${message}` };
    }
  }

  if (intent === "delete") {
    try {
      await deleteAffiliateDiscount(admin, affiliate.shopifyDiscountId);
      await db.affiliate.delete({ where: { id: affiliate.id } });
      return { success: true, deleted: true };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to delete affiliate.",
      };
    }
  }

  return { error: "Unknown action." };
};

export default function AffiliateDetail() {
  const {
    affiliate,
    totalRevenue,
    totalDiscountUsage,
    totalCommission,
    paidCommission,
    pendingCommission,
    events,
    payouts,
  } = useLoaderData<typeof loader>();
  const payoutFetcher = useFetcher<typeof action>();
  const statusFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const editFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const [payoutAmount, setPayoutAmount] = useState("");
  const [editForm, setEditForm] = useState({
    name: affiliate.name,
    email: affiliate.email,
    discountType: affiliate.discountType,
    discountValue: String(affiliate.discountValue),
    discountCode: affiliate.discountCode,
    commissionType: affiliate.commissionType,
    commissionValue: String(affiliate.commissionValue),
  });

  const isRecordingPayout = payoutFetcher.state !== "idle";
  const isTogglingStatus = statusFetcher.state !== "idle";
  const isDeleting = deleteFetcher.state !== "idle";
  const isSavingEdit = editFetcher.state !== "idle";

  const editEmailError =
    editForm.email.trim() !== "" && !isValidEmail(editForm.email)
      ? "Enter a valid email address."
      : undefined;

  const isEditFormValid =
    editForm.name.trim() !== "" &&
    isValidEmail(editForm.email) &&
    Number(editForm.discountValue) > 0 &&
    Number(editForm.commissionValue) > 0 &&
    editForm.discountCode.trim() !== "";

  const isEditDirty =
    editForm.name !== affiliate.name ||
    editForm.email !== affiliate.email ||
    editForm.discountType !== affiliate.discountType ||
    Number(editForm.discountValue) !== affiliate.discountValue ||
    editForm.discountCode.trim().toUpperCase() !== affiliate.discountCode.toUpperCase() ||
    editForm.commissionType !== affiliate.commissionType ||
    Number(editForm.commissionValue) !== affiliate.commissionValue;

  useEffect(() => {
    if (payoutFetcher.data && "success" in payoutFetcher.data) {
      shopify.toast.show(payoutFetcher.data.message ?? "Payment recorded.");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPayoutAmount("");
      hideOverlay(RECORD_PAYOUT_MODAL_ID);
    } else if (payoutFetcher.data && "error" in payoutFetcher.data) {
      shopify.toast.show(payoutFetcher.data.error ?? "Something went wrong.", { isError: true });
    }
  }, [payoutFetcher.data, shopify]);

  useEffect(() => {
    if (statusFetcher.data && "success" in statusFetcher.data) {
      shopify.toast.show(statusFetcher.data.message ?? "Updated.");
    } else if (statusFetcher.data && "error" in statusFetcher.data) {
      shopify.toast.show(statusFetcher.data.error ?? "Something went wrong.", { isError: true });
    }
  }, [statusFetcher.data, shopify]);

  useEffect(() => {
    if (editFetcher.data && "success" in editFetcher.data) {
      shopify.toast.show(editFetcher.data.message ?? "Affiliate updated.");
      hideOverlay(EDIT_MODAL_ID);
    } else if (editFetcher.data && "error" in editFetcher.data) {
      shopify.toast.show(editFetcher.data.error ?? "Something went wrong.", { isError: true });
    }
  }, [editFetcher.data, shopify]);

  useEffect(() => {
    if (deleteFetcher.data && "success" in deleteFetcher.data) {
      shopify.toast.show("Affiliate deleted");
      navigate("/app/affiliates");
    } else if (deleteFetcher.data && "error" in deleteFetcher.data) {
      shopify.toast.show(deleteFetcher.data.error ?? "Something went wrong.", { isError: true });
    }
  }, [deleteFetcher.data, navigate, shopify]);

  const statTiles = [
    {
      label: "Store revenue driven",
      value: `$${totalRevenue.toFixed(2)}`,
      description: "Total order value generated through this affiliate's code",
      icon: "wallet",
      tone: undefined,
    },
    {
      label: "Total discount usage",
      value: totalDiscountUsage,
      description: "Times this code has been used",
      icon: "clipboard-checklist",
      tone: undefined,
    },
    {
      label: "Total commission",
      value: `$${totalCommission.toFixed(2)}`,
      description: "Earned all-time",
      icon: "gift-card",
      tone: undefined,
    },
    {
      label: "Paid commission",
      value: `$${paidCommission.toFixed(2)}`,
      description: "Recorded as paid",
      icon: "check-circle",
      tone: "success" as const,
    },
    {
      label: "Pending payout",
      value: `$${pendingCommission.toFixed(2)}`,
      description: pendingCommission > 0 ? "Ready to be paid" : "Nothing owed",
      icon: "alert-circle",
      tone: pendingCommission > 0 ? ("warning" as const) : undefined,
    },
  ] as const;

  const payoutAmountError =
    Number(payoutAmount) > pendingCommission
      ? `Can't exceed the pending payout of $${pendingCommission.toFixed(2)}.`
      : undefined;
  const isPayoutAmountValid =
    Number(payoutAmount) > 0 && Number(payoutAmount) <= pendingCommission;

  return (
    <s-page heading={affiliate.name}>
      <s-link slot="breadcrumb-actions" href="/app/affiliates">
        Affiliates
      </s-link>

      <s-button slot="secondary-actions" icon="arrow-left" href="/app/affiliates">
        Back
      </s-button>

      <s-button
        slot="secondary-actions"
        icon="edit"
        commandFor={EDIT_MODAL_ID}
        command="--show"
      >
        Edit
      </s-button>

      {affiliate.active ? (
        <s-button
          slot="secondary-actions"
          icon="pause-circle"
          disabled={isTogglingStatus}
          {...(isTogglingStatus ? { loading: true } : {})}
          onClick={() => statusFetcher.submit({ intent: "pause" }, { method: "post" })}
        >
          Pause
        </s-button>
      ) : (
        <s-button
          slot="secondary-actions"
          icon="play-circle"
          disabled={isTogglingStatus}
          {...(isTogglingStatus ? { loading: true } : {})}
          onClick={() => statusFetcher.submit({ intent: "resume" }, { method: "post" })}
        >
          Resume
        </s-button>
      )}

      <s-button
        slot="secondary-actions"
        tone="critical"
        icon="delete"
        commandFor={DELETE_MODAL_ID}
        command="--show"
      >
        Delete
      </s-button>

      <s-button
        slot="primary-action"
        variant="primary"
        commandFor={RECORD_PAYOUT_MODAL_ID}
        command="--show"
        disabled={pendingCommission <= 0 || isRecordingPayout}
      >
        Record payout
      </s-button>

      <s-section>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" alignItems="center" gap="small">
            <s-badge tone={affiliate.active ? "success" : "neutral"}>
              {affiliate.active ? "Active" : "Paused"}
            </s-badge>
            <s-text color="subdued">{affiliate.email}</s-text>
          </s-stack>

          <s-grid gridTemplateColumns="repeat(3, minmax(140px, 1fr))" gap="base">
            <s-stack direction="block" gap="small-400">
              <s-text color="subdued">Discount code</s-text>
              <s-text type="strong">{affiliate.discountCode}</s-text>
            </s-stack>
            <s-stack direction="block" gap="small-400">
              <s-text color="subdued">Discount</s-text>
              <s-text type="strong">
                {formatValue(affiliate.discountType, affiliate.discountValue)}
              </s-text>
            </s-stack>
            <s-stack direction="block" gap="small-400">
              <s-text color="subdued">Commission</s-text>
              <s-text type="strong">
                {formatValue(affiliate.commissionType, affiliate.commissionValue)}
              </s-text>
            </s-stack>
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
          {statTiles.map((stat) => (
            <s-box
              key={stat.label}
              padding="base"
              borderWidth="base"
              borderColor="subdued"
              borderRadius="base"
            >
              <s-stack direction="block" gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon
                    type={stat.icon}
                    tone={stat.tone}
                    color={stat.tone ? undefined : "subdued"}
                  />
                  <s-text color="subdued">{stat.label}</s-text>
                </s-stack>
                <s-heading>{stat.value}</s-heading>
                <s-text color="subdued">{stat.description}</s-text>
              </s-stack>
            </s-box>
          ))}
        </s-grid>
      </s-section>

      <s-section heading="Order history">
        {events.length === 0 ? (
          <s-box padding="large" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-icon type="clipboard-checklist" />
              <s-heading>No orders yet</s-heading>
              <s-paragraph>
                Orders that use {affiliate.discountCode} will show up here.
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-box background="strong" borderWidth="base" borderRadius="base" overflow="hidden">
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header listSlot="primary">Date</s-table-header>
                <s-table-header listSlot="labeled">Order</s-table-header>
                <s-table-header listSlot="labeled" format="currency">
                  Order amount
                </s-table-header>
                <s-table-header listSlot="labeled" format="currency">
                  Revenue to store
                </s-table-header>
                <s-table-header listSlot="labeled" format="currency">
                  Revenue earned
                </s-table-header>
                <s-table-header listSlot="inline">Email status</s-table-header>
                <s-table-header listSlot="inline">Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {events.map((event) => (
                  <OrderHistoryRow key={event.id} event={event} />
                ))}
              </s-table-body>
            </s-table>
          </s-box>
        )}
      </s-section>

      <s-section heading="Payout history">
        {payouts.length === 0 ? (
          <s-box padding="large" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-icon type="wallet" />
              <s-heading>No payments recorded yet</s-heading>
              <s-paragraph>
                When you pay this affiliate outside Shopify, record it here to keep track.
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-box background="strong" borderWidth="base" borderRadius="base" overflow="hidden">
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header listSlot="primary">Date</s-table-header>
                <s-table-header listSlot="labeled" format="currency">
                  Amount
                </s-table-header>
              </s-table-header-row>
              <s-table-body>
                {payouts.map((payout) => (
                  <s-table-row key={payout.id}>
                    <s-table-cell>{formatDateTime(payout.paidAt)}</s-table-cell>
                    <s-table-cell>${payout.amount.toFixed(2)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-box>
        )}
      </s-section>

      <s-modal id={RECORD_PAYOUT_MODAL_ID} heading="Record a payout">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Pending payout is currently ${pendingCommission.toFixed(2)}. Enter what you
            actually paid {affiliate.name} outside Shopify — this only updates your
            records, it doesn&apos;t send any money.
          </s-paragraph>
          <s-number-field
            label="Amount paid ($)"
            value={payoutAmount}
            min={0.01}
            max={pendingCommission}
            step={0.01}
            error={payoutAmountError}
            placeholder={pendingCommission > 0 ? pendingCommission.toFixed(2) : "0.00"}
            onInput={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
              const target = (event.target ?? event.currentTarget) as { value?: string } | null;
              setPayoutAmount(target?.value ?? "");
            }}
          ></s-number-field>
        </s-stack>

        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor={RECORD_PAYOUT_MODAL_ID}
          command="--hide"
          disabled={isRecordingPayout}
        >
          Cancel
        </s-button>

        <s-button
          slot="primary-action"
          variant="primary"
          loading={isRecordingPayout}
          disabled={!isPayoutAmountValid || isRecordingPayout}
          onClick={() =>
            payoutFetcher.submit(
              { intent: "recordPayout", amount: payoutAmount },
              { method: "post" },
            )
          }
        >
          Mark as paid
        </s-button>
      </s-modal>

      <s-modal id={DELETE_MODAL_ID} heading={`Delete "${affiliate.name}"?`}>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            This affiliate, their Shopify discount code, and all recorded order and
            payout history will be permanently deleted.
          </s-paragraph>
          <s-paragraph>This action cannot be undone.</s-paragraph>
        </s-stack>

        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor={DELETE_MODAL_ID}
          command="--hide"
          disabled={isDeleting}
        >
          Cancel
        </s-button>

        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={isDeleting}
          onClick={() => deleteFetcher.submit({ intent: "delete" }, { method: "post" })}
        >
          Delete affiliate
        </s-button>
      </s-modal>

      <s-modal id={EDIT_MODAL_ID} heading="Edit affiliate">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Name"
            value={editForm.name}
            required
            onInput={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
              const target = (event.target ?? event.currentTarget) as { value?: string } | null;
              setEditForm((current) => ({ ...current, name: target?.value ?? "" }));
            }}
          ></s-text-field>
          <s-email-field
            label="Email"
            value={editForm.email}
            required
            error={editEmailError}
            onInput={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
              const target = (event.target ?? event.currentTarget) as { value?: string } | null;
              setEditForm((current) => ({ ...current, email: target?.value ?? "" }));
            }}
          ></s-email-field>

          <s-text-field
            label="Discount code"
            value={editForm.discountCode}
            required
            onInput={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
              const target = (event.target ?? event.currentTarget) as { value?: string } | null;
              setEditForm((current) => ({ ...current, discountCode: target?.value ?? "" }));
            }}
          ></s-text-field>

          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-select
              label="Discount type"
              value={editForm.discountType}
              onChange={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
                const target = (event.target ?? event.currentTarget) as { value?: string } | null;
                setEditForm((current) => ({
                  ...current,
                  discountType: target?.value === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE",
                }));
              }}
            >
              <s-option value="PERCENTAGE">Percentage</s-option>
              <s-option value="FIXED_AMOUNT">Fixed amount</s-option>
            </s-select>
            <s-number-field
              label={editForm.discountType === "PERCENTAGE" ? "Discount %" : "Discount amount ($)"}
              value={editForm.discountValue}
              min={editForm.discountType === "PERCENTAGE" ? 1 : 0.01}
              max={editForm.discountType === "PERCENTAGE" ? 100 : undefined}
              step={editForm.discountType === "PERCENTAGE" ? 1 : 0.01}
              required
              onInput={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
                const target = (event.target ?? event.currentTarget) as { value?: string } | null;
                setEditForm((current) => ({ ...current, discountValue: target?.value ?? "" }));
              }}
            ></s-number-field>
          </s-grid>

          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-select
              label="Commission type"
              value={editForm.commissionType}
              onChange={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
                const target = (event.target ?? event.currentTarget) as { value?: string } | null;
                setEditForm((current) => ({
                  ...current,
                  commissionType: target?.value === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE",
                }));
              }}
            >
              <s-option value="PERCENTAGE">Percentage</s-option>
              <s-option value="FIXED_AMOUNT">Fixed amount</s-option>
            </s-select>
            <s-number-field
              label={editForm.commissionType === "PERCENTAGE" ? "Commission %" : "Commission amount ($)"}
              value={editForm.commissionValue}
              min={editForm.commissionType === "PERCENTAGE" ? 1 : 0.01}
              max={editForm.commissionType === "PERCENTAGE" ? 100 : undefined}
              step={editForm.commissionType === "PERCENTAGE" ? 1 : 0.01}
              required
              onInput={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
                const target = (event.target ?? event.currentTarget) as { value?: string } | null;
                setEditForm((current) => ({ ...current, commissionValue: target?.value ?? "" }));
              }}
            ></s-number-field>
          </s-grid>
        </s-stack>

        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor={EDIT_MODAL_ID}
          command="--hide"
          disabled={isSavingEdit}
        >
          Cancel
        </s-button>

        <s-button
          slot="primary-action"
          variant="primary"
          loading={isSavingEdit}
          disabled={!isEditFormValid || !isEditDirty || isSavingEdit}
          onClick={() =>
            editFetcher.submit(
              {
                intent: "update",
                name: editForm.name,
                email: editForm.email,
                discountType: editForm.discountType,
                discountValue: editForm.discountValue,
                discountCode: editForm.discountCode,
                commissionType: editForm.commissionType,
                commissionValue: editForm.commissionValue,
              },
              { method: "post" },
            )
          }
        >
          Save changes
        </s-button>
      </s-modal>
    </s-page>
  );
}

function OrderHistoryRow({
  event,
}: {
  event: {
    id: string;
    orderName: string;
    orderValue: number;
    currency: string;
    commissionEarned: number;
    emailSent: boolean;
    createdAt: string;
  };
}) {
  const resendFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const isResending = resendFetcher.state !== "idle";
  const menuId = `order-actions-${event.id}`;

  useEffect(() => {
    if (resendFetcher.data && "success" in resendFetcher.data) {
      shopify.toast.show(resendFetcher.data.message ?? "Email resent.");
    } else if (resendFetcher.data && "error" in resendFetcher.data) {
      shopify.toast.show(resendFetcher.data.error ?? "Something went wrong.", { isError: true });
    }
  }, [resendFetcher.data, shopify]);

  return (
    <s-table-row>
      <s-table-cell>{formatDateTime(event.createdAt)}</s-table-cell>
      <s-table-cell>{event.orderName}</s-table-cell>
      <s-table-cell>
        {event.orderValue.toFixed(2)} {event.currency}
      </s-table-cell>
      <s-table-cell>
        ${(event.orderValue - event.commissionEarned).toFixed(2)}
      </s-table-cell>
      <s-table-cell>${event.commissionEarned.toFixed(2)}</s-table-cell>
      <s-table-cell>
        <s-badge tone={event.emailSent ? "success" : "critical"}>
          {event.emailSent ? "Sent" : "Failed"}
        </s-badge>
      </s-table-cell>
      <s-table-cell>
        <s-button
          icon="menu-horizontal"
          variant="tertiary"
          accessibilityLabel={`Actions for order ${event.orderName}`}
          commandFor={menuId}
          {...(isResending ? { loading: true } : {})}
        />

        <s-menu id={menuId} accessibilityLabel={`Actions for order ${event.orderName}`}>
          <s-button
            icon="refresh"
            disabled={isResending}
            onClick={() =>
              resendFetcher.submit(
                { intent: "resendEmail", usageEventId: event.id },
                { method: "post" },
              )
            }
          >
            Resend email
          </s-button>
        </s-menu>
      </s-table-cell>
    </s-table-row>
  );
}
