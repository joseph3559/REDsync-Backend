/**
 * Spectral Service AG COA Extraction Test
 * 
 * This test validates the extraction of phospholipid data from Spectral Service AG
 * documents, specifically handling malformed tables where Weight-% values are packed
 * into a single multi-line cell.
 * 
 * Critical Issue Fixed: BA001750 - M20253405 - PL.pdf
 * - Before fix: Only PL value was extracted, all other phospholipids showed "-"
 * - After fix: All phospholipid values (PC, PE, PI, PA, LPC, PL) are correctly extracted
 * 
 * This test ensures the fix remains stable and prevents regression.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

describe('Spectral Service AG COA Extraction', () => {
  const testPdfPath = path.join(__dirname, '../../docs/BA001750 - M20253405 - PL.pdf');
  const pythonScript = path.join(__dirname, '../src/python/parse_coa_pdf.py');
  
  it('should extract all phospholipid values from malformed Spectral table', () => {
    // Skip if test PDF doesn't exist
    if (!fs.existsSync(testPdfPath)) {
      console.warn('Test PDF not found, skipping test');
      return;
    }
    
    const payload = {
      pdf_path: testPdfPath,
      columns: [
        "Sample #", "Batch", "AI", "AV", "POV", "Color Gardner (10% dil.)", 
        "Viscosity at 25°C", "Hexane Insolubles", "Toluene Insolubles", "Moisture",
        "Lead", "Mercury", "Arsenic", "Iron (Fe)", "Enterobacteriaceae", 
        "Total Plate Count", "Yeasts & Molds", "Yeasts", "Moulds", 
        "Salmonella (in 25g)", "Salmonella (in 250g)", "E. coli", 
        "Listeria monocytogenes (in 25g)", "Coliforms (in 1g)", "Bacillus cereus",
        "MOH (MOSH/MOAH)", "Soy Allergen", "Cronobacter spp.", 
        "PC", "PE", "LPC", "PA", "PI", "P", "PL",
        "PAH4", "Ochratoxin A", "Pesticides", "Heavy Metals", "Peanut content",
        "Sum Dioxins (WHO-PCDD/F-TEQ)", 
        "Sum Dioxins and Dioxin Like PCB's (WHOPCDD/F-PCBTEQ)",
        "Sum PCB28, PCB52, PCB101, PCB138,PCB153 and PCB180",
        "PCR, 50 cycl. (GMO), 35S/NOS/FMV"
      ],
      phase: 1
    };
    
    // Execute Python script
    const result = execSync(
      `echo '${JSON.stringify(payload)}' | python3 ${pythonScript}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    
    const extracted = JSON.parse(result);
    
    // Validate extracted data
    expect(extracted.sample_id).toBe('M20253405');
    expect(extracted.batch_id).toBe('BA001750');
    expect(extracted.document_type).toBe('Spectral Service AG');
    
    // CRITICAL: Validate all phospholipid values are extracted (not "-" or missing)
    expect(extracted.PC).toBe('25.18');  // Phosphatidylcholine
    expect(extracted.PE).toBe('10.32');  // Phosphatidylethanolamine
    expect(extracted.PI).toBe('21.69');  // Phosphatidylinositol
    expect(extracted.PA).toBe('3.50');   // Phosphatidic Acid
    expect(extracted.LPC).toBe('1.15');  // Lysophosphatidylcholine (calculated from 1-LPC + 2-LPC)
    expect(extracted.PL).toBe('67.41');  // Total Phospholipids
    
    console.log('✓ All phospholipid values extracted correctly');
    console.log('✓ Spectral Service AG malformed table handling verified');
  });
  
  it('should handle LPC calculation with proper precision', () => {
    if (!fs.existsSync(testPdfPath)) {
      console.warn('Test PDF not found, skipping test');
      return;
    }
    
    const payload = {
      pdf_path: testPdfPath,
      columns: ["PC", "PE", "LPC", "PA", "PI", "P", "PL"],
      phase: 1
    };
    
    const result = execSync(
      `echo '${JSON.stringify(payload)}' | python3 ${pythonScript}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    
    const extracted = JSON.parse(result);
    
    // LPC should be 1.15 (0.10 + 1.05), not 1.1500000000000001
    expect(extracted.LPC).toBe('1.15');
    expect(extracted.LPC).not.toContain('0000000');
    
    console.log('✓ LPC calculation precision verified');
  });
});

