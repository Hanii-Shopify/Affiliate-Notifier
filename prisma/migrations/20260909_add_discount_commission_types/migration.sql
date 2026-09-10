-- CreateEnum
CREATE TYPE "ValueType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- AlterTable
ALTER TABLE "Affiliate" DROP COLUMN "discountPercentage",
ADD COLUMN     "commissionType" "ValueType" NOT NULL DEFAULT 'PERCENTAGE',
ADD COLUMN     "commissionValue" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "discountType" "ValueType" NOT NULL DEFAULT 'PERCENTAGE',
ADD COLUMN     "discountValue" DOUBLE PRECISION NOT NULL;

-- AlterTable
ALTER TABLE "UsageEvent" ADD COLUMN     "commissionEarned" DECIMAL(65,30) NOT NULL DEFAULT 0;

