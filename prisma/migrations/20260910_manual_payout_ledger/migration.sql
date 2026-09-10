-- AlterTable
ALTER TABLE "UsageEvent" DROP COLUMN "commissionPaid",
DROP COLUMN "commissionPaidAt";

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payout_affiliateId_idx" ON "Payout"("affiliateId");

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

