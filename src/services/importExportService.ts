import fs from "fs";
import path from "path";
import xlsx from "xlsx";
import Fuse from "fuse.js";
import axios from "axios";
import { PrismaClient } from "../../generated/prisma/index.js";
import { mapProductToRedEquivalent } from "./productMapping.js";

const prisma = new PrismaClient();

// Headers must match exactly the example report (including case/spacing)
export const REPORT_HEADERS = [
  "Product Name",
  "Importer/Exporter",
  "Quantity",
  "Price",
  "Incoterm",
  "Currency",
];

// Configurable competitors and RED mappings
const KNOWN_COMPETITOR_PRODUCTS: Array<{ name: string; aliases: string[]; redEquivalent?: string }> = [
  { name: "REDLEC Fluid 100 IP", aliases: ["REDLEC Fluid 100 IP", "RPI SB 100", "Fluid 100"], redEquivalent: "RED Product" },
  { name: "REDLEC Fluid 150", aliases: ["Fluid 150"], redEquivalent: "RED Product" },
  { name: "REDLEC Fluid 150 Premium", aliases: ["Fluid 150 Premium"], redEquivalent: "RED Product" },
  { name: "REDLEC Powder 100 IP", aliases: ["Powder 100 IP"], redEquivalent: "RED Product" },
  { name: "REDLEC RPI SB 100 IP", aliases: ["RPI SB 100 IP", "SB 100"], redEquivalent: "RED Product" },
  { name: "REDLEC S Fluid 150 Bio-Organic", aliases: ["Bio-Organic 150"], redEquivalent: "RED Product" },
  { name: "REDLEC S Fluid 150 Premium", aliases: ["S Fluid 150 Premium"], redEquivalent: "RED Product" },
  { name: "REDLEC S Powder", aliases: ["S Powder"], redEquivalent: "RED Product" },
];

const fuse = new Fuse(KNOWN_COMPETITOR_PRODUCTS, {
  keys: ["name", "aliases"],
  includeScore: true,
  threshold: 0.3,
});

const HS_CODE_REGEX = /(29\s*2320(?:\s*00)?|292320(?:00|20)?)/i;

type RowOut = {
  [K in (typeof REPORT_HEADERS)[number]]: string | number | null | undefined;
} & {
  __meta__?: Record<string, unknown>;
};

export async function processImportExportFiles({ files, userId }: { files: Express.Multer.File[]; userId?: string }) {
  // Ensure upload dir exists
  const dir = path.join(process.cwd(), "uploads", "import-export");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const allRows: Array<RowOut> = [];
  const logs: string[] = [];

  for (const file of files) {
    const wb = xlsx.readFile(file.path, { cellDates: true });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const json: any[] = xlsx.utils.sheet_to_json(ws, { defval: "" });

    for (const raw of json) {
      const combinedText = Object.values(raw).join(" ");
      const hsMatch = String(combinedText.match(HS_CODE_REGEX)?.[0] || "").replace(/\s+/g, "");

      const productCandidate = String(
        raw["Product"] || raw["Description"] || raw["Commodity"] || raw["Item"] || raw["Goods"] || ""
      );

      // Fuzzy competitor/product detection
      const fuzzyResults = fuse.search(productCandidate);
      const fuzzy = fuzzyResults.length ? fuzzyResults[0] : undefined;
      const matched = fuzzy && fuzzy.score !== undefined && fuzzy.score <= 0.3 ? fuzzy.item : null;

      const aiExtract = await maybeAskOpenAIForEntities(productCandidate, {
        hs: hsMatch,
      });

      const redMap = mapProductToRedEquivalent(productCandidate || combinedText);

      const row: RowOut = {
        "Product Name": aiExtract.productName || matched?.name || productCandidate || "",
        "Importer/Exporter": raw["Importer"] || raw["Exporter"] || raw["Party"] || aiExtract.company || "",
        "Quantity": toNumber(raw["Qty"] ?? raw["Quantity"] ?? raw["Net Weight"] ?? aiExtract.quantity),
        "Price": toNumber(raw["Price"] ?? raw["Unit Price"] ?? raw["FOB Value"] ?? raw["CIF Value"] ?? aiExtract.price),
        "Incoterm": aiExtract.incoterm || inferIncotermFromRow(raw),
        "Currency": raw["Currency"] || raw["Curr"] || aiExtract.currency || "",
      };

      // Attach meta non-enumerable to avoid index signature constraint during typing
      const flow = detectFlowFromFilename(file.originalname);
      const company = extractCompanyName(String(row["Importer/Exporter"] || ""), flow);
      
      Object.defineProperty(row, "__meta__", {
        value: {
          file: file.originalname,
          hsCode: hsMatch || aiExtract.hsCode || null,
          competitorName: aiExtract.competitor || matched?.name || null,
          redEquivalent: redMap?.level2 || matched?.redEquivalent || null,
          matchConfidence: fuzzy?.score != null ? 1 - (fuzzy.score as number) : undefined,
          company: company,  // Changed from country - now stores exporter name for exports, supplier name for imports
          flow: flow,
          period: detectPeriodFromFilename(file.originalname),
          redLevel1: redMap?.level1 || null,
        },
        enumerable: false,
      });

      allRows.push(row);

      logs.push(
        `[${file.originalname}] Product='${row["Product Name"]}' Company='${(row as any).__meta__?.company ?? "-"}' Flow='${(row as any).__meta__?.flow ?? "-"}' HS='${(row as any).__meta__?.hsCode ?? "-"}'`
      );

      // Persist
      try {
        await prisma.importExportRecord.create({
          data: {
            userId: userId || null,
            sourceFile: file.originalname,
            company: String((row as any).__meta__?.company || ""),  // Changed from country - now stores exporter name for exports, supplier name for imports
            flow: String((row as any).__meta__?.flow || "unknown"),
            hsCode: String((row as any).__meta__?.hsCode || ""),
            productName: String(row["Product Name"] || ""),
            importerExporter: String(row["Importer/Exporter"] || ""),
            quantity: nullableFloat(row["Quantity"]),
            price: nullableFloat(row["Price"]),
            incoterm: String(row["Incoterm"] || ""),
            currency: String(row["Currency"] || ""),
            competitorName: ((row as any).__meta__?.competitorName as string) || null,
            matchedProduct: ((row as any).__meta__?.redEquivalent as string) || null,
            matchConfidence: ((row as any).__meta__?.matchConfidence as number) ?? null,
            rawText: combinedText.slice(0, 2000),
            metadata: (row as any).__meta__ as any,
          },
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("DB save failed:", e);
      }
    }
  }

  // eslint-disable-next-line no-console
  for (const l of logs) console.log(l);

  return {
    headers: REPORT_HEADERS,
    rows: allRows.map((r) => ({
      "Product Name": r["Product Name"],
      "Importer/Exporter": r["Importer/Exporter"],
      "Quantity": r["Quantity"],
      "Price": r["Price"],
      "Incoterm": r["Incoterm"],
      "Currency": r["Currency"],
    })),
    totalRows: allRows.length,
  };
}

function toNumber(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function nullableFloat(v: any): number | null {
  const n = toNumber(v);
  return n === null ? null : n;
}

function inferIncotermFromRow(row: Record<string, any>): string {
  const text = Object.values(row).join(" ").toUpperCase();
  const incos = ["FOB", "CIF", "CFR", "DAP", "EXW", "DDP", "FCA", "CPT", "CIP"];
  for (const i of incos) if (text.includes(i)) return i;
  return "";
}

function extractCompanyName(importerExporter: string, flow: string): string {
  // Extract company name based on flow type
  // For exports: company = exporter name
  // For imports: company = supplier name
  if (!importerExporter) return "";
  
  // Clean up the company name by removing common patterns
  const cleaned = importerExporter
    .replace(/\b(LTD|LIMITED|INC|INCORPORATED|CORP|CORPORATION|PVT|PRIVATE|LLC|CO\.|COMPANY)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  
  return cleaned || importerExporter;
}

function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function detectFlowFromFilename(filename: string): string {
  const upper = filename.toUpperCase();
  if (upper.includes("IMPORT")) return "import";
  if (upper.includes("EXPORT")) return "export";
  return "unknown";
}

function detectPeriodFromFilename(filename: string): string | null {
  // Match patterns like 07-2024, JUL-24, Jan-24, 2024-07
  const upper = filename.toUpperCase();
  const m1 = upper.match(/(\d{2})[-_ ](\d{4})/); // 07-2024
  if (m1) {
    const [_, mm, yyyy] = m1;
    return `${yyyy}-${mm}`;
  }
  const m2 = upper.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-_ ]?(\d{2,4})/);
  if (m2) {
    const monthMap: Record<string, string> = {
      JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
      JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
    };
    const mm = monthMap[m2[1]];
    const yy = m2[2];
    const yyyy = yy.length === 2 ? `20${yy}` : yy;
    return `${yyyy}-${mm}`;
  }
  const m3 = upper.match(/(\d{4})[-_ ](\d{2})/); // 2024-07
  if (m3) return `${m3[1]}-${m3[2]}`;
  return null;
}

async function maybeAskOpenAIForEntities(text: string, hints: { hs?: string }) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey || !text) return { productName: "", company: "", price: null, quantity: null, currency: "", incoterm: "", competitor: "", hsCode: hints.hs || "" };

  try {
    const resp = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Extract trade entities. Return a compact JSON with keys: productName, company, price, quantity, currency, incoterm, competitor, hsCode. If unknown, use empty string or null.",
          },
          {
            role: "user",
            content: `Text: ${text}\nHS hint: ${hints.hs ?? ""}`,
          },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      },
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );

    const content = resp.data?.choices?.[0]?.message?.content || "{}";
    const json = JSON.parse(content);
    return json;
  } catch {
    return { productName: "", company: "", price: null, quantity: null, currency: "", incoterm: "", competitor: "", hsCode: hints.hs || "" };
  }
}


