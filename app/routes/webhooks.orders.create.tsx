import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { sendAffiliateUsageEmail } from "../services/mailer.server";
import { calculateAmount, type ValueType } from "../lib/value-type";

interface OrderWebhookPayload {
  id: number | string;
  name?: string;
  order_number?: number;
  total_price?: string;
  currency?: string;
  discount_codes?: { code: string }[];
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const order = payload as unknown as OrderWebhookPayload;
  const discountCodes = order.discount_codes ?? [];

  if (discountCodes.length === 0) {
    return new Response();
  }

  const orderName = order.name ?? `#${order.order_number ?? order.id}`;

  for (const { code } of discountCodes) {
    const affiliate = await db.affiliate.findUnique({
      where: { discountCode: code },
    });

    if (!affiliate || !affiliate.active) {
      continue;
    }

    const orderValue = Number(order.total_price ?? "0");
    const commissionEarned = calculateAmount(
      affiliate.commissionType as ValueType,
      affiliate.commissionValue,
      orderValue,
    );

    const usageEvent = await db.usageEvent.create({
      data: {
        affiliateId: affiliate.id,
        shopifyOrderId: String(order.id),
        orderName,
        orderValue: order.total_price ?? "0",
        currency: order.currency ?? "USD",
        commissionEarned,
      },
    });

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
        shop,
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
        where: { id: usageEvent.id },
        data: { emailSent: true },
      });
    } catch (error) {
      await db.usageEvent.update({
        where: { id: usageEvent.id },
        data: {
          emailError: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  return new Response();
};
