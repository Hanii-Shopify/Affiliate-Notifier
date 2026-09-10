-- DropForeignKey
ALTER TABLE "UsageEvent" DROP CONSTRAINT "UsageEvent_affiliateId_fkey";

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

