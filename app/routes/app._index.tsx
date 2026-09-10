import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { formatDate } from "../lib/format";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const affiliates = await db.affiliate.findMany({
    where: { shop: session.shop },
    include: { usageEvents: true },
  });

  const activeAffiliates = affiliates.filter((affiliate) => affiliate.active);

  const eventsWithAffiliate = affiliates.flatMap((affiliate) =>
    affiliate.usageEvents.map((event) => ({
      ...event,
      affiliateName: affiliate.name,
    })),
  );

  const totalValue = eventsWithAffiliate.reduce(
    (sum, event) => sum + Number(event.orderValue),
    0,
  );
  const failedEmails = eventsWithAffiliate.filter((event) => !event.emailSent).length;

  const topAffiliates = affiliates
    .map((affiliate) => ({
      id: affiliate.id,
      name: affiliate.name,
      discountCode: affiliate.discountCode,
      totalValue: affiliate.usageEvents.reduce(
        (sum, event) => sum + Number(event.orderValue),
        0,
      ),
      orderCount: affiliate.usageEvents.length,
    }))
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, 3);

  const recentEvents = [...eventsWithAffiliate]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5)
    .map((event) => ({
      id: event.id,
      affiliateId: event.affiliateId,
      affiliateName: event.affiliateName,
      orderName: event.orderName,
      orderValue: Number(event.orderValue),
      currency: event.currency,
      emailSent: event.emailSent,
      createdAt: event.createdAt.toISOString(),
    }));

  return {
    hasAffiliates: affiliates.length > 0,
    activeAffiliateCount: activeAffiliates.length,
    totalOrders: eventsWithAffiliate.length,
    totalValue,
    failedEmails,
    topAffiliates,
    recentEvents,
  };
};

export default function Index() {
  const {
    hasAffiliates,
    activeAffiliateCount,
    totalOrders,
    totalValue,
    failedEmails,
    topAffiliates,
    recentEvents,
  } = useLoaderData<typeof loader>();

  const hasOrders = totalOrders > 0;
  const isLive = activeAffiliateCount > 0;

  const statTiles = [
    {
      label: "Active affiliates",
      value: activeAffiliateCount,
      description: "Currently earning commission",
      icon: "person",
      tone: isLive ? ("success" as const) : undefined,
      href: "/app/affiliates",
    },
    {
      label: "Orders with a code used",
      value: totalOrders,
      description: "All-time attributed orders",
      icon: "clipboard-checklist",
      tone: undefined,
      href: "/app/analytics",
    },
    {
      label: "Total value driven",
      value: `$${totalValue.toFixed(2)}`,
      description: "Revenue from affiliate codes",
      icon: "wallet",
      tone: undefined,
      href: "/app/analytics",
    },
    {
      label: "Failed notifications",
      value: failedEmails,
      description: failedEmails > 0 ? "Needs attention" : "All emails delivered",
      icon: "alert-circle",
      tone: failedEmails > 0 ? ("critical" as const) : undefined,
      href: "/app/analytics",
    },
  ] as const;

  return (
    <s-page heading="Affiliate Notifier">
      <s-button slot="primary-action" icon="plus" href="/app/affiliates">
        Add affiliate
      </s-button>

      <s-section accessibilityLabel="Dashboard introduction">
        <s-grid gridTemplateColumns="minmax(0, 1.5fr) minmax(260px, 0.8fr)" gap="base">
          <s-box borderWidth="base" borderRadius="base" padding="large">
            <s-stack direction="block" gap="base">
              <s-badge tone={isLive ? "success" : "neutral"}>
                {isLive ? "Live" : "Getting started"}
              </s-badge>

              <s-heading>
                {isLive
                  ? `Tracking ${activeAffiliateCount} active affiliate${activeAffiliateCount === 1 ? "" : "s"}`
                  : "Set up your first affiliate"}
              </s-heading>

              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="small-200" alignItems="start">
                  <s-icon type="check-circle-filled" tone="success" />
                  <s-stack direction="block" gap="small-400">
                    <s-text>App installed</s-text>
                    <s-text color="subdued">
                      Affiliate Notifier is connected to your store and watching orders.
                    </s-text>
                  </s-stack>
                </s-stack>

                <s-stack direction="inline" gap="small-200" alignItems="start">
                  <s-icon
                    type={hasAffiliates ? "check-circle-filled" : "circle"}
                    tone={hasAffiliates ? "success" : undefined}
                    color={hasAffiliates ? undefined : "subdued"}
                  />
                  <s-stack direction="block" gap="small-400">
                    <s-text color={hasAffiliates ? "base" : "subdued"}>
                      First affiliate added
                    </s-text>
                    <s-text color="subdued">
                      Adding an affiliate automatically creates their discount code on
                      Shopify.
                    </s-text>
                    {!hasAffiliates ? (
                      <s-link href="/app/affiliates">Add affiliate</s-link>
                    ) : null}
                  </s-stack>
                </s-stack>

                <s-stack direction="inline" gap="small-200" alignItems="start">
                  <s-icon
                    type={hasOrders ? "check-circle-filled" : "circle"}
                    tone={hasOrders ? "success" : undefined}
                    color={hasOrders ? undefined : "subdued"}
                  />
                  <s-stack direction="block" gap="small-400">
                    <s-text color={hasOrders ? "base" : "subdued"}>
                      First order tracked
                    </s-text>
                    <s-text color="subdued">
                      Once a customer uses an affiliate&apos;s code, it&apos;s logged here
                      and the affiliate is emailed automatically.
                    </s-text>
                    {hasAffiliates && !hasOrders ? (
                      <s-link href="/app/affiliates">View affiliate codes</s-link>
                    ) : null}
                  </s-stack>
                </s-stack>
              </s-stack>

              <s-button-group>
                <s-button variant="primary" icon="plus" href="/app/affiliates">
                  Add affiliate
                </s-button>
                <s-button variant="secondary" href="/app/analytics">
                  View analytics
                </s-button>
              </s-button-group>
            </s-stack>
          </s-box>

          <s-box borderWidth="base" borderRadius="base" padding="large">
            <s-stack direction="block" gap="base">
              <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                <s-text type="strong">Top affiliates</s-text>
                {hasAffiliates ? (
                  <s-link href="/app/affiliates">View all</s-link>
                ) : null}
              </s-grid>

              {topAffiliates.length === 0 ? (
                <s-stack direction="block" gap="small-200">
                  <s-text color="subdued">
                    Your top affiliates by revenue will show up here.
                  </s-text>
                  <s-link href="/app/affiliates">Add your first affiliate</s-link>
                </s-stack>
              ) : (
                <s-stack direction="block" gap="base">
                  {topAffiliates.map((affiliate, index) => (
                    <s-stack
                      key={affiliate.id}
                      direction="inline"
                      alignItems="center"
                      justifyContent="space-between"
                      gap="small"
                    >
                      <s-stack direction="inline" alignItems="center" gap="small">
                        <s-badge>{index + 1}</s-badge>
                        <s-stack direction="block" gap="small-400">
                          <s-link href={`/app/affiliates/${affiliate.id}`}>{affiliate.name}</s-link>
                          <s-text color="subdued">
                            {affiliate.orderCount} {affiliate.orderCount === 1 ? "order" : "orders"}
                          </s-text>
                        </s-stack>
                      </s-stack>
                      <s-text type="strong">${affiliate.totalValue.toFixed(2)}</s-text>
                    </s-stack>
                  ))}
                </s-stack>
              )}
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>

      {failedEmails > 0 && (
        <s-banner heading="Some notification emails failed" tone="warning">
          <s-paragraph>
            {failedEmails} notification email(s) failed to send. Check the{" "}
            <s-link href="/app/analytics">analytics</s-link> for details.
          </s-paragraph>
        </s-banner>
      )}

      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
          {statTiles.map((stat) => (
            <s-box
              key={stat.label}
              borderWidth="base"
              borderColor="subdued"
              borderRadius="base"
              overflow="hidden"
            >
              <s-clickable accessibilityLabel={`Show ${stat.label.toLowerCase()}`} href={stat.href}>
                <s-box padding="base">
                  <s-stack direction="block" gap="small-200">
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-icon
                        type={stat.icon}
                        tone={stat.tone}
                        color={stat.tone ? undefined : "subdued"}
                      />
                      {stat.tone ? (
                        <s-badge tone={stat.tone}>{stat.label}</s-badge>
                      ) : (
                        <s-text color="subdued">{stat.label}</s-text>
                      )}
                    </s-stack>
                    <s-heading>{stat.value}</s-heading>
                    <s-text color="subdued">{stat.description}</s-text>
                  </s-stack>
                </s-box>
              </s-clickable>
            </s-box>
          ))}
        </s-grid>
      </s-section>

      <s-section heading="Recent activity">
        <s-stack direction="block" gap="base">
          {recentEvents.length === 0 ? (
            <s-box padding="large" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="base" alignItems="center">
                <s-icon type="clipboard-checklist" />
                <s-heading>No activity yet</s-heading>
                <s-paragraph>
                  Orders that use an affiliate&apos;s code will show up here as they come in.
                </s-paragraph>
              </s-stack>
            </s-box>
          ) : (
            <s-box background="strong" borderWidth="base" borderRadius="base" overflow="hidden">
              <s-table variant="auto">
                <s-table-header-row>
                  <s-table-header listSlot="primary">Date</s-table-header>
                  <s-table-header listSlot="labeled">Affiliate</s-table-header>
                  <s-table-header listSlot="labeled">Order</s-table-header>
                  <s-table-header listSlot="labeled" format="currency">
                    Value
                  </s-table-header>
                  <s-table-header listSlot="inline">Email</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {recentEvents.map((event) => (
                    <s-table-row key={event.id}>
                      <s-table-cell>{formatDate(event.createdAt)}</s-table-cell>
                      <s-table-cell>
                        <s-link href={`/app/affiliates/${event.affiliateId}`}>
                          {event.affiliateName}
                        </s-link>
                      </s-table-cell>
                      <s-table-cell>{event.orderName}</s-table-cell>
                      <s-table-cell>
                        {event.orderValue.toFixed(2)} {event.currency}
                      </s-table-cell>
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

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
