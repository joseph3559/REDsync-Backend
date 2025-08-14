-- CreateTable
CREATE TABLE "public"."CoaRecord" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sampleId" TEXT,
    "batchId" TEXT,
    "extractionPhase" INTEGER NOT NULL DEFAULT 1,
    "ai" TEXT,
    "av" TEXT,
    "pov" TEXT,
    "colorGardner10" TEXT,
    "viscosity25" TEXT,
    "hexaneInsolubles" TEXT,
    "moisture" TEXT,
    "lead" TEXT,
    "mercury" TEXT,
    "arsenic" TEXT,
    "iron" TEXT,
    "enterobacteriaceae" TEXT,
    "totalPlateCount" TEXT,
    "yeastsMolds" TEXT,
    "yeasts" TEXT,
    "moulds" TEXT,
    "salmonella25g" TEXT,
    "salmonella250g" TEXT,
    "eColi" TEXT,
    "listeria25g" TEXT,
    "pc" TEXT,
    "pe" TEXT,
    "lpc" TEXT,
    "pa" TEXT,
    "pi" TEXT,
    "p" TEXT,
    "pl" TEXT,
    "pah4" TEXT,
    "ochratoxinA" TEXT,
    "pesticides" TEXT,
    "heavyMetals" TEXT,
    "peanutContent" TEXT,
    "gmoTest" TEXT,
    "colorGardnerAsIs" TEXT,
    "colorIodine" TEXT,
    "tolueneInsolubles" TEXT,
    "specificGravity" TEXT,
    "ffaAtLoading" TEXT,
    "iodineValue" TEXT,
    "soapContent" TEXT,
    "insolubleMatter" TEXT,
    "moistureInsolubles" TEXT,
    "additionalFields" JSONB,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoaRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoaRecord_userId_idx" ON "public"."CoaRecord"("userId");

-- CreateIndex
CREATE INDEX "CoaRecord_sampleId_idx" ON "public"."CoaRecord"("sampleId");

-- CreateIndex
CREATE INDEX "CoaRecord_batchId_idx" ON "public"."CoaRecord"("batchId");

-- CreateIndex
CREATE INDEX "CoaRecord_createdAt_idx" ON "public"."CoaRecord"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."CoaRecord" ADD CONSTRAINT "CoaRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
