-- CreateTable
CREATE TABLE "public"."ImportExportRecord" (
    "id" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "country" TEXT,
    "flow" TEXT NOT NULL,
    "hsCode" TEXT,
    "productName" TEXT,
    "importerExporter" TEXT,
    "quantity" DOUBLE PRECISION,
    "price" DOUBLE PRECISION,
    "incoterm" TEXT,
    "currency" TEXT,
    "competitorName" TEXT,
    "matchedProduct" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "rawText" TEXT,
    "metadata" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportExportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportExportRecord_flow_idx" ON "public"."ImportExportRecord"("flow");

-- CreateIndex
CREATE INDEX "ImportExportRecord_hsCode_idx" ON "public"."ImportExportRecord"("hsCode");

-- CreateIndex
CREATE INDEX "ImportExportRecord_country_idx" ON "public"."ImportExportRecord"("country");

-- CreateIndex
CREATE INDEX "ImportExportRecord_createdAt_idx" ON "public"."ImportExportRecord"("createdAt");
