import { useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { formatDateTime } from "../lib/format";

type StatusFilter = "ALL" | "SENT" | "FAILED";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const events = await db.usageEvent.findMany({
    where: { affiliate: { shop: session.shop } },
    include: { affiliate: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return {
    events: events.map((event) => ({
      id: event.id,
      affiliateId: event.affiliate.id,
      affiliateName: event.affiliate.name,
      discountCode: event.affiliate.discountCode,
      orderName: event.orderName,
      orderValue: Number(event.orderValue),
      currency: event.currency,
      commissionEarned: Number(event.commissionEarned),
      emailSent: event.emailSent,
      emailError: event.emailError,
      createdAt: event.createdAt,
    })),
  };
};

export default function Analytics() {
  const { events } = useLoaderData<typeof loader>();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  const sentCount = useMemo(
    () => events.filter((event) => event.emailSent).length,
    [events],
  );
  const failedCount = events.length - sentCount;
  const totalCommission = useMemo(
    () => events.reduce((sum, event) => sum + event.commissionEarned, 0),
    [events],
  );

  const visibleEvents = useMemo(() => {
    if (statusFilter === "SENT") return events.filter((event) => event.emailSent);
    if (statusFilter === "FAILED") return events.filter((event) => !event.emailSent);
    return events;
  }, [events, statusFilter]);

  return (
    <s-page heading="Analytics">
      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(4, minmax(160px, 1fr))" gap="base">
          <s-box padding="base" borderWidth="base" borderColor="subdued" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-text color="subdued">Total events</s-text>
              <s-heading>{events.length}</s-heading>
              <s-text color="subdued">Last 100 discount code uses</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderColor="subdued" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-text color="subdued">Commission owed</s-text>
              <s-heading>${totalCommission.toFixed(2)}</s-heading>
              <s-text color="subdued">Across all affiliates</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderColor="subdued" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-badge tone="success">Sent</s-badge>
              <s-heading>{sentCount}</s-heading>
              <s-text color="subdued">Notification emails delivered</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderColor="subdued" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-badge tone={failedCount > 0 ? "critical" : "neutral"}>Failed</s-badge>
              <s-heading>{failedCount}</s-heading>
              <s-text color="subdued">Notification emails that failed</s-text>
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>

      <s-section heading="All activity">
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
            <s-select
              label="Status"
              labelAccessibilityVisibility="exclusive"
              value={statusFilter}
              onChange={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
                const target = (event.target ?? event.currentTarget) as { value?: string } | null;
                setStatusFilter((target?.value as StatusFilter) ?? "ALL");
              }}
            >
              <s-option value="ALL">All statuses</s-option>
              <s-option value="SENT">Sent</s-option>
              <s-option value="FAILED">Failed</s-option>
            </s-select>
            <s-badge tone="info">
              {visibleEvents.length} {visibleEvents.length === 1 ? "event" : "events"}
            </s-badge>
          </s-grid>

          {visibleEvents.length === 0 ? (
            <s-box padding="large" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="base" alignItems="center">
                <s-icon type="clipboard-checklist" />
                <s-heading>
                  {events.length === 0 ? "No discount code usage yet" : "No matching events"}
                </s-heading>
                <s-paragraph>
                  {events.length === 0
                    ? "This list fills in automatically whenever an order uses an affiliate's code."
                    : "Try a different status filter."}
                </s-paragraph>
              </s-stack>
            </s-box>
          ) : (
            <s-box background="strong" borderWidth="base" borderRadius="base" overflow="hidden">
              <s-table variant="auto">
                <s-table-header-row>
                  <s-table-header listSlot="primary">Date</s-table-header>
                  <s-table-header listSlot="labeled">Affiliate</s-table-header>
                  <s-table-header listSlot="labeled">Code</s-table-header>
                  <s-table-header listSlot="labeled">Order</s-table-header>
                  <s-table-header listSlot="labeled" format="currency">
                    Order value
                  </s-table-header>
                  <s-table-header listSlot="labeled" format="currency">
                    Commission
                  </s-table-header>
                  <s-table-header listSlot="inline">Email</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {visibleEvents.map((event) => (
                    <s-table-row key={event.id}>
                      <s-table-cell>
                        {formatDateTime(event.createdAt)}
                      </s-table-cell>
                      <s-table-cell>
                        <s-link href={`/app/affiliates/${event.affiliateId}`}>
                          {event.affiliateName}
                        </s-link>
                      </s-table-cell>
                      <s-table-cell>{event.discountCode}</s-table-cell>
                      <s-table-cell>{event.orderName}</s-table-cell>
                      <s-table-cell>
                        {event.orderValue.toFixed(2)} {event.currency}
                      </s-table-cell>
                      <s-table-cell>${event.commissionEarned.toFixed(2)}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={event.emailSent ? "success" : "critical"}>
                          {event.emailSent ? "Sent" : "Failed"}
                        </s-badge>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </s-box>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
