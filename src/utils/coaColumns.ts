import path from "path";
import fs from "fs";
import xlsx from "xlsx";
import { getPhase1Columns, getPhase2Columns, getAllActiveColumns, type ColumnConfig } from "./headerConfig.js";

let cachedColumns: string[] | null = null;
let cachedPhase1Columns: string[] | null = null;
let cachedPhase2Columns: string[] | null = null;

export async function getCoaColumns(): Promise<string[]> {
  if (cachedColumns) return cachedColumns;
  
  // Read exact headers from Excel file to ensure perfect match
  cachedColumns = await getCoaColumnsFromExcel();
  return cachedColumns;
}

export async function getPhase1CoaColumns(): Promise<string[]> {
  if (cachedPhase1Columns) return cachedPhase1Columns;
  
  // For phase 1, return exact Excel headers to preserve structure
  cachedPhase1Columns = await getCoaColumnsFromExcel();
  return cachedPhase1Columns;
}

export async function getPhase2CoaColumns(): Promise<string[]> {
  if (cachedPhase2Columns) return cachedPhase2Columns;
  
  const phase2Columns = getPhase2Columns();
  cachedPhase2Columns = phase2Columns.map(col => col.name);
  return cachedPhase2Columns;
}

export async function getCoaColumnsWithConfig(): Promise<ColumnConfig[]> {
  return getAllActiveColumns();
}

export async function getPhase1ColumnsWithConfig(): Promise<ColumnConfig[]> {
  return getPhase1Columns();
}

// Function that reads exact headers from Excel file including blank columns
// Falls back to predefined headers if Excel file is not available
export async function getCoaColumnsFromExcel(): Promise<string[]> {
  const excelPath = path.resolve("/home/scott/Desktop/Office/red/docs/coa database files/COA Database.xlsm");
  
  // Try to read from Excel file first
  if (fs.existsSync(excelPath)) {
    try {
      const wb = xlsx.readFile(excelPath, { bookVBA: true });
      // Choose the sheet that likely contains the database (prefer a sheet named 'Database' or similar)
      const preferredSheet = wb.SheetNames.find((n) => /database|coa/i.test(n)) || wb.SheetNames[0];
      const ws = wb.Sheets[preferredSheet];
      const ref = ws["!ref"] as string;
      if (!ref) throw new Error("Worksheet has no range");
      const range = xlsx.utils.decode_range(ref);

      // Headers are in row 3 (index 2) based on the Excel file structure
      const headerRowIndex = range.s.r + 2;

      // Read ALL columns from the header row, including blank ones
      const headers: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = xlsx.utils.encode_cell({ r: headerRowIndex, c });
        const cell = ws[addr];
        // Preserve exact header including empty strings for blank columns
        const header = cell?.v !== undefined ? String(cell.v) : "";
        headers.push(header);
      }

      // Do NOT de-duplicate or filter - preserve exact structure including blanks
      return headers;
    } catch (error) {
      console.warn(`Failed to read Excel file at ${excelPath}, falling back to predefined headers:`, error);
    }
  } else {
    console.warn(`COA reference file not found at ${excelPath}, using predefined headers`);
  }
  
  // Fallback to predefined headers from headerConfig
  return getPhase1Columns().map(col => col.name);
}


