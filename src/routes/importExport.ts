import { Router } from "express";
import multer from "multer";
import path from "path";
import { processImportExportFiles } from "../services/importExportService.js";
import { PrismaClient } from "../../generated/prisma/index.js";
import { authenticate } from "../utils/jwtAuth.js";

const prisma = new PrismaClient();

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(process.cwd(), "uploads", "import-export"));
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname) || ".xlsx";
    cb(null, `${unique}${ext}`);
  },
});
const upload = multer({ storage });

router.post("/process", authenticate, upload.array("files"), async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) {
      return res.status(400).json({ message: "No files uploaded. Use 'files' field." });
    }

    const result = await processImportExportFiles({ files, userId: req.userId });
    return res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("/api/import-export/process error", err);
    return res.status(500).json({ message: "Failed to process files", error: String(err) });
  }
});

// Get all import/export records for the authenticated user
router.get("/records", authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 1000; // Default to 1000 records
    const offset = (page - 1) * limit;

    // First try to get records for this user, if none exist, get records with null userId (legacy data)
    let records = await prisma.importExportRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      select: {
        id: true,
        sourceFile: true,
        company: true,  // Changed from country
        flow: true,
        hsCode: true,
        productName: true,
        importerExporter: true,
        quantity: true,
        price: true,
        incoterm: true,
        currency: true,
        competitorName: true,
        matchedProduct: true,
        matchConfidence: true,
        rawText: true,
        metadata: true,
        createdAt: true
      }
    });

    // If no records found for this user, check for legacy records (null userId)
    if (records.length === 0) {
      records = await prisma.importExportRecord.findMany({
        where: { userId: null },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          sourceFile: true,
          company: true,  // Changed from country
          flow: true,
          hsCode: true,
          productName: true,
          importerExporter: true,
          quantity: true,
          price: true,
          incoterm: true,
          currency: true,
          competitorName: true,
          matchedProduct: true,
          matchConfidence: true,
          rawText: true,
          metadata: true,
          createdAt: true
        }
      });
    }

    // Transform to match frontend ImportExportRow interface
    const transformedRecords = records.map(record => ({
      "Product Name": record.productName || "",
      "Importer/Exporter": record.importerExporter || "",
      "Quantity": record.quantity,
      "Price": record.price,
      "Incoterm": record.incoterm || "",
      "Currency": record.currency || "",
      "Company": record.company || "",  // Changed from Country - now stores exporter name for exports, supplier name for imports
      "Flow": record.flow || "",
      "HS Code": record.hsCode || "",
      "Competitor": record.competitorName || "",
      "Matched Product": record.matchedProduct || "",
      "Source File": record.sourceFile || "",
      "Created": record.createdAt?.toISOString() || ""
    }));

    // Count total records (user-specific or legacy)
    let totalCount = await prisma.importExportRecord.count({
      where: { userId }
    });
    
    if (totalCount === 0) {
      totalCount = await prisma.importExportRecord.count({
        where: { userId: null }
      });
    }

    res.json({
      records: transformedRecords,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Failed to fetch import/export records:', error);
    res.status(500).json({ message: "Failed to fetch import/export records", error: String(error) });
  }
});

export default router;

// Analytics endpoints
router.get("/analytics/monthly", authenticate, async (req, res) => {
  try {
    const { product, company, year } = req.query as { product?: string; company?: string; year?: string };
    const y = year ? Number(year) : undefined;

    const records = await prisma.importExportRecord.findMany({
              where: {
        AND: [
          { userId: req.userId },
          product ? { matchedProduct: { equals: product as string, mode: "insensitive" } } : {},
          company ? { company: { contains: company as string, mode: "insensitive" } } : {},  // Changed to filter by company field instead of importerExporter
        ],
      },
      select: {
        flow: true,
        quantity: true,
        price: true,
        metadata: true,
      },
    });

    const monthly: Record<string, { import: Metrics; export: Metrics }> = {};
    type Metrics = { kg: number; usd: number; usdPerKg: number };

    function ensure(month: string) {
      if (!monthly[month]) monthly[month] = { import: { kg: 0, usd: 0, usdPerKg: 0 }, export: { kg: 0, usd: 0, usdPerKg: 0 } };
      return monthly[month];
    }

    for (const r of records) {
      const meta = (r.metadata as any) || {};
      const period = meta.period || null;
      if (!period) continue;
      if (y && !String(period).startsWith(String(y))) continue;
      const bucket = ensure(period);
      const flow = (r.flow || "unknown").toLowerCase() === "export" ? "export" : "import";
      const kg = Number(r.quantity || 0);
      const usd = Number((r.price || 0) * kg);
      bucket[flow].kg += kg;
      bucket[flow].usd += usd;
    }

    // Compute USD/kg
    for (const m of Object.values(monthly)) {
      m.import.usdPerKg = m.import.kg ? m.import.usd / m.import.kg : 0;
      m.export.usdPerKg = m.export.kg ? m.export.usd / m.export.kg : 0;
    }

    // Note: YTD removed as requested - monthly values provide sufficient detail for reporting
    // Calculate date range from monthly data
    const monthKeys = Object.keys(monthly).sort();
    const dateRange = monthKeys.length > 0 ? {
      start: monthKeys[0],
      end: monthKeys[monthKeys.length - 1],
      formatted: formatDateRange(monthKeys[0], monthKeys[monthKeys.length - 1])
    } : null;

    return res.json({ monthly, dateRange });
  } catch (err) {
    return res.status(500).json({ message: "Failed to compute monthly analytics", error: String(err) });
  }
});

router.get("/analytics/grouped", authenticate, async (req, res) => {
  try {
    const { product } = req.query as { product?: string };
    const records = await prisma.importExportRecord.findMany({
      where: {
        AND: [
          { userId: req.userId },
          product ? { matchedProduct: { equals: product as string, mode: "insensitive" } } : {},
        ],
      },
      select: {
        importerExporter: true,
        company: true,  // Changed from country
        matchedProduct: true,
        quantity: true,
        price: true,
        metadata: true,
      },
    });

    const rows = records.map((r) => {
      const period = ((r.metadata as any)?.period as string) || null;
      return {
        exporterName: r.importerExporter || "",
        companyName: r.company || "",  // Changed from exportingCountry - now stores company name
        redProduct: r.matchedProduct || "",
        period,
        kg: Number(r.quantity || 0),
        usd: Number((r.price || 0) * Number(r.quantity || 0)),
        usdPerKg: r.quantity ? Number((r.price || 0)) : 0,
        importerName: (r.metadata as any)?.importerName || "",
        importerCountry: (r.metadata as any)?.importerCountry || "",
      };
    });

    return res.json({ rows });
  } catch (err) {
    return res.status(500).json({ message: "Failed to build grouped list", error: String(err) });
  }
});

router.get("/analytics/undefined", authenticate, async (req, res) => {
  try {
    const records = await prisma.importExportRecord.findMany({
      where: { userId: req.userId },
      select: { metadata: true },
    });
    const buckets: Record<string, Array<any>> = {};
    for (const r of records) {
      const meta = (r.metadata as any) || {};
      if (meta.redLevel1 === 'To be defined') {
        const period = meta.period || 'Unknown';
        if (!buckets[period]) buckets[period] = [];
        buckets[period].push(meta);
      }
    }
    return res.json({ byPeriod: buckets });
  } catch (err) {
    return res.status(500).json({ message: "Failed to list undefined items", error: String(err) });
  }
});

router.get("/analytics/products", authenticate, async (req, res) => {
  try {
    const products = await prisma.importExportRecord.findMany({
      where: { 
        AND: [
          { userId: req.userId },
          { matchedProduct: { not: null } }
        ]
      },
      distinct: ["matchedProduct"],
      select: { matchedProduct: true },
      orderBy: { matchedProduct: "asc" },
    });
    return res.json({ products: products.map((p) => p.matchedProduct) });
  } catch (err) {
    return res.status(500).json({ message: "Failed to list products", error: String(err) });
  }
});

router.get("/analytics/companies", authenticate, async (req, res) => {
  try {
    const companies = await prisma.importExportRecord.findMany({
      where: { 
        AND: [
          { userId: req.userId },
          { company: { not: null } },
          { company: { not: "" } }
        ]
      },
      distinct: ["company"],
      select: { company: true },
      orderBy: { company: "asc" },
    });
    return res.json({ companies: companies.map((c) => c.company) });
  } catch (err) {
    return res.status(500).json({ message: "Failed to list companies", error: String(err) });
  }
});

// Helper function to format date range for display (e.g., "Jan 2024 to Mar 2024")
function formatDateRange(start: string, end: string): string {
  const formatPeriod = (period: string) => {
    // Expect format "YYYY-MM"
    if (!period || !period.includes('-')) return period;
    const [year, month] = period.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthIndex = parseInt(month) - 1;
    if (monthIndex >= 0 && monthIndex < 12) {
      return `${monthNames[monthIndex]} ${year}`;
    }
    return period;
  };

  if (start === end) {
    return formatPeriod(start);
  }
  return `${formatPeriod(start)} to ${formatPeriod(end)}`;
}

