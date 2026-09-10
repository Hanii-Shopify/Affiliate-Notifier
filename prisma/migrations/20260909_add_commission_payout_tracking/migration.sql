-- AlterTable
ALTER TABLE "UsageEvent" ADD COLUMN     "commissionPaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "commissionPaidAt" TIMESTAMP(3);

