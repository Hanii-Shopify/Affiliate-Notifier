import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  activateAffiliateDiscount,
  createAffiliateDiscount,
  deactivateAffiliateDiscount,
  deleteAffiliateDiscount,
  updateAffiliateDiscount,
} from "../services/shopify-discounts.server";
import type { ValueType } from "../lib/value-type";
import { isValidEmail } from "../lib/validation";

const ADD_AFFILIATE_MODAL_ID = "add-affiliate-modal";
const DELETE_AFFILIATE_MODAL_ID = "delete-affiliate-modal";
const EDIT_AFFILIATE_MODAL_ID = "edit-affiliate-modal";

type OverlayElement = HTMLElement & { hideOverlay?: () => void };
function hideOverlay(id: string) {
  (document.getElementById(id) as OverlayElement | null)?.hideOverlay?.();
}

function isValueType(value: FormDataEntryValue | null): value is ValueType {
  return value === "PERCENTAGE" || value === "FIXED_AMOUNT";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const affiliates = await db.affiliate.findMany({
    where: { shop: session.shop },
    include: { usageEvents: true },
    orderBy: { createdAt: "desc" },
  });

  return {
    affiliates: affiliates.map((affiliate) => ({
      id: affiliate.id,
      name: affiliate.name,
      email: affiliate.email,
      discountCode: affiliate.discountCode,
      discountType: affiliate.discountType as ValueType,
      discountValue: affiliate.discountValue,
      commissionType: affiliate.commissionType as ValueType,
      commissionValue: affiliate.commissionValue,
      active: affiliate.active,
      orderCount: affiliate.usageEvents.length,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
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
      const { shopifyDiscountId, discountCode } = await createAffiliateDiscount(
        admin,
        { name, discountType, discountValue, customCode: customCode || undefined },
      );

      await db.affiliate.create({
        data: {
          shop: session.shop,
          name,
          email,
          discountCode,
          discountType,
          discountValue,
          commissionType,
          commissionValue,
          shopifyDiscountId,
        },
      });

      return { success: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { error: "That discount code is already in use." };
      }
      return {
        error: error instanceof Error ? error.message : "Failed to create affiliate.",
      };
    }
  }

  if (intent === "update") {
    const affiliateId = String(formData.get("affiliateId") ?? "");
    const affiliate = await db.affiliate.findUnique({
      where: { id: affiliateId },
    });

    if (!affiliate || affiliate.shop !== session.shop) {
      return { error: "Affiliate not found." };
    }

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
        where: { id: affiliateId },
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

  if (intent === "pause" || intent === "resume") {
    const affiliateId = String(formData.get("affiliateId") ?? "");
    const affiliate = await db.affiliate.findUnique({
      where: { id: affiliateId },
    });

    if (!affiliate || affiliate.shop !== session.shop) {
      return { error: "Affiliate not found." };
    }

    try {
      if (intent === "pause") {
        await deactivateAffiliateDiscount(admin, affiliate.shopifyDiscountId);
      } else {
        await activateAffiliateDiscount(admin, affiliate.shopifyDiscountId);
      }
      await db.affiliate.update({
        where: { id: affiliateId },
        data: { active: intent === "resume" },
      });
      return { success: true };
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : `Failed to ${intent} affiliate.`,
      };
    }
  }

  if (intent === "delete") {
    const affiliateId = String(formData.get("affiliateId") ?? "");
    const affiliate = await db.affiliate.findUnique({
      where: { id: affiliateId },
    });

    if (!affiliate || affiliate.shop !== session.shop) {
      return { error: "Affiliate not found." };
    }

    try {
      await deleteAffiliateDiscount(admin, affiliate.shopifyDiscountId);
      await db.affiliate.delete({ where: { id: affiliateId } });
      return { success: true };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to delete affiliate.",
      };
    }
  }

  return { error: "Unknown action." };
};

type SelectChangeEvent = { target: EventTarget | null; currentTarget: EventTarget | null };
type InputEvent = { target: EventTarget | null; currentTarget: EventTarget | null };

function readFieldValue(event: SelectChangeEvent | InputEvent): string {
  return ((event.target ?? event.currentTarget) as { value?: string } | null)?.value ?? "";
}

type StatusFilter = "ALL" | "ACTIVE" | "PAUSED";

const EMPTY_FORM = {
  name: "",
  email: "",
  discountType: "PERCENTAGE" as ValueType,
  discountValue: "",
  discountCode: "",
  commissionType: "PERCENTAGE" as ValueType,
  commissionValue: "",
};

type AffiliateListItem = {
  id: string;
  name: string;
  email: string;
  discountCode: string;
  discountType: ValueType;
  discountValue: number;
  commissionType: ValueType;
  commissionValue: number;
  active: boolean;
  orderCount: number;
};

export default function Affiliates() {
  const { affiliates } = useLoaderData<typeof loader>();
  const createFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const editFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [editTarget, setEditTarget] = useState<AffiliateListItem | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const isDeleting = deleteFetcher.state !== "idle";
  const isSavingEdit = editFetcher.state !== "idle";

  const editEmailError =
    editForm.email.trim() !== "" && !isValidEmail(editForm.email)
      ? "Enter a valid email address."
      : undefined;
  const editCodeError =
    editForm.discountCode.trim() !== "" &&
    affiliates.some(
      (affiliate) =>
        affiliate.id !== editTarget?.id &&
        affiliate.discountCode.toUpperCase() === editForm.discountCode.trim().toUpperCase(),
    )
      ? "That discount code is already in use."
      : undefined;

  const isEditFormValid =
    editForm.name.trim() !== "" &&
    isValidEmail(editForm.email) &&
    Number(editForm.discountValue) > 0 &&
    Number(editForm.commissionValue) > 0 &&
    editForm.discountCode.trim() !== "" &&
    !editCodeError;

  const isEditDirty =
    editTarget !== null &&
    (editForm.name !== editTarget.name ||
      editForm.email !== editTarget.email ||
      editForm.discountType !== editTarget.discountType ||
      Number(editForm.discountValue) !== editTarget.discountValue ||
      editForm.discountCode.trim().toUpperCase() !== editTarget.discountCode.toUpperCase() ||
      editForm.commissionType !== editTarget.commissionType ||
      Number(editForm.commissionValue) !== editTarget.commissionValue);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  const activeCount = useMemo(
    () => affiliates.filter((affiliate) => affiliate.active).length,
    [affiliates],
  );
  const pausedCount = affiliates.length - activeCount;

  const visibleAffiliates = useMemo(() => {
    let list = affiliates;

    if (statusFilter === "ACTIVE") {
      list = list.filter((affiliate) => affiliate.active);
    } else if (statusFilter === "PAUSED") {
      list = list.filter((affiliate) => !affiliate.active);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      list = list.filter(
        (affiliate) =>
          affiliate.name.toLowerCase().includes(query) ||
          affiliate.email.toLowerCase().includes(query) ||
          affiliate.discountCode.toLowerCase().includes(query),
      );
    }

    return list;
  }, [affiliates, statusFilter, searchQuery]);

  const isCreating =
    createFetcher.state !== "idle" &&
    createFetcher.formData?.get("intent") === "create";

  const emailError =
    form.email.trim() !== "" && !isValidEmail(form.email)
      ? "Enter a valid email address."
      : undefined;
  const codeError =
    form.discountCode.trim() !== "" &&
    affiliates.some(
      (affiliate) =>
        affiliate.discountCode.toUpperCase() === form.discountCode.trim().toUpperCase(),
    )
      ? "That discount code is already in use."
      : undefined;

  // The form is meaningfully filled out (not just pristine defaults) —
  // gates the submit button the same way an edit form's Save button is
  // gated on being dirty, since a create form has no saved baseline to
  // diff against.
  const isFormFilled =
    form.name.trim() !== "" &&
    isValidEmail(form.email) &&
    Number(form.discountValue) > 0 &&
    Number(form.commissionValue) > 0 &&
    !codeError;

  useEffect(() => {
    if (createFetcher.data && "success" in createFetcher.data) {
      shopify.toast.show("Affiliate added");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(EMPTY_FORM);
      hideOverlay(ADD_AFFILIATE_MODAL_ID);
    } else if (createFetcher.data && "error" in createFetcher.data) {
      shopify.toast.show(createFetcher.data.error ?? "Something went wrong.", { isError: true });
    }
  }, [createFetcher.data, shopify]);

  useEffect(() => {
    if (deleteFetcher.data && "success" in deleteFetcher.data) {
      shopify.toast.show("Affiliate deleted");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeleteTarget(null);
      hideOverlay(DELETE_AFFILIATE_MODAL_ID);
    } else if (deleteFetcher.data && "error" in deleteFetcher.data) {
      shopify.toast.show(deleteFetcher.data.error ?? "Something went wrong.", { isError: true });
    }
  }, [deleteFetcher.data, shopify]);

  useEffect(() => {
    if (editFetcher.data && "success" in editFetcher.data) {
      shopify.toast.show(editFetcher.data.message ?? "Affiliate updated.");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditTarget(null);
      hideOverlay(EDIT_AFFILIATE_MODAL_ID);
    } else if (editFetcher.data && "error" in editFetcher.data) {
      shopify.toast.show(editFetcher.data.error ?? "Something went wrong.", { isError: true });
    }
  }, [editFetcher.data, shopify]);

  const openEdit = (affiliate: AffiliateListItem) => {
    setEditTarget(affiliate);
    setEditForm({
      name: affiliate.name,
      email: affiliate.email,
      discountType: affiliate.discountType,
      discountValue: String(affiliate.discountValue),
      discountCode: affiliate.discountCode,
      commissionType: affiliate.commissionType,
      commissionValue: String(affiliate.commissionValue),
    });
  };

  const submitEdit = () => {
    if (!editTarget) return;
    editFetcher.submit(
      {
        intent: "update",
        affiliateId: editTarget.id,
        name: editForm.name,
        email: editForm.email,
        discountType: editForm.discountType,
        discountValue: editForm.discountValue,
        discountCode: editForm.discountCode,
        commissionType: editForm.commissionType,
        commissionValue: editForm.commissionValue,
      },
      { method: "post" },
    );
  };

  const submitCreate = () => {
    createFetcher.submit(
      {
        intent: "create",
        name: form.name,
        email: form.email,
        discountType: form.discountType,
        discountValue: form.discountValue,
        discountCode: form.discountCode,
        commissionType: form.commissionType,
        commissionValue: form.commissionValue,
      },
      { method: "post" },
    );
  };

  return (
    <s-page heading="Affiliates">
      <s-button
        slot="primary-action"
        variant="primary"
        icon="plus"
        commandFor={ADD_AFFILIATE_MODAL_ID}
        command="--show"
      >
        Add affiliate
      </s-button>

      {affiliates.length > 0 && (
        <s-section heading="Overview">
          <s-grid gridTemplateColumns="repeat(3, minmax(160px, 1fr))" gap="base">
            <s-box padding="base" borderWidth="base" borderColor="subdued" borderRadius="base">
              <s-stack direction="block" gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="person" color="subdued" />
                  <s-text color="subdued">Total affiliates</s-text>
                </s-stack>
                <s-heading>{affiliates.length}</s-heading>
                <s-text color="subdued">Ever added to this store</s-text>
              </s-stack>
            </s-box>
            <s-box padding="base" borderWidth="base" borderColor="subdued" borderRadius="base">
              <s-stack direction="block" gap="small-200">
                <s-badge tone="success">Active</s-badge>
                <s-heading>{activeCount}</s-heading>
                <s-text color="subdued">Currently earning commission</s-text>
              </s-stack>
            </s-box>
            <s-box padding="base" borderWidth="base" borderColor="subdued" borderRadius="base">
              <s-stack direction="block" gap="small-200">
                <s-badge tone={pausedCount > 0 ? "warning" : "neutral"}>Paused</s-badge>
                <s-heading>{pausedCount}</s-heading>
                <s-text color="subdued">Not currently active</s-text>
              </s-stack>
            </s-box>
          </s-grid>
        </s-section>
      )}

      <s-section heading="All affiliates">
        <s-stack direction="block" gap="base">
          {affiliates.length === 0 ? (
            <s-box padding="large" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="base" alignItems="center">
                <s-icon type="info" />
                <s-heading>No affiliates yet</s-heading>
                <s-paragraph>
                  Add one to generate their Shopify discount code automatically.
                </s-paragraph>
                <s-button
                  variant="primary"
                  icon="plus"
                  commandFor={ADD_AFFILIATE_MODAL_ID}
                  command="--show"
                >
                  Add affiliate
                </s-button>
              </s-stack>
            </s-box>
          ) : (
            <>
              <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                <s-paragraph>Search, filter, and manage any affiliate.</s-paragraph>
                <s-badge tone="info">
                  {visibleAffiliates.length}{" "}
                  {visibleAffiliates.length === 1 ? "affiliate" : "affiliates"}
                </s-badge>
              </s-grid>

              <s-grid
                gridTemplateColumns="minmax(280px, 2fr) minmax(160px, 1fr)"
                gap="small"
                alignItems="end"
              >
                <s-search-field
                  label="Search affiliates"
                  labelAccessibilityVisibility="exclusive"
                  placeholder="Search by name, email, or code"
                  value={searchQuery}
                  onInput={(event: InputEvent) => setSearchQuery(readFieldValue(event))}
                ></s-search-field>
                <s-select
                  label="Status"
                  labelAccessibilityVisibility="exclusive"
                  value={statusFilter}
                  onChange={(event: SelectChangeEvent) =>
                    setStatusFilter((readFieldValue(event) as StatusFilter) || "ALL")
                  }
                >
                  <s-option value="ALL">All statuses</s-option>
                  <s-option value="ACTIVE">Active</s-option>
                  <s-option value="PAUSED">Paused</s-option>
                </s-select>
              </s-grid>

              {visibleAffiliates.length === 0 ? (
                <s-box padding="large" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="base" alignItems="center">
                    <s-icon type="info" />
                    <s-heading>No matching affiliates</s-heading>
                    <s-paragraph>Try a different search term or status filter.</s-paragraph>
                  </s-stack>
                </s-box>
              ) : (
                <s-box background="strong" borderWidth="base" borderRadius="base" overflow="hidden">
                  <s-table variant="auto">
                    <s-table-header-row>
                      <s-table-header listSlot="primary">Name</s-table-header>
                      <s-table-header listSlot="labeled">Email</s-table-header>
                      <s-table-header listSlot="labeled">Code</s-table-header>
                      <s-table-header listSlot="labeled" format="numeric">
                        Orders
                      </s-table-header>
                      <s-table-header listSlot="inline">Status</s-table-header>
                      <s-table-header listSlot="inline">Actions</s-table-header>
                    </s-table-header-row>
                    <s-table-body>
                      {visibleAffiliates.map((affiliate) => (
                        <AffiliateRow
                          key={affiliate.id}
                          affiliate={affiliate}
                          onRequestDelete={() => setDeleteTarget(affiliate)}
                          onRequestEdit={() => openEdit(affiliate)}
                        />
                      ))}
                    </s-table-body>
                  </s-table>
                </s-box>
              )}
            </>
          )}
        </s-stack>
      </s-section>

      <s-modal id={ADD_AFFILIATE_MODAL_ID} heading="Add an affiliate">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Name"
            name="name"
            value={form.name}
            required
            onInput={(event: InputEvent) =>
              setForm((current) => ({ ...current, name: readFieldValue(event) }))
            }
          ></s-text-field>
          <s-email-field
            label="Email"
            name="email"
            value={form.email}
            required
            error={emailError}
            onInput={(event: InputEvent) =>
              setForm((current) => ({ ...current, email: readFieldValue(event) }))
            }
          ></s-email-field>

            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
              <s-select
                label="Discount type"
                name="discountType"
                value={form.discountType}
                onChange={(event: SelectChangeEvent) =>
                  setForm((current) => ({
                    ...current,
                    discountType: readFieldValue(event) === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE",
                  }))
                }
              >
                <s-option value="PERCENTAGE">Percentage</s-option>
                <s-option value="FIXED_AMOUNT">Fixed amount</s-option>
              </s-select>
              <s-number-field
                label={form.discountType === "PERCENTAGE" ? "Discount %" : "Discount amount ($)"}
                name="discountValue"
                value={form.discountValue}
                min={form.discountType === "PERCENTAGE" ? 1 : 0.01}
                max={form.discountType === "PERCENTAGE" ? 100 : undefined}
                step={form.discountType === "PERCENTAGE" ? 1 : 0.01}
                required
                onInput={(event: InputEvent) =>
                  setForm((current) => ({ ...current, discountValue: readFieldValue(event) }))
                }
              ></s-number-field>
              <s-text-field
                label="Discount code"
                name="discountCode"
                value={form.discountCode}
                placeholder="Auto-generated if blank"
                error={codeError}
                onInput={(event: InputEvent) =>
                  setForm((current) => ({ ...current, discountCode: readFieldValue(event) }))
                }
              ></s-text-field>
            </s-grid>

            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-select
                label="Commission type"
                name="commissionType"
                value={form.commissionType}
                onChange={(event: SelectChangeEvent) =>
                  setForm((current) => ({
                    ...current,
                    commissionType: readFieldValue(event) === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE",
                  }))
                }
              >
                <s-option value="PERCENTAGE">Percentage</s-option>
                <s-option value="FIXED_AMOUNT">Fixed amount</s-option>
              </s-select>
              <s-number-field
                label={form.commissionType === "PERCENTAGE" ? "Commission %" : "Commission amount ($)"}
                name="commissionValue"
                value={form.commissionValue}
                min={form.commissionType === "PERCENTAGE" ? 1 : 0.01}
                max={form.commissionType === "PERCENTAGE" ? 100 : undefined}
                step={form.commissionType === "PERCENTAGE" ? 1 : 0.01}
                required
                onInput={(event: InputEvent) =>
                  setForm((current) => ({ ...current, commissionValue: readFieldValue(event) }))
                }
              ></s-number-field>
            </s-grid>
        </s-stack>

        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor={ADD_AFFILIATE_MODAL_ID}
          command="--hide"
          disabled={isCreating}
        >
          Cancel
        </s-button>

        <s-button
          slot="primary-action"
          variant="primary"
          onClick={submitCreate}
          disabled={!isFormFilled || isCreating}
          {...(isCreating ? { loading: true } : {})}
        >
          Add affiliate
        </s-button>
      </s-modal>

      <s-modal
        id={DELETE_AFFILIATE_MODAL_ID}
        heading={deleteTarget ? `Delete "${deleteTarget.name}"?` : "Delete affiliate?"}
      >
        <s-stack direction="block" gap="base">
          <s-paragraph>
            This affiliate, their Shopify discount code, and all recorded order history
            will be permanently deleted.
          </s-paragraph>
          <s-paragraph>This action cannot be undone.</s-paragraph>
        </s-stack>

        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor={DELETE_AFFILIATE_MODAL_ID}
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
          disabled={!deleteTarget}
          onClick={() => {
            if (!deleteTarget) return;
            deleteFetcher.submit(
              { intent: "delete", affiliateId: deleteTarget.id },
              { method: "post" },
            );
          }}
        >
          Delete affiliate
        </s-button>
      </s-modal>

      <s-modal id={EDIT_AFFILIATE_MODAL_ID} heading="Edit affiliate">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Name"
            value={editForm.name}
            required
            onInput={(event: InputEvent) =>
              setEditForm((current) => ({ ...current, name: readFieldValue(event) }))
            }
          ></s-text-field>
          <s-email-field
            label="Email"
            value={editForm.email}
            required
            error={editEmailError}
            onInput={(event: InputEvent) =>
              setEditForm((current) => ({ ...current, email: readFieldValue(event) }))
            }
          ></s-email-field>

          <s-text-field
            label="Discount code"
            value={editForm.discountCode}
            required
            error={editCodeError}
            onInput={(event: InputEvent) =>
              setEditForm((current) => ({ ...current, discountCode: readFieldValue(event) }))
            }
          ></s-text-field>

          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-select
              label="Discount type"
              value={editForm.discountType}
              onChange={(event: SelectChangeEvent) =>
                setEditForm((current) => ({
                  ...current,
                  discountType: readFieldValue(event) === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE",
                }))
              }
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
              onInput={(event: InputEvent) =>
                setEditForm((current) => ({ ...current, discountValue: readFieldValue(event) }))
              }
            ></s-number-field>
          </s-grid>

          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-select
              label="Commission type"
              value={editForm.commissionType}
              onChange={(event: SelectChangeEvent) =>
                setEditForm((current) => ({
                  ...current,
                  commissionType: readFieldValue(event) === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE",
                }))
              }
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
              onInput={(event: InputEvent) =>
                setEditForm((current) => ({ ...current, commissionValue: readFieldValue(event) }))
              }
            ></s-number-field>
          </s-grid>
        </s-stack>

        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor={EDIT_AFFILIATE_MODAL_ID}
          command="--hide"
          disabled={isSavingEdit}
        >
          Cancel
        </s-button>

        <s-button
          slot="primary-action"
          variant="primary"
          onClick={submitEdit}
          disabled={!isEditFormValid || !isEditDirty || isSavingEdit}
          {...(isSavingEdit ? { loading: true } : {})}
        >
          Save changes
        </s-button>
      </s-modal>
    </s-page>
  );
}

function AffiliateRow({
  affiliate,
  onRequestDelete,
  onRequestEdit,
}: {
  affiliate: AffiliateListItem;
  onRequestDelete: () => void;
  onRequestEdit: () => void;
}) {
  const statusFetcher = useFetcher<typeof action>();
  const isTogglingStatus = statusFetcher.state !== "idle";
  const menuId = `affiliate-actions-${affiliate.id}`;
  const navigate = useNavigate();

  return (
    <s-table-row>
      <s-table-cell>
        <s-link href={`/app/affiliates/${affiliate.id}`}>{affiliate.name}</s-link>
      </s-table-cell>
      <s-table-cell>{affiliate.email}</s-table-cell>
      <s-table-cell>{affiliate.discountCode}</s-table-cell>
      <s-table-cell>{affiliate.orderCount}</s-table-cell>
      <s-table-cell>
        <s-badge tone={affiliate.active ? "success" : "neutral"}>
          {affiliate.active ? "Active" : "Paused"}
        </s-badge>
      </s-table-cell>
      <s-table-cell>
        <s-button
          icon="menu-horizontal"
          variant="tertiary"
          accessibilityLabel={`Actions for ${affiliate.name}`}
          commandFor={menuId}
          {...(isTogglingStatus ? { loading: true } : {})}
        />

        <s-menu id={menuId} accessibilityLabel={`Actions for ${affiliate.name}`}>
          <s-button icon="view" onClick={() => navigate(`/app/affiliates/${affiliate.id}`)}>
            View dashboard
          </s-button>

          <s-button
            icon="edit"
            commandFor={EDIT_AFFILIATE_MODAL_ID}
            command="--show"
            onClick={onRequestEdit}
          >
            Edit
          </s-button>

          {affiliate.active ? (
            <s-button
              icon="pause-circle"
              disabled={isTogglingStatus}
              onClick={() =>
                statusFetcher.submit(
                  { intent: "pause", affiliateId: affiliate.id },
                  { method: "post" },
                )
              }
            >
              Pause
            </s-button>
          ) : (
            <s-button
              icon="play-circle"
              disabled={isTogglingStatus}
              onClick={() =>
                statusFetcher.submit(
                  { intent: "resume", affiliateId: affiliate.id },
                  { method: "post" },
                )
              }
            >
              Resume
            </s-button>
          )}

          <s-button
            icon="delete"
            tone="critical"
            commandFor={DELETE_AFFILIATE_MODAL_ID}
            command="--show"
            onClick={onRequestDelete}
          >
            Delete
          </s-button>
        </s-menu>
      </s-table-cell>
    </s-table-row>
  );
}
