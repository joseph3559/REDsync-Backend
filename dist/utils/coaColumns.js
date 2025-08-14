import path from "path";
import fs from "fs";
import xlsx from "xlsx";
import { getPhase1Columns, getPhase2Columns, getAllActiveColumns } from "./headerConfig.js";
let cachedColumns = null;
let cachedPhase1Columns = null;
let cachedPhase2Columns = null;
export async function getCoaColumns() {
    if (cachedColumns)
        return cachedColumns;
    // Read exact headers from Excel file to ensure perfect match
    cachedColumns = await getCoaColumnsFromExcel();
    return cachedColumns;
}
export async function getPhase1CoaColumns() {
    if (cachedPhase1Columns)
        return cachedPhase1Columns;
    // For phase 1, return exact Excel headers to preserve structure
    cachedPhase1Columns = await getCoaColumnsFromExcel();
    return cachedPhase1Columns;
}
export async function getPhase2CoaColumns() {
    if (cachedPhase2Columns)
        return cachedPhase2Columns;
    const phase2Columns = getPhase2Columns();
    cachedPhase2Columns = phase2Columns.map(col => col.name);
    return cachedPhase2Columns;
}
export async function getCoaColumnsWithConfig() {
    return getAllActiveColumns();
}
export async function getPhase1ColumnsWithConfig() {
    return getPhase1Columns();
}
// Function that reads exact headers from Excel file including blank columns
export async function getCoaColumnsFromExcel() {
    const excelPath = path.resolve("/home/scott/Desktop/Office/red/docs/coa database files/COA Database.xlsm");
    if (!fs.existsSync(excelPath)) {
        throw new Error(`COA reference file not found at ${excelPath}`);
    }
    const wb = xlsx.readFile(excelPath, { bookVBA: true });
    // Choose the sheet that likely contains the database (prefer a sheet named 'Database' or similar)
    const preferredSheet = wb.SheetNames.find((n) => /database|coa/i.test(n)) || wb.SheetNames[0];
    const ws = wb.Sheets[preferredSheet];
    const ref = ws["!ref"];
    if (!ref)
        throw new Error("Worksheet has no range");
    const range = xlsx.utils.decode_range(ref);
    // Headers are in row 3 (index 2) based on the Excel file structure
    const headerRowIndex = range.s.r + 2;
    // Read ALL columns from the header row, including blank ones
    const headers = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = xlsx.utils.encode_cell({ r: headerRowIndex, c });
        const cell = ws[addr];
        // Preserve exact header including empty strings for blank columns
        const header = cell?.v !== undefined ? String(cell.v) : "";
        headers.push(header);
    }
    // Do NOT de-duplicate or filter - preserve exact structure including blanks
    return headers;
}
