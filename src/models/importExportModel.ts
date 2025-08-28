import { PrismaClient } from "../../generated/prisma/index.js";

const prisma = new PrismaClient();

export const ImportExportModel = {
  async insert(record: {
    sourceFile: string;
    company?: string | null;  // Changed from country - stores exporter name for exports, supplier name for imports
    flow: string;
    hsCode?: string | null;
    productName?: string | null;
    importerExporter?: string | null;
    quantity?: number | null;
    price?: number | null;
    incoterm?: string | null;
    currency?: string | null;
    competitorName?: string | null;
    matchedProduct?: string | null;
    matchConfidence?: number | null;
    rawText?: string | null;
    metadata?: any;
    userId?: string | null;
  }) {
    return prisma.importExportRecord.create({ data: record as any });
  },
};


