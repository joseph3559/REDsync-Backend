import { Router } from "express";
import multer from "multer";
import path from "path";
import { getPhase1CoaColumns, getPhase2CoaColumns, getCoaColumnsWithConfig, getPhase1ColumnsWithConfig, getCoaColumnsFromExcel } from "../utils/coaColumns.js";
import { spawn } from "child_process";
import { PrismaClient } from "../../generated/prisma";
import { authenticate } from "../utils/jwtAuth";
const router = Router();
const prisma = new PrismaClient();
// Mapping function to convert extracted data to database fields
function mapExtractedDataToDbFields(extractedData) {
    const fieldMapping = {
        // Core parameters
        'AI': 'ai',
        'AV': 'av',
        'POV': 'pov',
        'Color Gardner (10% dil.)': 'colorGardner10',
        'Viscosity at 25°C': 'viscosity25',
        'Hexane Insolubles': 'hexaneInsolubles',
        'Moisture': 'moisture',
        // Heavy metals
        'Lead': 'lead',
        'Mercury': 'mercury',
        'Arsenic': 'arsenic',
        'Iron (Fe)': 'iron',
        // Microbiology
        'Enterobacteriaceae': 'enterobacteriaceae',
        'Total Plate Count': 'totalPlateCount',
        'Yeasts & Molds': 'yeastsMolds',
        'Yeasts & Moulds': 'yeastsMolds',
        'Yeasts': 'yeasts',
        'Moulds': 'moulds',
        'Salmonella (in 25g)': 'salmonella25g',
        'Salmonella (in 250g)': 'salmonella250g',
        'E. coli': 'eColi',
        'Listeria monocytogenes (in 25g)': 'listeria25g',
        // Phospholipids
        'PC': 'pc',
        'PE': 'pe',
        'LPC': 'lpc',
        'PA': 'pa',
        'PI': 'pi',
        'P': 'p',
        'PL': 'pl',
        // Contaminants
        'PAH4': 'pah4',
        'Ochratoxin A': 'ochratoxinA',
        'Pesticides': 'pesticides',
        'Heavy Metals': 'heavyMetals',
        'Peanut content': 'peanutContent',
        // GMO
        'PCR, 50 cycl. (GMO), 35S/NOS/FMV': 'gmoTest',
        // Other chemical
        'Color Gardner (As is)': 'colorGardnerAsIs',
        'Color Iodine': 'colorIodine',
        'Toluene Insolubles': 'tolueneInsolubles',
        'Specific gravity': 'specificGravity',
        'FFA (%Oleic) at loading': 'ffaAtLoading',
        'Iodine value': 'iodineValue',
        'Soap content': 'soapContent',
        'Insoluble matters': 'insolubleMatter',
        'Moisture and insolubles': 'moistureInsolubles',
    };
    const dbData = {};
    const additionalFields = {};
    for (const [key, value] of Object.entries(extractedData)) {
        if (key === 'sample_id') {
            dbData.sampleId = value;
        }
        else if (key === 'batch_id') {
            dbData.batchId = value;
        }
        else if (key === 'extraction_phase') {
            dbData.extractionPhase = value;
        }
        else if (fieldMapping[key]) {
            dbData[fieldMapping[key]] = typeof value === 'string' ? value : String(value || '');
        }
        else if (key !== 'file' && key !== 'phase') {
            // Store unmapped fields in additionalFields
            additionalFields[key] = value;
        }
    }
    if (Object.keys(additionalFields).length > 0) {
        dbData.additionalFields = additionalFields;
    }
    return dbData;
}
// Helper function to normalize sample ID (remove "M" prefix for comparison)
function normalizeSampleId(sampleId) {
    if (!sampleId)
        return null;
    const normalized = String(sampleId).trim();
    // Remove "M" prefix if present (case insensitive) followed by optional spaces
    // This handles: "M20243602", "M 20243602", "m20243602", "m 20243602", etc.
    const withoutM = normalized.replace(/^M\s*/i, '').trim();
    // Return null if nothing left after removing M prefix
    return withoutM || null;
}
// Helper function to extract sample and batch IDs from filename as fallback
function extractIdsFromFilename(fileName) {
    // Pattern: "BA001734 - M20253004 - Ali.pdf" or similar
    // Look for patterns like "BA001XXX" for batch and "M20XXXXXX" for sample
    const batchMatch = fileName.match(/\b(BA\d{6})\b/i);
    const sampleMatch = fileName.match(/\b(M\s*\d{8})\b/i);
    return {
        batchId: batchMatch ? batchMatch[1] : null,
        sampleId: sampleMatch ? sampleMatch[1].replace(/\s+/g, '').trim() : null // Remove any spaces within the sample ID
    };
}
// Upsert function to prevent duplicate records with same sample and batch
async function upsertCoaRecord(userId, fileName, dbData) {
    let sampleId = dbData.sampleId;
    let batchId = dbData.batchId;
    // If PDF parsing failed to extract IDs, try to extract from filename
    if (!sampleId || !batchId) {
        const filenameIds = extractIdsFromFilename(fileName);
        console.log(`PDF parsing missing IDs for ${fileName}. PDF extracted: sample="${sampleId}", batch="${batchId}". Filename extracted: sample="${filenameIds.sampleId}", batch="${filenameIds.batchId}"`);
        // Use filename extraction as fallback
        sampleId = sampleId || filenameIds.sampleId;
        batchId = batchId || filenameIds.batchId;
        // Update dbData with fallback values
        if (filenameIds.sampleId)
            dbData.sampleId = filenameIds.sampleId;
        if (filenameIds.batchId)
            dbData.batchId = filenameIds.batchId;
    }
    if (!sampleId || !batchId) {
        console.log(`Unable to extract sample/batch IDs for ${fileName}. Creating separate record. Sample="${sampleId}", Batch="${batchId}"`);
        // If still no sample or batch ID after filename extraction, create new record
        return await prisma.coaRecord.create({
            data: {
                fileName,
                userId,
                ...dbData
            }
        });
    }
    // Normalize sample ID for comparison (remove "M" prefix)
    const normalizedSampleId = normalizeSampleId(sampleId);
    const normalizedBatchId = String(batchId).trim();
    if (!normalizedSampleId || !normalizedBatchId) {
        // If normalization results in empty values, create new record
        return await prisma.coaRecord.create({
            data: {
                fileName,
                userId,
                ...dbData
            }
        });
    }
    // Find existing record with same normalized sample and batch IDs
    // Since we need to normalize existing database values, we'll get all records with same batch
    // and then filter by normalized sample ID in JavaScript
    const candidateRecords = await prisma.coaRecord.findMany({
        where: {
            userId,
            batchId: normalizedBatchId,
            sampleId: { not: null } // Ensure sample ID exists
        }
    });
    // Find matching record by comparing normalized sample IDs
    const existingRecord = candidateRecords.find(record => {
        const existingNormalized = normalizeSampleId(record.sampleId);
        return existingNormalized === normalizedSampleId;
    });
    if (existingRecord) {
        // Update existing record, merging new data (new values override existing ones)
        console.log(`Updating existing COA record: Sample="${sampleId}" (normalized: "${normalizedSampleId}"), Batch="${normalizedBatchId}"`);
        // Prepare update data - only include non-null/non-empty values
        const updateData = {};
        for (const [key, value] of Object.entries(dbData)) {
            if (value !== null && value !== undefined && value !== '') {
                updateData[key] = value;
            }
        }
        // Always update the fileName to track the latest file processed
        updateData.fileName = fileName;
        updateData.updatedAt = new Date();
        return await prisma.coaRecord.update({
            where: { id: existingRecord.id },
            data: updateData
        });
    }
    else {
        // Create new record
        console.log(`Creating new COA record: Sample="${sampleId}" (normalized: "${normalizedSampleId}"), Batch="${normalizedBatchId}"`);
        return await prisma.coaRecord.create({
            data: {
                fileName,
                userId,
                ...dbData
            }
        });
    }
}
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        const dest = path.join(process.cwd(), "uploads", "coa");
        cb(null, dest);
    },
    filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        const ext = path.extname(file.originalname) || ".pdf";
        cb(null, `${unique}${ext}`);
    },
});
const upload = multer({ storage });
router.get("/columns", async (req, res) => {
    try {
        const phase = req.query.phase;
        if (phase === "1") {
            const columns = await getPhase1CoaColumns();
            return res.json({ columns, phase: 1 });
        }
        else if (phase === "2") {
            const columns = await getPhase2CoaColumns();
            return res.json({ columns, phase: 2 });
        }
        else if (phase === "config") {
            const columnsConfig = await getCoaColumnsWithConfig();
            return res.json({ columnsConfig });
        }
        else if (phase === "phase1-config") {
            const columnsConfig = await getPhase1ColumnsWithConfig();
            return res.json({ columnsConfig, phase: 1 });
        }
        else {
            // Default to Phase 1 columns for better focus
            const columns = await getPhase1CoaColumns();
            return res.json({ columns, phase: 1, default: true });
        }
    }
    catch (err) {
        return res.status(500).json({ message: "Failed to read columns", error: String(err) });
    }
});
router.post("/upload", authenticate, upload.array("files"), async (req, res) => {
    const files = req.files || [];
    if (files.length === 0) {
        return res.status(400).json({ message: "No files uploaded. Use 'files' field." });
    }
    const userId = req.userId;
    try {
        const phase = req.body.phase || "1"; // Default to Phase 1
        const columns = phase === "2" ? await getPhase2CoaColumns() : await getPhase1CoaColumns();
        const results = [];
        const savedRecords = [];
        for (const file of files) {
            const parsed = await runPythonParser({
                pdfPath: file.path,
                columns,
                openaiApiKey: process.env.OPENAI_API_KEY || "",
                phase: parseInt(phase),
            });
            // Map extracted data to database fields
            const dbData = mapExtractedDataToDbFields(parsed);
            // Save to database with upsert logic to prevent duplicates
            try {
                const savedRecord = await upsertCoaRecord(userId, file.originalname, dbData);
                savedRecords.push(savedRecord);
            }
            catch (dbError) {
                console.error('Database save error:', dbError);
                // Continue processing other files even if one fails
            }
            // Keep the original format for the response
            results.push({
                file: path.basename(file.path),
                phase: parseInt(phase),
                ...parsed
            });
        }
        return res.json({
            results,
            phase: parseInt(phase),
            savedToDatabase: savedRecords.length,
            totalFiles: files.length
        });
    }
    catch (err) {
        return res.status(500).json({ message: "Failed to process PDFs", error: String(err) });
    }
});
// Get all COA records from database
router.get("/records", authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const records = await prisma.coaRecord.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                fileName: true,
                sampleId: true,
                batchId: true,
                extractionPhase: true,
                ai: true,
                av: true,
                pov: true,
                colorGardner10: true,
                viscosity25: true,
                hexaneInsolubles: true,
                moisture: true,
                lead: true,
                mercury: true,
                arsenic: true,
                iron: true,
                enterobacteriaceae: true,
                totalPlateCount: true,
                yeastsMolds: true,
                yeasts: true,
                moulds: true,
                salmonella25g: true,
                salmonella250g: true,
                eColi: true,
                listeria25g: true,
                pc: true,
                pe: true,
                lpc: true,
                pa: true,
                pi: true,
                p: true,
                pl: true,
                pah4: true,
                ochratoxinA: true,
                pesticides: true,
                heavyMetals: true,
                peanutContent: true,
                gmoTest: true,
                additionalFields: true,
                createdAt: true,
                updatedAt: true
            }
        });
        // Convert database format back to frontend format
        const formattedRecords = records.map(record => {
            const formatted = {
                id: record.id, // Include database ID for deletion functionality
                file: record.fileName,
                sample_id: record.sampleId,
                batch_id: record.batchId,
                extraction_phase: record.extractionPhase,
                'Sample #': record.sampleId,
                'Batch': record.batchId,
                // Core parameters
                'AI': record.ai,
                'AV': record.av,
                'POV': record.pov,
                'Color Gardner (10% dil.)': record.colorGardner10,
                'Viscosity at 25°C': record.viscosity25,
                'Hexane Insolubles': record.hexaneInsolubles,
                'Moisture': record.moisture,
                // Heavy metals
                'Lead': record.lead,
                'Mercury': record.mercury,
                'Arsenic': record.arsenic,
                'Iron (Fe)': record.iron,
                // Microbiology
                'Enterobacteriaceae': record.enterobacteriaceae,
                'Total Plate Count': record.totalPlateCount,
                'Yeasts & Molds': record.yeastsMolds,
                'Yeasts': record.yeasts,
                'Moulds': record.moulds,
                'Salmonella (in 25g)': record.salmonella25g,
                'Salmonella (in 250g)': record.salmonella250g,
                'E. coli': record.eColi,
                'Listeria monocytogenes (in 25g)': record.listeria25g,
                // Phospholipids
                'PC': record.pc,
                'PE': record.pe,
                'LPC': record.lpc,
                'PA': record.pa,
                'PI': record.pi,
                'P': record.p,
                'PL': record.pl,
                // Contaminants
                'PAH4': record.pah4,
                'Ochratoxin A': record.ochratoxinA,
                'Pesticides': record.pesticides,
                'Heavy Metals': record.heavyMetals,
                'Peanut content': record.peanutContent,
                // GMO
                'PCR, 50 cycl. (GMO), 35S/NOS/FMV': record.gmoTest,
                // Additional fields from JSON
                ...(record.additionalFields || {})
            };
            // Remove null/undefined values
            Object.keys(formatted).forEach(key => {
                if (formatted[key] === null || formatted[key] === undefined) {
                    delete formatted[key];
                }
            });
            return formatted;
        });
        return res.json({ records: formattedRecords });
    }
    catch (err) {
        return res.status(500).json({ message: "Failed to fetch COA records", error: String(err) });
    }
});
// Delete COA records
router.delete("/records", authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { recordIds } = req.body;
        if (!Array.isArray(recordIds) || recordIds.length === 0) {
            return res.status(400).json({ message: "No record IDs provided" });
        }
        const deleted = await prisma.coaRecord.deleteMany({
            where: {
                id: { in: recordIds },
                userId: userId // Ensure user can only delete their own records
            }
        });
        return res.json({ deletedCount: deleted.count });
    }
    catch (err) {
        return res.status(500).json({ message: "Failed to delete COA records", error: String(err) });
    }
});
// Export CSV with headers that exactly match the Excel file (including blanks and order)
router.post("/export", async (req, res) => {
    try {
        const rows = req.body?.rows || [];
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ message: "No rows provided for export" });
        }
        const headers = await getCoaColumnsFromExcel();
        // CSV escape function for values (RFC 4180-style quoting)
        const escapeCsv = (value) => {
            if (value === null || value === undefined)
                return "";
            const str = String(value);
            if (/[",\n\r]/.test(str)) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        };
        // Build CSV lines
        // Preserve headers EXACTLY as read from Excel, including blanks
        const headerLine = headers
            .map((h) => (/[",\n\r]/.test(h) ? '"' + h.replace(/"/g, '""') + '"' : h))
            .join(",");
        const lines = [headerLine];
        for (const row of rows) {
            const fields = headers.map((header) => {
                // Empty header columns intentionally produce empty fields
                if (header === "")
                    return "";
                return escapeCsv(row[header]);
            });
            lines.push(fields.join(","));
        }
        const csv = lines.join("\n");
        const filename = `coa-export-${new Date().toISOString().split("T")[0]}.csv`;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.status(200).send(csv);
    }
    catch (err) {
        return res.status(500).json({ message: "Failed to generate CSV", error: String(err) });
    }
});
// Stats endpoint for dashboard
router.get("/stats", authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        // Get COA stats
        const totalSamplesThisMonth = await prisma.coaRecord.count({
            where: {
                userId,
                createdAt: {
                    gte: startOfMonth
                }
            }
        });
        const totalFiles = await prisma.coaRecord.count({
            where: { userId }
        });
        // Mock processing time data
        const avgProcessingTime = "2.4 seconds";
        // Get last upload date
        const lastUpload = await prisma.coaRecord.findFirst({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true }
        });
        // Monthly upload data for charts (last 6 months)
        const monthlyData = [];
        for (let i = 5; i >= 0; i--) {
            const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
            const count = await prisma.coaRecord.count({
                where: {
                    userId,
                    createdAt: {
                        gte: monthStart,
                        lte: monthEnd
                    }
                }
            });
            monthlyData.push({
                month: monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                uploads: count
            });
        }
        res.json({
            totalSamplesThisMonth,
            totalFiles,
            avgProcessingTime,
            lastUploadDate: lastUpload?.createdAt || null,
            monthlyUploads: monthlyData
        });
    }
    catch (error) {
        console.error("COA stats error:", error);
        res.status(500).json({ message: "Failed to fetch COA statistics" });
    }
});
// Cleanup endpoint to remove duplicate COA records
router.post("/cleanup-duplicates", authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        console.log(`Starting duplicate cleanup for user: ${userId}`);
        // Get all records for the user
        const allRecords = await prisma.coaRecord.findMany({
            where: { userId },
            orderBy: { createdAt: 'asc' } // Keep the oldest record as the "master"
        });
        console.log(`Found ${allRecords.length} total records`);
        // Group records by normalized sample and batch IDs
        const recordGroups = {};
        for (const record of allRecords) {
            let sampleId = record.sampleId;
            let batchId = record.batchId;
            // If record has null sample_id or batch_id, try to extract from filename
            if (!sampleId || !batchId) {
                const filenameIds = extractIdsFromFilename(record.fileName);
                sampleId = sampleId || filenameIds.sampleId;
                batchId = batchId || filenameIds.batchId;
                console.log(`Cleanup: Attempting filename extraction for ${record.fileName}. DB: sample="${record.sampleId}", batch="${record.batchId}". Filename: sample="${filenameIds.sampleId}", batch="${filenameIds.batchId}"`);
            }
            if (!sampleId || !batchId) {
                console.log(`Cleanup: Skipping record ${record.fileName} - unable to determine sample/batch IDs`);
                continue;
            }
            const normalizedSampleId = normalizeSampleId(sampleId);
            const normalizedBatchId = String(batchId).trim();
            if (!normalizedSampleId || !normalizedBatchId)
                continue;
            const groupKey = `${normalizedSampleId}||${normalizedBatchId}`;
            if (!recordGroups[groupKey]) {
                recordGroups[groupKey] = [];
            }
            // Add the extracted IDs to the record for grouping
            recordGroups[groupKey].push({
                ...record,
                extractedSampleId: sampleId,
                extractedBatchId: batchId
            });
        }
        let mergedRecords = 0;
        let deletedRecords = 0;
        // Process each group
        for (const [groupKey, records] of Object.entries(recordGroups)) {
            if (records.length <= 1)
                continue; // No duplicates
            const sampleVariations = records.map(r => `"${r.sampleId}"`).join(', ');
            console.log(`Processing group ${groupKey} with ${records.length} records. Sample variations: ${sampleVariations}`);
            // Keep the first (oldest) record as master
            const masterRecord = records[0];
            const duplicateRecords = records.slice(1);
            // Merge data from duplicates into master record
            const mergedData = {};
            let hasUpdates = false;
            // First, ensure we have the extracted sample and batch IDs
            const masterExtractedSampleId = masterRecord.extractedSampleId;
            const masterExtractedBatchId = masterRecord.extractedBatchId;
            // If master record has null sample_id but we extracted one, update it
            if (!masterRecord.sampleId && masterExtractedSampleId) {
                mergedData.sampleId = masterExtractedSampleId;
                hasUpdates = true;
                console.log(`Updating master record sample_id from null to "${masterExtractedSampleId}"`);
            }
            // If master record has null batch_id but we extracted one, update it
            if (!masterRecord.batchId && masterExtractedBatchId) {
                mergedData.batchId = masterExtractedBatchId;
                hasUpdates = true;
                console.log(`Updating master record batch_id from null to "${masterExtractedBatchId}"`);
            }
            // Collect all non-null values from all records
            for (const record of records) {
                for (const [key, value] of Object.entries(record)) {
                    if (key === 'id' || key === 'userId' || key === 'createdAt' || key === 'extractedSampleId' || key === 'extractedBatchId')
                        continue;
                    if (value !== null && value !== undefined && value !== '') {
                        // If master doesn't have this value, or duplicate has newer data
                        if (!masterRecord[key] || record.createdAt > masterRecord.createdAt) {
                            mergedData[key] = value;
                            hasUpdates = true;
                        }
                    }
                }
            }
            // Update master record with merged data
            if (hasUpdates) {
                await prisma.coaRecord.update({
                    where: { id: masterRecord.id },
                    data: {
                        ...mergedData,
                        updatedAt: new Date()
                    }
                });
                mergedRecords++;
            }
            // Delete duplicate records
            for (const duplicate of duplicateRecords) {
                await prisma.coaRecord.delete({
                    where: { id: duplicate.id }
                });
                deletedRecords++;
            }
            console.log(`Merged ${duplicateRecords.length} duplicates into master record for ${groupKey}`);
        }
        console.log(`Cleanup completed: ${mergedRecords} records updated, ${deletedRecords} duplicates removed`);
        return res.json({
            message: "Duplicate cleanup completed successfully",
            mergedRecords,
            deletedRecords,
            totalGroupsProcessed: Object.keys(recordGroups).length,
            duplicateGroupsFound: Object.values(recordGroups).filter(group => group.length > 1).length
        });
    }
    catch (err) {
        console.error('Cleanup error:', err);
        return res.status(500).json({ message: "Failed to cleanup duplicates", error: String(err) });
    }
});
// Test endpoint to verify sample ID normalization (useful for debugging)
router.post("/test-normalization", authenticate, async (req, res) => {
    try {
        const { sampleIds } = req.body;
        if (!Array.isArray(sampleIds)) {
            return res.status(400).json({ message: "sampleIds must be an array" });
        }
        const results = sampleIds.map(sampleId => ({
            original: sampleId,
            normalized: normalizeSampleId(sampleId),
            matches: sampleIds.filter(otherId => normalizeSampleId(otherId) === normalizeSampleId(sampleId) && otherId !== sampleId)
        }));
        return res.json({
            message: "Sample ID normalization test results",
            results,
            testCases: [
                { input: "M20243602", expected: "20243602" },
                { input: "M 20243602", expected: "20243602" },
                { input: "m20243602", expected: "20243602" },
                { input: "m 20243602", expected: "20243602" },
                { input: "20243602", expected: "20243602" }
            ].map(test => ({
                ...test,
                actual: normalizeSampleId(test.input),
                passed: normalizeSampleId(test.input) === test.expected
            }))
        });
    }
    catch (err) {
        return res.status(500).json({ message: "Failed to test normalization", error: String(err) });
    }
});
// Test endpoint to verify filename extraction (useful for debugging)
router.post("/test-filename-extraction", authenticate, async (req, res) => {
    try {
        const { filenames } = req.body;
        if (!Array.isArray(filenames)) {
            return res.status(400).json({ message: "filenames must be an array" });
        }
        const results = filenames.map(filename => ({
            filename,
            extracted: extractIdsFromFilename(filename),
            normalized: {
                sampleId: normalizeSampleId(extractIdsFromFilename(filename).sampleId),
                batchId: extractIdsFromFilename(filename).batchId
            }
        }));
        return res.json({
            message: "Filename extraction test results",
            results,
            testCases: [
                { input: "BA001734 - M20253004 - Ali.pdf", expectedSample: "M20253004", expectedBatch: "BA001734" },
                { input: "BA001734 - M20253004 - Nofalab.pdf", expectedSample: "M20253004", expectedBatch: "BA001734" },
                { input: "BA001682 - M20251009 - IFP.pdf", expectedSample: "M20251009", expectedBatch: "BA001682" }
            ].map(test => ({
                ...test,
                actual: extractIdsFromFilename(test.input),
                passed: extractIdsFromFilename(test.input).sampleId === test.expectedSample &&
                    extractIdsFromFilename(test.input).batchId === test.expectedBatch
            }))
        });
    }
    catch (err) {
        return res.status(500).json({ message: "Failed to test filename extraction", error: String(err) });
    }
});
export default router;
function runPythonParser(args) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(process.cwd(), "src", "python", "parse_coa_pdf.py");
        const py = spawn("python3", [scriptPath], {
            env: { ...process.env, OPENAI_API_KEY: args.openaiApiKey },
            stdio: ["pipe", "pipe", "pipe"],
        });
        const payload = JSON.stringify({
            pdf_path: args.pdfPath,
            columns: args.columns,
            phase: args.phase || 1
        });
        py.stdin.write(payload);
        py.stdin.end();
        let stdout = "";
        let stderr = "";
        py.stdout.on("data", (d) => (stdout += d.toString()));
        py.stderr.on("data", (d) => (stderr += d.toString()));
        py.on("close", (code) => {
            if (code !== 0) {
                return reject(new Error(`Python exited with code ${code}: ${stderr}`));
            }
            try {
                const data = JSON.parse(stdout || "{}");
                return resolve(data);
            }
            catch (e) {
                return reject(new Error(`Invalid JSON from Python: ${e}\nOutput: ${stdout}\nErr: ${stderr}`));
            }
        });
    });
}
