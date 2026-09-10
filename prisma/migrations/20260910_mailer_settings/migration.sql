-- CreateTable
CREATE TABLE "MailerSettings" (
    "shop" TEXT NOT NULL,
    "gmailUser" TEXT,
    "gmailAppPassword" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailerSettings_pkey" PRIMARY KEY ("shop")
);

