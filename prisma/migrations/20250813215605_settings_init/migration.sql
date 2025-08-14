/*
  Warnings:

  - You are about to drop the column `key` on the `CompanyInfo` table. All the data in the column will be lost.
  - You are about to drop the column `value` on the `CompanyInfo` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."CompanyInfo_key_key";

-- AlterTable
ALTER TABLE "public"."CompanyInfo" DROP COLUMN "key",
DROP COLUMN "value",
ADD COLUMN     "address" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "contactPerson" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "logoPath" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postalCode" TEXT;

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "name" TEXT;

-- CreateTable
CREATE TABLE "public"."COASettings" (
    "id" TEXT NOT NULL,
    "defaultColumnMapping" JSONB,
    "extractionRules" JSONB,
    "fileProcessingLimits" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "COASettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ImportExportSettings" (
    "id" TEXT NOT NULL,
    "hsCodes" TEXT[],
    "competitorMapping" JSONB,
    "currencyPreferences" JSONB,
    "filterPresets" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportExportSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."QuestionnaireSettings" (
    "id" TEXT NOT NULL,
    "predefinedAnswers" JSONB,
    "skipLogicRules" JSONB,
    "certifications" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AISettings" (
    "id" TEXT NOT NULL,
    "openAiKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AISettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SystemPreferences" (
    "id" TEXT NOT NULL,
    "dateFormat" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "defaultExportFormat" TEXT NOT NULL,
    "backupConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "public"."AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_module_idx" ON "public"."AuditLog"("module");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "public"."AuditLog"("timestamp");

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
