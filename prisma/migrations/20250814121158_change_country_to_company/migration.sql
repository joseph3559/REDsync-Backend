/*
  Warnings:

  - You are about to drop the column `country` on the `ImportExportRecord` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."ImportExportRecord_country_idx";

-- AlterTable
ALTER TABLE "public"."ImportExportRecord" DROP COLUMN "country",
ADD COLUMN     "company" TEXT;

-- CreateIndex
CREATE INDEX "ImportExportRecord_company_idx" ON "public"."ImportExportRecord"("company");
