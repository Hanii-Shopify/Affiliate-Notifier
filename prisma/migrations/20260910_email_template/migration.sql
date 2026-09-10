-- CreateTable
CREATE TABLE "EmailTemplate" (
    "shop" TEXT NOT NULL,
    "subject" TEXT,
    "blocks" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("shop")
);

