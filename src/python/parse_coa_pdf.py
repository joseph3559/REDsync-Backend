#!/usr/bin/env python3
import sys
import json
import os
import re
from typing import Optional

# Optional heavy deps are imported lazily to speed cold starts
def extract_text_from_pdf(path: str) -> str:
    try:
        import pdfplumber  # type: ignore
    except Exception:
        pdfplumber = None

    if pdfplumber is not None:
        try:
            text_parts = []
            with pdfplumber.open(path) as pdf:
                for page in pdf.pages:
                    text_parts.append(page.extract_text() or "")
            return "\n".join(text_parts)
        except Exception:
            pass

    # Fallback to pdfminer.six
    try:
        from pdfminer.high_level import extract_text  # type: ignore
        return extract_text(path) or ""
    except Exception:
        return ""


def extract_text_with_ocr(path: str) -> str:
    """Extract text from scanned PDF using OCR."""
    try:
        import fitz  # PyMuPDF
        import pytesseract
        from PIL import Image, ImageEnhance, ImageFilter
        import io
        
        print(f"Attempting OCR extraction for scanned PDF: {path}", file=sys.stderr)
        
        doc = fitz.open(path)
        text_parts = []
        
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            
            # Convert page to image with higher resolution for better OCR
            pix = page.get_pixmap(matrix=fitz.Matrix(3, 3))  # 3x zoom for better quality
            img_data = pix.tobytes("png")
            
            # Convert to PIL Image and enhance for better OCR
            image = Image.open(io.BytesIO(img_data))
            
            # Enhance image quality for better OCR
            image = image.convert('L')  # Convert to grayscale
            enhancer = ImageEnhance.Contrast(image)
            image = enhancer.enhance(2.0)  # Increase contrast
            image = image.filter(ImageFilter.SHARPEN)  # Sharpen image
            
            # Try multiple OCR configurations
            ocr_configs = [
                '--psm 6',  # Uniform block of text
                '--psm 4',  # Single column of text
                '--psm 11', # Sparse text
                '--psm 12', # Sparse text with OSD
            ]
            
            best_text = ""
            best_length = 0
            
            for config in ocr_configs:
                try:
                    page_text = pytesseract.image_to_string(image, config=config)
                    if len(page_text) > best_length:
                        best_text = page_text
                        best_length = len(page_text)
                except Exception:
                    continue
            
            if best_text:
                text_parts.append(best_text)
                print(f"OCR extracted {len(best_text)} characters from page {page_num + 1}", file=sys.stderr)
            else:
                print(f"OCR failed for page {page_num + 1}", file=sys.stderr)
        
        doc.close()
        full_text = "\n".join(text_parts)
        print(f"OCR extraction completed: {len(full_text)} total characters", file=sys.stderr)
        return full_text
        
    except ImportError as e:
        print(f"OCR dependencies not available: {e}", file=sys.stderr)
        print("To enable OCR, install: pip install PyMuPDF pytesseract pillow", file=sys.stderr)
        return ""
    except Exception as e:
        print(f"OCR extraction failed: {e}", file=sys.stderr)
        return ""


def extract_spectral_table_data(path: str) -> dict:
    """Extract structured table data specifically for Spectral Service AG documents.
    
    CRITICAL: Spectral Service AG documents may have malformed table structures where
    the Weight-% column contains all values in a single multi-line cell instead of
    individual cells per row. This function handles both:
    
    1. Well-formed tables: Each parameter has its own Weight-% value in a separate cell
    2. Malformed tables: All Weight-% values are packed into one multi-line cell
    
    For malformed tables, we:
    - Detect the multi-line Weight-% cell by checking for '\n' and multiple numeric values
    - Split the cell into individual values
    - Match values to parameters by their row position
    - Handle Sum and Phosphorus rows separately as they may have their own cells
    
    This ensures complete extraction of phospholipid data (PC, PE, PI, PA, LPC, PL, P)
    regardless of the PDF table structure.
    """
    try:
        import pdfplumber  # type: ignore
    except Exception:
        return {}

    try:
        with pdfplumber.open(path) as pdf:
            for page_num, page in enumerate(pdf.pages):
                print(f"Processing page {page_num + 1}", file=sys.stderr)
                
                # Try table extraction
                tables = page.extract_tables()
                print(f"Found {len(tables)} tables on page {page_num + 1}", file=sys.stderr)
                
                for table_num, table in enumerate(tables):
                    if not table or len(table) < 2:
                        print(f"Table {table_num + 1} is empty or too small", file=sys.stderr)
                        continue
                    
                    print(f"Table {table_num + 1} has {len(table)} rows", file=sys.stderr)
                    print(f"Header row: {table[0]}", file=sys.stderr)
                    
                    # Print all table content for debugging
                    for i, row in enumerate(table[:5]):  # Print first 5 rows for debugging
                        print(f"Row {i}: {row}", file=sys.stderr)
                    
                    # Find Weight-% column index
                    weight_col_idx = None
                    parameter_col_idx = None
                    
                    # Check all rows for Weight-% column, not just header
                    for row_idx, row in enumerate(table):
                        if not row:
                            continue
                        for col_idx, cell in enumerate(row):
                            if cell and ('weight-' in str(cell).lower() and '%' in str(cell).lower()):
                                weight_col_idx = col_idx
                                print(f"Found Weight-% column at row {row_idx}, col {col_idx}: {cell}", file=sys.stderr)
                                break
                        if weight_col_idx is not None:
                            break
                    
                    # Check for parameter/analyte column
                    for row_idx, row in enumerate(table):
                        if not row:
                            continue
                        for col_idx, cell in enumerate(row):
                            if cell and any(param in str(cell).lower() for param in ['analyte', 'component', 'compound']) and col_idx != weight_col_idx:
                                parameter_col_idx = col_idx
                                print(f"Found parameter column at row {row_idx}, col {col_idx}: {cell}", file=sys.stderr)
                                break
                        if parameter_col_idx is not None:
                            break
                    
                    # If we found the Weight-% column, extract data
                    if weight_col_idx is not None:
                        results = {}
                        lpc_components = {}  # To track 1-LPC and 2-LPC for summation
                        
                        print(f"Extracting data from table {table_num + 1}", file=sys.stderr)
                        
                        # CRITICAL FIX FOR MALFORMED SPECTRAL SERVICE AG TABLES (Issue: BA001750 - M20253405 - PL.pdf)
                        # ==================================================================================
                        # Problem: Some Spectral PDFs have all Weight-% values packed into ONE multi-line cell
                        # instead of individual cells per parameter row. This causes missing data extraction.
                        # 
                        # Example malformed structure:
                        #   Row 3: Weight-% cell = "25.18\n0.10\n1.05\n21.69\n0.57\n10.32\n..."
                        #   Row 4: PC cell has empty Weight-% value
                        #   Row 5: 1-LPC cell has empty Weight-% value
                        #   ...etc
                        #
                        # Solution: Detect multi-line cell, split values, match by row position
                        # ==================================================================================
                        
                        weight_values_list = None
                        for row_num, row in enumerate(table):
                            if not row or len(row) <= weight_col_idx:
                                continue
                            weight_cell = str(row[weight_col_idx] or "").strip()
                            # Check if this cell contains multiple lines with numeric values
                            if '\n' in weight_cell:
                                lines = weight_cell.split('\n')
                                numeric_lines = [line.strip() for line in lines if line.strip() and re.search(r'\d+[.,]?\d*', line.strip())]
                                if len(numeric_lines) >= 5:  # Multiple values indicate this is the multi-value cell
                                    weight_values_list = numeric_lines
                                    print(f"Found multi-line Weight-% cell at row {row_num}: {len(numeric_lines)} values", file=sys.stderr)
                                    print(f"Values: {numeric_lines[:10]}", file=sys.stderr)  # Print first 10 for debugging
                                    break
                        
                        # Build parameter list from table
                        # Note: Sum and Phosphorus rows often have their own separate cell values
                        # (not part of the multi-line cell), so we handle them separately
                        parameters_list = []
                        sum_row_data = None  # Track Sum row separately (for PL total)
                        phosphorus_row_data = None  # Track Phosphorus row separately (for P total)
                        
                        for row_num, row in enumerate(table[1:], 1):  # Skip header
                            if not row or len(row) <= max(weight_col_idx, parameter_col_idx or 0):
                                continue
                            parameter = str(row[parameter_col_idx] if parameter_col_idx is not None else row[0] or "").strip()
                            
                            # Check for Sum and Phosphorus rows which may have their own values
                            # These are typically calculated totals shown in separate cells
                            # CRITICAL: Sum row may contain BOTH PL and P values in format "67.41\n2.72"
                            if parameter.lower() == 'sum' or 'total' in parameter.lower():
                                weight_cell = str(row[weight_col_idx] or "").strip()
                                if weight_cell and '\n' in weight_cell:
                                    # Extract numbers from multi-line value
                                    # Line 1 = PL (Sum), Line 2 = P (Phosphorus)
                                    lines = weight_cell.split('\n')
                                    numeric_lines = []
                                    for line in lines:
                                        if re.search(r'\d+[.,]?\d*', line.strip()):
                                            numeric_lines.append(line.strip())
                                    
                                    if len(numeric_lines) >= 1:
                                        sum_row_data = (row_num, parameter, numeric_lines[0])
                                        print(f"Found Sum row (PL) with value: {numeric_lines[0]}", file=sys.stderr)
                                    
                                    # Check if there's a second value (Phosphorus)
                                    if len(numeric_lines) >= 2:
                                        phosphorus_row_data = (row_num, 'Phosphorus', numeric_lines[1])
                                        print(f"Found Phosphorus (P) in Sum row with value: {numeric_lines[1]}", file=sys.stderr)
                                elif weight_cell and re.search(r'\d+[.,]?\d*', weight_cell):
                                    sum_row_data = (row_num, parameter, weight_cell)
                                    print(f"Found Sum row with value: {weight_cell}", file=sys.stderr)
                                continue  # Don't add to parameters_list
                            
                            if parameter.lower() == 'phosphorus' or parameter.lower() == 'p':
                                weight_cell = str(row[weight_col_idx] or "").strip()
                                if weight_cell and re.search(r'\d+[.,]?\d*', weight_cell):
                                    phosphorus_row_data = (row_num, parameter, weight_cell)
                                    print(f"Found Phosphorus row with value: {weight_cell}", file=sys.stderr)
                                # Still add to parameters_list in case it's part of the multi-value cell
                            
                            if parameter and parameter.lower() not in ['internal standard', 'test item', 'phospholipid']:
                                parameters_list.append((row_num, parameter))
                        
                        print(f"Found {len(parameters_list)} parameters: {[p[1] for p in parameters_list]}", file=sys.stderr)
                        
                        # If we have multi-line values, match them to parameters by position
                        if weight_values_list and len(weight_values_list) >= 5:  # At least 5 values indicates multi-value extraction
                            print(f"Matching {len(parameters_list)} parameters to {len(weight_values_list)} weight values", file=sys.stderr)
                            for idx, (row_num, parameter) in enumerate(parameters_list):
                                if idx < len(weight_values_list):
                                    weight_value = weight_values_list[idx]
                                    print(f"Matched row {row_num}: parameter='{parameter}' -> weight='{weight_value}'", file=sys.stderr)
                                    
                                    # Clean and validate weight value
                                    try:
                                        weight_clean = clean_coa_value(weight_value, parameter)
                                        weight_float = float(weight_clean.replace(',', '.'))
                                        print(f"Parsed weight: {weight_float} (cleaned from '{weight_value}')", file=sys.stderr)
                                    except (ValueError, TypeError):
                                        print(f"Could not parse weight value: '{weight_value}'", file=sys.stderr)
                                        continue
                                    
                                    # Map specific parameters
                                    param_lower = parameter.lower().strip()
                                    
                                    if param_lower == 'pc' or 'phosphatidylcholine' in param_lower:
                                        results['PC'] = weight_clean
                                        print(f"Found PC: {weight_clean}", file=sys.stderr)
                                    elif param_lower == 'pe' or 'phosphatidylethanolamine' in param_lower:
                                        results['PE'] = weight_clean
                                        print(f"Found PE: {weight_clean}", file=sys.stderr)
                                    elif param_lower == 'pi' or 'phosphatidylinositol' in param_lower:
                                        results['PI'] = weight_clean
                                        print(f"Found PI: {weight_clean}", file=sys.stderr)
                                    elif param_lower == 'pa' or 'phosphatidic acid' in param_lower:
                                        results['PA'] = weight_clean
                                        print(f"Found PA: {weight_clean}", file=sys.stderr)
                                    elif param_lower == 'p' or param_lower == 'phosphorus':
                                        results['P'] = weight_clean
                                        print(f"Found P: {weight_clean}", file=sys.stderr)
                                    elif '1-lpc' in param_lower or 'lysopc(16:0)' in param_lower:
                                        lpc_components['1-LPC'] = weight_float
                                        print(f"Found 1-LPC: {weight_float}", file=sys.stderr)
                                    elif '2-lpc' in param_lower or 'lysopc(18:' in param_lower:
                                        lpc_components['2-LPC'] = weight_float
                                        print(f"Found 2-LPC: {weight_float}", file=sys.stderr)
                                    elif param_lower == 'sum' or 'total' in param_lower:
                                        results['PL'] = weight_clean
                                        print(f"Found PL (Sum): {weight_clean}", file=sys.stderr)
                            
                            # Process Sum row separately if found
                            if sum_row_data:
                                row_num, parameter, weight_value = sum_row_data
                                try:
                                    weight_clean = clean_coa_value(weight_value, parameter)
                                    weight_float = float(weight_clean.replace(',', '.'))
                                    results['PL'] = weight_clean
                                    print(f"Added PL from Sum row: {weight_clean}", file=sys.stderr)
                                except (ValueError, TypeError):
                                    print(f"Could not parse Sum weight value: '{weight_value}'", file=sys.stderr)
                            
                            # Process Phosphorus row separately if found
                            if phosphorus_row_data:
                                row_num, parameter, weight_value = phosphorus_row_data
                                try:
                                    weight_clean = clean_coa_value(weight_value, parameter)
                                    weight_float = float(weight_clean.replace(',', '.'))
                                    results['P'] = weight_clean
                                    print(f"Added P from Phosphorus row: {weight_clean}", file=sys.stderr)
                                except (ValueError, TypeError):
                                    print(f"Could not parse Phosphorus weight value: '{weight_value}'", file=sys.stderr)
                        else:
                            # Original extraction logic for well-formed tables
                            for row_num, row in enumerate(table[1:], 1):  # Skip header
                                if not row or len(row) <= max(weight_col_idx, parameter_col_idx or 0):
                                    continue
                                
                                parameter = str(row[parameter_col_idx] if parameter_col_idx is not None else row[0] or "").strip()
                                weight_value = str(row[weight_col_idx] or "").strip()
                                
                                print(f"Row {row_num}: parameter='{parameter}', weight='{weight_value}'", file=sys.stderr)
                                
                                if not parameter or not weight_value:
                                    continue
                                
                                # Clean and validate weight value using standard cleaning function
                                try:
                                    weight_clean = clean_coa_value(weight_value, parameter)
                                    weight_float = float(weight_clean.replace(',', '.'))
                                    print(f"Parsed weight: {weight_float} (cleaned from '{weight_value}')", file=sys.stderr)
                                except (ValueError, TypeError):
                                    print(f"Could not parse weight value: '{weight_value}'", file=sys.stderr)
                                    continue
                                
                                # Map specific parameters
                                param_lower = parameter.lower().strip()
                                
                                if param_lower == 'pc' or 'phosphatidylcholine' in param_lower:
                                    results['PC'] = weight_clean
                                    print(f"Found PC: {weight_clean}", file=sys.stderr)
                                elif param_lower == 'pe' or 'phosphatidylethanolamine' in param_lower:
                                    results['PE'] = weight_clean
                                    print(f"Found PE: {weight_clean}", file=sys.stderr)
                                elif param_lower == 'pi' or 'phosphatidylinositol' in param_lower:
                                    results['PI'] = weight_clean
                                    print(f"Found PI: {weight_clean}", file=sys.stderr)
                                elif param_lower == 'pa' or 'phosphatidic acid' in param_lower:
                                    results['PA'] = weight_clean
                                    print(f"Found PA: {weight_clean}", file=sys.stderr)
                                elif param_lower == 'p' or param_lower == 'phosphorus':
                                    results['P'] = weight_clean
                                    print(f"Found P: {weight_clean}", file=sys.stderr)
                                elif '1-lpc' in param_lower or 'lysopc(16:0)' in param_lower:
                                    lpc_components['1-LPC'] = weight_float
                                    print(f"Found 1-LPC: {weight_float}", file=sys.stderr)
                                elif '2-lpc' in param_lower or 'lysopc(18:' in param_lower:
                                    lpc_components['2-LPC'] = weight_float
                                    print(f"Found 2-LPC: {weight_float}", file=sys.stderr)
                                elif param_lower == 'sum' or 'total' in param_lower:
                                    results['PL'] = weight_clean
                                    print(f"Found PL (Sum): {weight_clean}", file=sys.stderr)
                        
                        # Calculate LPC as sum of 1-LPC and 2-LPC
                        if '1-LPC' in lpc_components and '2-LPC' in lpc_components:
                            lpc_sum = lpc_components['1-LPC'] + lpc_components['2-LPC']
                            # Round to 2 decimal places to avoid floating-point precision issues
                            lpc_sum_rounded = round(lpc_sum, 2)
                            results['LPC'] = str(lpc_sum_rounded)
                            print(f"Calculated LPC: {lpc_sum_rounded} (1-LPC: {lpc_components['1-LPC']} + 2-LPC: {lpc_components['2-LPC']})", file=sys.stderr)
                        elif '1-LPC' in lpc_components:
                            results['LPC'] = str(round(lpc_components['1-LPC'], 2))
                            print(f"Using 1-LPC only: {lpc_components['1-LPC']}", file=sys.stderr)
                        elif '2-LPC' in lpc_components:
                            results['LPC'] = str(round(lpc_components['2-LPC'], 2))
                            print(f"Using 2-LPC only: {lpc_components['2-LPC']}", file=sys.stderr)
                        
                        print(f"Final results from table {table_num + 1}: {results}", file=sys.stderr)
                        if results:
                            return results
                
                # If table extraction fails, try text-based extraction
                text = page.extract_text() or ""
                if 'weight-%' in text.lower():
                    print("Attempting text-based extraction for Spectral data", file=sys.stderr)
                    results = extract_spectral_from_text(text)
                    if results:
                        print(f"Text-based extraction results: {results}", file=sys.stderr)
                        return results
                            
    except Exception as e:
        print(f"Error extracting Spectral table data: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {}
    
    return {}


def extract_spectral_from_text(text: str) -> dict:
    """Fallback: Extract Spectral data from raw text when table extraction fails."""
    results = {}
    lpc_components = {}
    
    # Split text into lines for analysis
    lines = text.split('\n')
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        # Look for patterns like "PC 14.41" or "PC: 14.41" or rows with Weight-%
        for param in ['PC', 'PE', 'PI', 'PA', 'P']:
            pattern = rf'\b{param}\b.*?(\d+\.?\d*)\s*%?'
            match = re.search(pattern, line, re.IGNORECASE)
            if match:
                try:
                    raw_value = match.group(1)
                    cleaned_value = clean_coa_value(raw_value, param)
                    results[param] = cleaned_value
                    print(f"Text extraction found {param}: {cleaned_value} (from '{raw_value}')", file=sys.stderr)
                except ValueError:
                    continue
        
        # Look for LPC components
        if '1-lpc' in line.lower() or 'lysopc(16:0)' in line.lower():
            match = re.search(r'(\d+\.?\d*)\s*%?', line)
            if match:
                try:
                    raw_value = match.group(1)
                    cleaned_value = clean_coa_value(raw_value, "1-LPC")
                    lpc_components['1-LPC'] = float(cleaned_value.replace(',', '.'))
                    print(f"Text extraction found 1-LPC: {lpc_components['1-LPC']} (from '{raw_value}')", file=sys.stderr)
                except ValueError:
                    continue
        
        if '2-lpc' in line.lower() or 'lysopc(18:' in line.lower():
            match = re.search(r'(\d+\.?\d*)\s*%?', line)
            if match:
                try:
                    raw_value = match.group(1)
                    cleaned_value = clean_coa_value(raw_value, "2-LPC")
                    lpc_components['2-LPC'] = float(cleaned_value.replace(',', '.'))
                    print(f"Text extraction found 2-LPC: {lpc_components['2-LPC']} (from '{raw_value}')", file=sys.stderr)
                except ValueError:
                    continue
        
        # Look for Sum/Total for PL
        if ('sum' in line.lower() or 'total' in line.lower()) and 'weight' in line.lower():
            match = re.search(r'(\d+\.?\d*)\s*%?', line)
            if match:
                try:
                    raw_value = match.group(1)
                    cleaned_value = clean_coa_value(raw_value, "PL")
                    results['PL'] = cleaned_value
                    print(f"Text extraction found PL: {cleaned_value} (from '{raw_value}')", file=sys.stderr)
                except ValueError:
                    continue
    
    # Calculate LPC
    if '1-LPC' in lpc_components and '2-LPC' in lpc_components:
        lpc_sum = lpc_components['1-LPC'] + lpc_components['2-LPC']
        results['LPC'] = str(lpc_sum)
        print(f"Text extraction calculated LPC: {lpc_sum}", file=sys.stderr)
    elif '1-LPC' in lpc_components:
        results['LPC'] = str(lpc_components['1-LPC'])
    elif '2-LPC' in lpc_components:
        results['LPC'] = str(lpc_components['2-LPC'])
    
    return results


def detect_spectral_service_ag(text: str) -> bool:
    """Detect if this is a Spectral Service AG document."""
    spectral_indicators = [
        "spectral service ag",
        "spectral service",
        "spectral ag",
        "weight-%"
    ]
    text_lower = text.lower()
    return any(indicator in text_lower for indicator in spectral_indicators)


def find_ids(text: str) -> dict:
    sample_id = None
    batch_id = None
    
    # Priority 1: Extract from "Sample description" field (more reliable)
    sample_desc_match = re.search(r"Sample\s+description:\s*([^\n\r]*)", text, flags=re.IGNORECASE)
    if sample_desc_match:
        desc_text = sample_desc_match.group(1)
        # Look for M followed by 8 digits with optional decimal extension (e.g., M20251714.1)
        sample_in_desc = re.search(r"\bM\s*\d{8}(?:\.\d+)?\b", desc_text)
        if sample_in_desc:
            sample_id = sample_in_desc.group(0).replace(' ', '')  # Remove any spaces
            print(f"Sample ID extracted from description: '{sample_id}' from '{desc_text.strip()}'", file=sys.stderr)
    
    # Priority 2: Check "Sample No:" field
    if not sample_id:
        sample_no_match = re.search(r"Sample\s+No:\s*([^\n\r]*)", text, flags=re.IGNORECASE)
        if sample_no_match:
            sample_no_text = sample_no_match.group(1)
            # Look for M followed by 8 digits with optional decimal extension (e.g., M20251714.2)
            sample_in_no = re.search(r"\bM\s*\d{8}(?:\.\d+)?\b", sample_no_text)
            if sample_in_no:
                sample_id = sample_in_no.group(0).replace(' ', '')  # Remove any spaces
                print(f"Sample ID extracted from 'Sample No': '{sample_id}' from '{sample_no_text.strip()}'", file=sys.stderr)
    
    # Priority 3: If not found in specific fields, search entire text
    if not sample_id:
        # Look for M followed by optional space and 8 digits with optional decimal extension
        sample_match = re.search(r"\bM\s*\d{8}(?:\.\d+)?\b", text)
        if sample_match:
            sample_id = sample_match.group(0).replace(' ', '')  # Remove any spaces
            print(f"Sample ID extracted from general text: '{sample_id}'", file=sys.stderr)
    
    # Extract batch ID - support both BA and CS formats
    batch_patterns = [
        r"\b(BA\d{6})\b",              # BA001256 format
        r"\b(CS\d{2}-\d{2}-\d{4})\b"   # CS30-00-1195 format
    ]
    
    for pattern in batch_patterns:
        batch_match = re.search(pattern, text)
        if batch_match:
            batch_id = batch_match.group(1)
            break
    
    return {
        "sample_id": sample_id,
        "batch_id": batch_id,
    }


OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

# Parameter definitions for better AI understanding
PARAMETER_DEFINITIONS = {
    'AI': 'Acetone Insoluble - acetone insoluble matter content (%)',
    'AV': 'Acid Value - acid value measurement (mg KOH/g)', 
    'POV': 'Peroxide Value - peroxide value measurement (meq O2/kg)',
    'PC': 'Phosphatidylcholine - phosphatidylcholine content (%)',
    'PE': 'Phosphatidylethanolamine - phosphatidylethanolamine content (%)',
    'LPC': 'Lysophosphatidylcholine - lysophosphatidylcholine content (%)',
    'PA': 'Phosphatidic Acid - phosphatidic acid content (%)',
    'PI': 'Phosphatidylinositol - phosphatidylinositol content (%)',
    'P': 'Phosphorus - total phosphorus content (%)',
    'PL': 'Phospholipids - total phospholipids content (%)',
    'Iron (Fe)': 'Iron content (ppm)',
    'Lead': 'Lead content (ppm)',
    'Arsenic': 'Arsenic content (ppm)', 
    'Mercury': 'Mercury content (ppm)',
    'Total Plate Count': 'Total Plate Count (CFU/g)',
    'Total Viable count': 'Total Viable Count (CFU/g)',
    'Yeasts & Molds': 'Yeasts and Molds count (CFU/g)',
    'E. coli': 'E. coli presence/count',
    'Salmonella (in 25g)': 'Salmonella presence in 25g sample',
    'PCR, 50 cycl. (GMO), 35S/NOS/FMV': 'GMO detection by PCR (positive/negative)',
    'Listeria monocytogenes (in 25g)': 'Listeria monocytogenes presence in 25g sample',
    'Moisture': 'Moisture content (%)',
    'Color Gardner (As is)': 'Gardner Color as is',
    'Color Gardner (10% dil.)': 'Gardner Color at 10% dilution',
    'Color Iodine': 'Iodine Color value',
    'Viscosity at 25°C': 'Viscosity at 25°C (cP)',
    'Toluene Insolubles': 'Toluene insolubles content (%)',
    'Hexane Insolubles': 'Hexane insolubles content (%)',
    'Pesticides': 'Pesticide residues (ppm)',
    'Heavy Metals': 'Heavy metals content (ppm)',
    'PAH4': 'PAH4 (Polycyclic Aromatic Hydrocarbons) (μg/kg)',
    'Ochratoxin A': 'Ochratoxin A content (μg/kg)',
    'Peanut content': 'Peanut allergen content (ppm)'
}


def map_to_available_key(candidates: list[str], available: list[str]) -> Optional[str]:
    """Return the first candidate that exists in available column names."""
    for cand in candidates:
        for col in available:
            if col.strip().lower() == cand.strip().lower():
                return col
    return None


def clean_coa_value(value: str, parameter_name: str = "") -> str:
    """Clean COA values by removing units and standardizing format.
    
    Transformations:
    - "19,3 mg KOH/g" -> "19.3"
    - "65,3 %" -> "65.3" 
    - "Less than 0,5 meq" -> "0.5"
    - "Less than 300 cP" -> "300"
    - "4183 cP" -> "4183"
    - "Less than 0,01 %" -> "0.00" (special case for small percentages)
    - "0,19 % (w/w)" -> "0.19"
    - "660 cfu/g" -> "660"
    - "Not detected per 25" -> "negative"
    - "less than 10" -> "10"
    - "Pb) (7439-92-1) Less than 0,02 mg/kg" -> "0.02"
    - "Not detected µg/kg" -> "negative"
    
    Special cases:
    - Viscosity at 25°C: divide by 1000 (4183 cP -> 4.183, 300 cP -> 0.3)
    """
    if not value:
        return value
    
    value = str(value).strip()
    original_value = value
    parameter_lower = parameter_name.lower() if parameter_name else ""
    
    # First, handle spaced-out characters (e.g., "d e t e c t e d" -> "detected")
    # Strategy: remove spaces from sequences where each "word" is a single character
    normalized_value = value
    # Match sequences of single chars separated by spaces: "a b c d" -> "abcd"
    normalized_value = re.sub(r'\b(\w)(\s+\w)+\b', lambda m: m.group(0).replace(' ', ''), normalized_value)
    
    # Handle "Not detected" cases - convert to "negative"
    # Use normalized value for pattern matching
    if re.search(r"(?i)\b(not\s*detected|nd)\b", normalized_value):
        return "negative"
    
    # Handle "Less than" cases
    less_than_match = re.search(r"(?i)less\s+than\s+(\d+(?:[,\.]\d+)?)", value)
    if less_than_match:
        numeric_part = less_than_match.group(1).replace(',', '.')
        # Special case: "Less than 0,01 %" should show 0,00
        if '%' in value and float(numeric_part) <= 0.01:
            return "0.00"
        
        # Special handling for Viscosity at 25°C - divide by 1000 AFTER less than extraction
        if "viscosity" in parameter_lower and "25" in parameter_lower:
            try:
                viscosity_float = float(numeric_part)
                viscosity_converted = viscosity_float / 1000
                print(f"Viscosity conversion (Less than): '{original_value}' -> '{viscosity_converted}' (divided by 1000)", file=sys.stderr)
                return str(viscosity_converted)
            except (ValueError, TypeError):
                print(f"Failed to convert viscosity value (Less than): '{numeric_part}'", file=sys.stderr)
        
        return numeric_part
    
    # Check for scientific notation first - if found, preserve it for microbiology processing
    scientific_notation_match = re.search(r"\d+[.,]?\d*E[+-]?\d+", value, re.IGNORECASE)
    if scientific_notation_match:
        # For scientific notation, return the original value so microbiology processing can handle it
        return value
    
    # Extract numeric value with decimal handling
    # Look for patterns like: 19,3  or  65.3  or  4183
    numeric_match = re.search(r"(\d+(?:[,\.]\d+)?)", value)
    if not numeric_match:
        # If no numeric value found, return original
        return value
    
    numeric_part = numeric_match.group(1).replace(',', '.')
    
    # Handle special cases with complex patterns
    # Pattern: "Pb) (7439-92-1) Less than 0,02 mg/kg" - extract the number after "Less than"
    complex_less_than = re.search(r"(?i).*less\s+than\s+(\d+(?:[,\.]\d+)?)", value)
    if complex_less_than:
        return complex_less_than.group(1).replace(',', '.')
    
    # For percentage values less than 0.01, show as 0.00
    if '%' in value and float(numeric_part) < 0.01:
        return "0.00"
    
    # Convert comma decimal separator to dot
    cleaned_value = numeric_part
    
    # Special handling for Viscosity at 25°C - divide by 1000
    # BUT only if the original value contains units (cP, etc.) to avoid double conversion
    if "viscosity" in parameter_lower and "25" in parameter_lower:
        # Only apply conversion if original value has units (cP, etc.) or "less than"
        has_units = bool(re.search(r'\b(cp|centipoise|mpa\.?s|pas)\b', original_value.lower()))
        has_less_than = "less than" in original_value.lower()
        is_plain_number = re.match(r'^\d+(?:[,\.]\d+)?$', original_value.strip())
        
        # Apply conversion only if it has units or "less than", but not if it's a plain number (already converted)
        if (has_units or has_less_than) and not is_plain_number:
            try:
                viscosity_float = float(cleaned_value)
                viscosity_converted = viscosity_float / 1000
                cleaned_value = str(viscosity_converted)
                print(f"Viscosity conversion: '{original_value}' -> '{cleaned_value}' (divided by 1000)", file=sys.stderr)
            except (ValueError, TypeError):
                print(f"Failed to convert viscosity value: '{cleaned_value}'", file=sys.stderr)
        elif is_plain_number:
            print(f"Viscosity: '{original_value}' already appears to be converted, skipping division", file=sys.stderr)
        else:
            print(f"Viscosity: '{original_value}' no units found, treating as plain value", file=sys.stderr)
    else:
        print(f"Cleaned value: '{original_value}' -> '{cleaned_value}'", file=sys.stderr)
    
    return cleaned_value


def extract_parameters_regex(raw_text: str, columns: list[str], pdf_path: str = "") -> dict:
    """Lightweight, deterministic extraction for common parameters and synonyms.
    Only returns keys that exist in provided columns list (exact case preserved).
    """
    text = raw_text
    out: dict[str, str] = {}

    def capture(pattern: str) -> Optional[str]:
        m = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE | re.DOTALL)
        return m.group(1).strip() if m else None

    def extract_scalar(s: str, param_name: str = "") -> str:
        if s is None:
            return s
        return clean_coa_value(s, param_name)

    # AI (Acetone/Aceton insoluble) - Enhanced patterns to prioritize actual values
    ai_val = None
    
    # Pattern 1: Look for direct value patterns like "Aceton Insoluble 30,6 %"
    ai_direct = capture(r"(?:Acetone|Aceton)\s+[Ii]nsoluble\s+(\d+[,\.]\d+\s*%)")
    if ai_direct:
        ai_val = ai_direct
        print(f"AI: Found direct value pattern: '{ai_val}'", file=sys.stderr)
    
    # Pattern 2: Look for percentage values near "Aceton insoluble" (within 100 characters)
    if not ai_val:
        ai_nearby = re.search(r"(?:Acetone|Aceton)\s+[Ii]nsoluble[\s\S]{0,100}?(\d+[,\.]\d+\s*%)", text, flags=re.IGNORECASE)
        if ai_nearby:
            ai_val = ai_nearby.group(1)
            print(f"AI: Found nearby percentage value: '{ai_val}'", file=sys.stderr)
    
    # Pattern 3: Fallback - general pattern but filter out method descriptions and accreditation text
    if not ai_val:
        ai_general = capture(r"(?:Acetone|Aceton)\s+[Ii]nsoluble\s*([^\n\r]*)")
        if ai_general and not re.search(r"(accredited|accreditation|method|analysis|determination|norm|ISO|AOCS)", ai_general, re.IGNORECASE):
            # Only use if it contains a numeric value
            if re.search(r'\d+[,.]?\d*', ai_general):
                ai_val = ai_general
                print(f"AI: Found general pattern: '{ai_val}'", file=sys.stderr)
    
    if ai_val:
        key = map_to_available_key(["AI", "Acetone Insoluble", "Aceton insoluble"], columns)
        if key:
            out[key] = extract_scalar(ai_val, key)

    # AV (Acid value)
    av_val = capture(r"Acid\s+value\s*([^\n\r]*)")
    if av_val:
        key = map_to_available_key(["AV", "Acid Value"], columns)
        if key:
            out[key] = av_val

    # POV (Peroxide value)
    # Handle multi-line patterns and filter out accreditation references
    pov_val = None
    
    # First, try to find complete peroxide value with units in nearby lines
    pov_multiline = re.search(r"Peroxide\s+value[\s\S]{0,100}?((?:Less\s+than\s+|<\s*)?(?:\d+[,.]?\d*)\s*(?:meq|mg|µg|ug)[\s\S]{0,20}?(?:O2/kg|/kg|/g))", text, flags=re.IGNORECASE)
    if pov_multiline:
        pov_val = pov_multiline.group(1).strip()
        print(f"POV: Found multi-line value with units: '{pov_val}'", file=sys.stderr)
    
    # If no multi-line match, try single line patterns
    if pov_val is None:
        matches = list(re.finditer(r"Peroxide\s+value\s*([^\n\r]*)", text, flags=re.IGNORECASE))
        
        # Filter out accreditation and method references
        valid_matches = []
        for m in matches:
            candidate = m.group(1).strip()
            # Skip if it contains accreditation references, method references, or ISO standards
            if re.search(r"(accreditation|accredited|method|ISO\s+\d+|L\d+)", candidate, flags=re.IGNORECASE):
                continue
            # Must contain numeric content or measurement terms
            if re.search(r"(\d|not\s+detected|less\s+than|<)", candidate, flags=re.IGNORECASE):
                valid_matches.append((m, candidate))
        
        # Prioritize matches with measurement units
        for m, candidate in valid_matches:
            if re.search(r"\d+[,.]?\d*\s*(meq|mg|µg|ug)\s*[O2/kg|/kg|/g]", candidate, flags=re.IGNORECASE):
                pov_val = candidate
                print(f"POV: Found single-line value with units: '{pov_val}'", file=sys.stderr)
                break
        
        # If still no match, use first valid numeric match
        if pov_val is None and valid_matches:
            pov_val = valid_matches[0][1]
            print(f"POV: Found valid numeric value: '{pov_val}'", file=sys.stderr)
    
    if pov_val:
        key = map_to_available_key(["POV", "Peroxide Value"], columns)
        if key:
            out[key] = extract_scalar(pov_val)

    # Color Gardner (10% dil.) - capture trailing numeric value, e.g. '9'
    color10_val = None
    m_color = re.search(r"Color\s+Gardner[^\n\r]*?(?:10|10%)\b[^\n\r]*?(\d+(?:[\.,]\d+)?)\b", text, flags=re.IGNORECASE)
    if m_color:
        color10_val = m_color.group(1)
    if color10_val:
        key = map_to_available_key(["Color Gardner (10% dil.)"], columns)
        if key:
            out[key] = color10_val

    # Viscosity at 25°C (can be on following line)
    vis_block = capture(r"Viscosity\s+at\s+25\s*°?C[\s:]*([^\n\r]*)")
    if not vis_block:
        # Look for a value within the next 40 chars after the phrase
        m = re.search(r"Viscosity\s+at\s+25\s*°?C[\s:]*([\s\S]{0,40})", text, flags=re.IGNORECASE)
        if m:
            vis_block = m.group(1).strip()
    if vis_block:
        key = map_to_available_key(["Viscosity at 25°C"], columns)
        if key:
            out[key] = extract_scalar(vis_block, "Viscosity at 25°C")

    # Hexane insolubles
    hex_val = capture(r"Hexane\s+insoluble(?:\s+matter)?\s*([^\n\r]*)")
    if hex_val:
        key = map_to_available_key(["Hexane Insolubles", "Hexane insoluble matter"], columns)
        if key:
            out[key] = hex_val

    # Toluene insolubles - enhanced patterns for different document types
    tol_val = None
    
    # Pattern 1: Look for direct value patterns like "Toluene insoluble matter 0,43 %"
    tol_direct = capture(r"Toluene\s+insoluble(?:\s+matter)?\s+(\d+[,\.]\d+\s*%)")
    if tol_direct:
        tol_val = tol_direct
        print(f"Toluene: Found direct value pattern: '{tol_val}'", file=sys.stderr)
    
    # Pattern 2: Look for table format where value might be on same line
    if not tol_val:
        tol_table = capture(r"Toluene\s+insoluble(?:\s+matter)?[^\d]*(\d+[,\.]\d+)")
        if tol_table:
            tol_val = tol_table + " %"  # Add percentage if missing
            print(f"Toluene: Found table format: '{tol_val}'", file=sys.stderr)
    
    # Pattern 3: Look for the value near "Toluene insoluble" (within 100 characters)
    if not tol_val:
        tol_nearby = re.search(r"Toluene\s+insoluble(?:\s+matter)?[\s\S]{0,100}?(\d+[,\.]\d+\s*%)", text, flags=re.IGNORECASE)
        if tol_nearby:
            tol_val = tol_nearby.group(1)
            print(f"Toluene: Found nearby value: '{tol_val}'", file=sys.stderr)
    
    # Pattern 4: For retest documents, look for any percentage value in context of toluene testing
    if not tol_val and ("retest" in pdf_path.lower() or "TI" in pdf_path):
        # If this is a retest document, look for standalone percentage values
        percentage_values = re.findall(r'\b(\d+[,\.]\d+)\s*%', text)
        if percentage_values:
            # For retest TI documents, the first percentage value is likely the result
            tol_val = percentage_values[0] + " %"
            print(f"Toluene: Retest document - using first percentage value: '{tol_val}'", file=sys.stderr)
    
    # Pattern 5: Fallback - general pattern but filter out method descriptions
    if not tol_val:
        tol_general = capture(r"Toluene\s+insoluble(?:\s+matter)?\s*([^\n\r]*)")
        if tol_general and not re.search(r"(Analysis|Method|Determination|Norm|ISO)", tol_general, re.IGNORECASE):
            tol_val = tol_general
            print(f"Toluene: Found general pattern: '{tol_val}'", file=sys.stderr)
    
    if tol_val:
        key = map_to_available_key(["Toluene Insolubles", "Toluene insoluble matter"], columns)
        if key:
            out[key] = extract_scalar(tol_val, key)

    # Moisture (value might be on next line)
    moist_val = capture(r"Moisture[\s\S]{0,30}?([0-9]+[\.,][0-9]+\s*%[^\n\r]*)")
    if moist_val:
        key = map_to_available_key(["Moisture"], columns)
        if key:
            out[key] = moist_val

    # Heavy Metals - Extract individual metals first
    metals_data = {}
    
    # Iron (Fe) - with chemical number pattern
    iron_val = capture(r"Iron\s*\(Fe\)\s*\([^)]+\)\s*([^\n\r]*)")
    if not iron_val:
        iron_val = capture(r"Iron\s*\(?Fe\)?\s*([^\n\r]*)")
    if iron_val:
        key = map_to_available_key(["Iron (Fe)", "Iron"], columns)
        if key:
            cleaned_iron = extract_scalar(iron_val, key)
            out[key] = cleaned_iron
            try:
                metals_data['Iron'] = float(cleaned_iron.replace(',', '.'))
            except (ValueError, TypeError):
                pass

    # Lead (Pb) - with chemical number pattern 
    lead_val = capture(r"Lead\s*\(Pb\)\s*\([^)]+\)\s*([^\n\r]*)")
    if not lead_val:
        lead_val = capture(r"Lead\s*\(?Pb\)?\s*([^\n\r]*)")
    if lead_val:
        key = map_to_available_key(["Lead", "Lead (Pb)"], columns)
        if key:
            cleaned_lead = extract_scalar(lead_val, key)
            out[key] = cleaned_lead
            try:
                metals_data['Lead'] = float(cleaned_lead.replace(',', '.'))
            except (ValueError, TypeError):
                pass

    # Arsenic (As) - with chemical number pattern
    arsenic_val = capture(r"Arsenic\s*\(As\)\s*\([^)]+\)\s*([^\n\r]*)")
    if not arsenic_val:
        arsenic_val = capture(r"Arsenic\s*\(?As\)?\s*([^\n\r]*)")
    if arsenic_val:
        key = map_to_available_key(["Arsenic", "Arsenic (As)"], columns)
        if key:
            cleaned_arsenic = extract_scalar(arsenic_val, key)
            out[key] = cleaned_arsenic
            try:
                metals_data['Arsenic'] = float(cleaned_arsenic.replace(',', '.'))
            except (ValueError, TypeError):
                pass

    # Mercury (Hg) - with chemical number pattern
    mercury_val = capture(r"Mercury\s*\(Hg\)\s*\([^)]+\)\s*([^\n\r]*)")
    if not mercury_val:
        mercury_val = capture(r"Mercury\s*\(?Hg\)?\s*([^\n\r]*)")
    if mercury_val:
        key = map_to_available_key(["Mercury", "Mercury (Hg)"], columns)
        if key:
            cleaned_mercury = extract_scalar(mercury_val, key)
            out[key] = cleaned_mercury
            try:
                metals_data['Mercury'] = float(cleaned_mercury.replace(',', '.'))
            except (ValueError, TypeError):
                pass

    # Cadmium (Cd) - for heavy metals calculation
    cadmium_val = capture(r"Cadmium\s*\(Cd\)\s*\([^)]+\)\s*([^\n\r]*)")
    if not cadmium_val:
        cadmium_val = capture(r"Cadmium\s*\(?Cd\)?\s*([^\n\r]*)")
    if cadmium_val:
        key = map_to_available_key(["Cadmium", "Cadmium (Cd)"], columns)
        if key:
            cleaned_cadmium = extract_scalar(cadmium_val, key)
            out[key] = cleaned_cadmium
            try:
                metals_data['Cadmium'] = float(cleaned_cadmium.replace(',', '.'))
            except (ValueError, TypeError):
                pass
        else:
            # Even if not in columns, extract for Heavy Metals calculation
            try:
                cleaned_cadmium = extract_scalar(cadmium_val, "Cadmium")
                metals_data['Cadmium'] = float(cleaned_cadmium.replace(',', '.'))
            except (ValueError, TypeError):
                pass

    # Calculate Heavy Metals sum if Heavy Metals column exists and we have individual metal values
    heavy_metals_key = map_to_available_key(["Heavy Metals"], columns)
    if heavy_metals_key:
        heavy_metals_sum = 0
        heavy_metals_components = {}
        
        # Include specific metals for Heavy Metals calculation
        # Heavy metals typically include: Arsenic, Cadmium, Lead, Mercury
        for metal in ['Arsenic', 'Cadmium', 'Lead', 'Mercury']:
            if metal in metals_data:
                heavy_metals_sum += metals_data[metal]
                heavy_metals_components[metal] = metals_data[metal]
        
        if heavy_metals_components:  # At least one heavy metal found
            out[heavy_metals_key] = str(heavy_metals_sum)
            print(f"Heavy Metals calculation: {heavy_metals_components} = {heavy_metals_sum}", file=sys.stderr)
        else:
            print(f"Heavy Metals: No individual metals (Arsenic, Cadmium, Lead, Mercury) found for calculation", file=sys.stderr)

    # Microbiology
    ent_val = capture(r"Enterobacteriaceae\s*([^\n\r]*)")
    if ent_val:
        key = map_to_available_key(["Enterobacteriaceae"], columns)
        if key:
            out[key] = ent_val
    
    # Cronobacter - handle various formats including TLR lab format
    cronobacter_val = None
    
    # Pattern 1: Standard format "Cronobacter spp. negative" etc.
    cronobacter_standard = capture(r"Cronobacter\s+(?:spp\.?|species)?\s*([^\n\r]*)")
    if cronobacter_standard:
        cronobacter_val = cronobacter_standard
        print(f"Cronobacter: Found standard format: '{cronobacter_val}'", file=sys.stderr)
    
    # Pattern 2: TLR lab format "Cronobacter (E. sakazakii) absent in 10 g"
    if not cronobacter_val:
        cronobacter_tlr = capture(r"Cronobacter\s*\([^)]*\)\s*([^\n\r]*)")
        if cronobacter_tlr:
            cronobacter_val = cronobacter_tlr
            print(f"Cronobacter: Found TLR format: '{cronobacter_val}'", file=sys.stderr)
    
    # Pattern 3: General Cronobacter mention
    if not cronobacter_val:
        cronobacter_general = capture(r"Cronobacter\s*([^\n\r]*)")
        if cronobacter_general:
            cronobacter_val = cronobacter_general
            print(f"Cronobacter: Found general format: '{cronobacter_val}'", file=sys.stderr)
    
    if cronobacter_val:
        # Clean up the value - convert various absent formats to "negative"
        cleaned_cronobacter = cronobacter_val.strip()
        
        # Handle spaced text like "abse n t i n 1 0 g" or "d e t e c t e d"
        # Remove spaces from sequences where each "word" is a single character
        cleaned_cronobacter = re.sub(r'\b(\w)(\s+\w)+\b', lambda m: m.group(0).replace(' ', ''), cleaned_cronobacter)
        
        print(f"Cronobacter: After space removal: '{cleaned_cronobacter}'", file=sys.stderr)
        
        # Convert various "absent/negative" patterns to "negative"
        patterns_for_negative = [
            r"absent\s+in\s+\d+\s*g",  # "absent in 10 g"
            r"absentin\d+g",  # "absentin10g"
            r"negative",
            r"not\s*detected",  # "notdetected" or "not detected"
            r"nd\b"
        ]
        
        for pattern in patterns_for_negative:
            if re.search(pattern, cleaned_cronobacter, re.IGNORECASE):
                cleaned_cronobacter = "negative"
                break
        
        key = map_to_available_key(["Cronobacter", "Cronobacter spp.", "Cronobacter (E. sakazakii)"], columns)
        if key:
            out[key] = cleaned_cronobacter
            print(f"Cronobacter: Final cleaned value: '{cleaned_cronobacter}'", file=sys.stderr)
    # Total plate count - extract '160 cfu/g', '1,9E+04 cfu/g' etc. (supports scientific notation)
    tpc_val = None
    m_tpc = re.search(r"Total\s+plate\s+count[^\n\r]*?(\d+[.,]?\d*(?:E[+-]?\d+)?\s*cfu\/g)", text, flags=re.IGNORECASE)
    if m_tpc:
        tpc_val = m_tpc.group(1).strip()
    if tpc_val:
        key = map_to_available_key(["Total Plate Count"], columns)
        if key:
            out[key] = tpc_val
    # Enhanced Yeasts & Moulds extraction
    # Pattern 1: Combined 'Yeasts & Moulds' with various formats
    yeasts_combined = capture(r"Yeasts\s*(?:&|and)\s*mou?lds\s*([^\n\r]*)")
    if yeasts_combined:
        key = map_to_available_key(["Yeasts & Molds", "Yeasts & Moulds"], columns)
        if key:
            out[key] = extract_scalar(yeasts_combined, key)
    
    # Pattern 2: "Yeasts & mouldsLess than 10 cfu/g" (no space)
    yeasts_nospace = capture(r"Yeasts\s*&\s*mou?lds\s*Less\s+than\s+(\d+(?:[\.,]\d+)?)\s*cfu\/g")
    if yeasts_nospace and not yeasts_combined:
        key = map_to_available_key(["Yeasts & Molds", "Yeasts & Moulds"], columns)
        if key:
            out[key] = extract_scalar(f"Less than {yeasts_nospace} cfu/g", key)
    
    # Pattern 3: Standalone 'Yeasts' line - more flexible
    yeasts_only = capture(r"(?mi)^\s*Yeasts\s+(?:Less\s+than\s+)?([^\n\r&]+)$")
    if not yeasts_only:
        yeasts_only = capture(r"Yeasts\s+Less\s+than\s+(\d+(?:[\.,]\d+)?)\s*cfu\/g")
    if yeasts_only:
        key = map_to_available_key(["Yeasts"], columns)
        if key:
            out[key] = extract_scalar(yeasts_only, key)
    
    # Pattern 4: Standalone 'Moulds/Molds' line - more flexible
    moulds_only = capture(r"(?mi)^\s*Mou?lds\s+(?:Less\s+than\s+)?([^\n\r&]+)$")
    if not moulds_only:
        moulds_only = capture(r"Mou?lds\s+Less\s+than\s+(\d+(?:[\.,]\d+)?)\s*cfu\/g")
    if moulds_only:
        key = map_to_available_key(["Moulds", "Molds"], columns)
        if key:
            out[key] = extract_scalar(moulds_only, key)
    salmonella_val = capture(r"Salmonella\s+spp\.?\s*([^\n\r]*)") or capture(r"Salmonella[^\n\r]*\s*([^\n\r]*)")
    if salmonella_val:
        key = map_to_available_key(["Salmonella (in 25g)", "Salmonella (in 250g)"], columns)
        if key:
            out[key] = salmonella_val

    # PAH4
    pah4_val = capture(r"PAH\s*[- ]?4.*?\s*([^\n\r]*)") or capture(r"Sum of PAH-4\s*([^\n\r]*)")
    if pah4_val:
        key = map_to_available_key(["PAH4"], columns)
        if key:
            out[key] = pah4_val

    # Ochratoxin A - with chemical number and measurement
    ochratoxin_val = capture(r"Ochratoxin\s+A\s*\([^)]+\)\s*([^\n\r±]*)")
    if not ochratoxin_val:
        ochratoxin_val = capture(r"Ochratoxin\s+A\s*([^\n\r±]*)")
    if ochratoxin_val:
        key = map_to_available_key(["Ochratoxin A"], columns)
        if key:
            # Extract just the numeric value before ± if present
            cleaned_ochratoxin = re.sub(r'\s*±.*$', '', ochratoxin_val.strip())
            out[key] = extract_scalar(cleaned_ochratoxin, key)

    # GMO Screening - multiple patterns to catch different formats
    gmo_result = None
    
    # Pattern 1: "GMO Screening 35S/ NOS/ FMV"
    gmo_screening1 = capture(r"GMO\s+Screening\s+35S[^\n\r]*([^\n\r]*)")
    if gmo_screening1:
        gmo_result = gmo_screening1
    
    # Pattern 2: "GMO Screening SynPat/ transEPSPS"  
    if not gmo_result:
        gmo_screening2 = capture(r"GMO\s+Screening\s+SynPat[^\n\r]*([^\n\r]*)")
        if gmo_screening2:
            gmo_result = gmo_screening2
    
    # Pattern 3: Generic GMO with negative result
    if not gmo_result:
        gmo_neg = capture(r"GMO[^\n\r]*(negative|not\s+detected|nd)[^\n\r]*")
        if not gmo_neg:
            # Also try without capture group for detection
            if re.search(r"GMO[^\n\r]*(?:negative|not\s+detected|nd)", text, flags=re.IGNORECASE):
                gmo_neg = "negative"
        if gmo_neg:
            gmo_result = "negative"
    
    # Pattern 4: Look for any GMO mention with results
    if not gmo_result:
        gmo_general = capture(r"GMO[^\n\r]*?\s*([^\n\r]*)")
        if gmo_general and ("negative" in gmo_general.lower() or "not detected" in gmo_general.lower() or "nd" in gmo_general.lower()):
            gmo_result = "negative"
    
    if gmo_result:
        key = map_to_available_key(["PCR, 50 cycl. (GMO), 35S/NOS/FMV"], columns)
        if key:
            out[key] = "negative" if ("negative" in str(gmo_result).lower() or "not detected" in str(gmo_result).lower()) else extract_scalar(str(gmo_result), key)

    # Peanut content - enhanced patterns
    peanut_result = None
    
    # Pattern 1: ASU method with "not detected"
    peanut_asu = capture(r"Peanut\s+ASU[^\n\r]*:?\s*(not\s+detected)")
    if not peanut_asu:
        # Also try without capture group for detection
        if re.search(r"Peanut\s+ASU[^\n\r]*:?\s*not\s+detected", text, flags=re.IGNORECASE):
            peanut_asu = "not detected"
    if peanut_asu:
        peanut_result = "negative"
    
    # Pattern 2: General peanut with "not detected"
    if not peanut_result:
        peanut_neg = capture(r"Peanut[^\n\r]*(not\s+detected|negative)")
        if not peanut_neg:
            # Also try without capture group for detection
            if re.search(r"Peanut[^\n\r]*(?:not\s+detected|negative)", text, flags=re.IGNORECASE):
                peanut_neg = "not detected"
        if peanut_neg:
            peanut_result = "negative"
    
    # Pattern 3: Allergens section with peanut
    if not peanut_result:
        allergen_peanut = capture(r"Allergens[^\n\r]*Peanut[^\n\r]*:?\s*(not\s+detected)")
        if not allergen_peanut:
            # Also try without capture group for detection
            if re.search(r"Allergens[^\n\r]*Peanut[^\n\r]*:?\s*not\s+detected", text, flags=re.IGNORECASE):
                allergen_peanut = "not detected"
        if allergen_peanut:
            peanut_result = "negative"
    
    # Pattern 3b: "mg/kg :not detected" format
    if not peanut_result:
        peanut_mgkg = capture(r"Peanut[^\n\r]*mg/kg\s*:?\s*(not\s+detected)")
        if not peanut_mgkg:
            # Also try without capture group
            if re.search(r"Peanut[^\n\r]*mg/kg\s*:?\s*not\s+detected", text, flags=re.IGNORECASE):
                peanut_mgkg = "not detected"
        if peanut_mgkg:
            peanut_result = "negative"
    
    # Pattern 4: Try to find numeric peanut content
    if not peanut_result:
        peanut_numeric = capture(r"Peanut[^\n\r]*?(\d+(?:[\.,]\d+)?)\s*(?:mg\/kg|ppm)")
        if peanut_numeric:
            peanut_result = peanut_numeric
    
    if peanut_result:
        key = map_to_available_key(["Peanut content"], columns)
        if key:
            if peanut_result == "negative":
                out[key] = "negative"
            else:
                out[key] = extract_scalar(peanut_result, key)

    return out


def process_pesticide_review(result: dict, raw_text: str) -> dict:
    """
    Check for pesticide data and set to 'Negative' when not detected or nothing detected.
    Looks for patterns indicating pesticide test results.
    Updated: If not detected or nothing detected, say 'Negative' (not review)
    """
    pesticide_fields = ['Pesticides', 'pesticides']
    
    for field in pesticide_fields:
        if field in result:
            continue  # Skip if already processed
            
        # First check for specific "nothing detected" or "performed according annex" patterns
        # These should only match when it's clear ALL pesticides were not detected
        nothing_detected_patterns = [
            r"performed\s+according\s+(?:to\s+)?annex[^\n\r]*nothing\s+detected",
            r"pesticide\s+(?:residue|screening|analysis)[^\n\r]*nothing\s+detected",
            r"pesticide\s+(?:residue|screening|analysis)[^\n\r]*not\s+detected",
            r"nothing\s+detected[^\n\r]*pesticide\s+(?:residue|screening|analysis)",
            r"all\s+pesticide[s]?[^\n\r]*not\s+detected",
            r"no\s+pesticide[s]?\s+(?:residue[s]?|detected)",
            r"pesticide[s]?\s*:\s*(?:all\s+)?(?:negative|not\s+detected|nothing\s+detected)(?:\s|$)"
        ]
        
        # Check for explicit "nothing detected" cases first (only for comprehensive negative results)
        for pattern in nothing_detected_patterns:
            if re.search(pattern, raw_text, flags=re.IGNORECASE):
                result['Pesticides'] = 'Negative'
                return result
        
        # Look for specific pesticide result patterns (avoid false positives from reference numbers/standards)
        detected_count = 0
        not_detected_count = 0
        
        # Pattern 1: Look for "Pesticide XX: ... Not detected" or "Pesticide XX: ... Detected"
        pesticide_results = re.findall(r"pesticide\s+\d+[^:]*:[^.]*?((?:not\s+detected|detected|negative|positive))", raw_text, flags=re.IGNORECASE | re.DOTALL)
        for pesticide_result in pesticide_results:
            pesticide_result = pesticide_result.strip().lower()
            if 'not detected' in pesticide_result or 'negative' in pesticide_result:
                not_detected_count += 1
            elif 'detected' in pesticide_result or 'positive' in pesticide_result:
                detected_count += 1
        
        # Pattern 2: Look for specific pesticide compounds with results
        pesticide_compounds = ['organochlorine', 'organophosphate', 'chlorpyrifos', 'dimethoate', 'malathion', 'atrazine', 'glyphosate']
        for compound in pesticide_compounds:
            # Look for compound followed by a result within reasonable distance
            compound_matches = re.finditer(rf"{compound}[^.]*?([^.]*?(?:not\s+detected|detected|negative|positive|\d+[.,]?\d*\s*(?:mg/kg|ppm|ppb|µg/kg)))", raw_text, flags=re.IGNORECASE | re.DOTALL)
            for match in compound_matches:
                result_text = match.group(1).strip().lower()
                if 'not detected' in result_text or 'negative' in result_text:
                    not_detected_count += 1
                elif ('detected' in result_text and 'not detected' not in result_text) or 'positive' in result_text:
                    detected_count += 1
                elif re.search(r'\d+[.,]?\d*\s*(?:mg/kg|ppm|ppb|µg/kg)', result_text) and '<' not in result_text:
                    # Numeric concentration values indicate detection
                    detected_count += 1
                elif '<' in result_text and re.search(r'\d+[.,]?\d*', result_text):
                    # Values like "< 0.01 mg/kg" indicate not detected
                    not_detected_count += 1
        
        # Logic: If any "not detected" found and no clear detections, say 'Negative'
        if not_detected_count > 0 and detected_count == 0:
            result['Pesticides'] = 'Negative'
        elif detected_count > 0:
            # Only set to 'review' if there are actual detections
            result['Pesticides'] = 'review'
            
    return result


def process_moh_mosh_moah(result: dict, raw_text: str) -> dict:
    """
    Process MOH (MOSH/MOAH) data.
    Check 'Sum MOAH', if < 2 show value, otherwise show 'review'.
    """
    # Look for Sum MOAH values
    moah_patterns = [
        r"Sum\s+MOAH[^\n\r]*?(\d+(?:[.,]\d+)?)\s*(?:mg/kg|ppm)",
        r"MOAH[^\n\r]*Sum[^\n\r]*?(\d+(?:[.,]\d+)?)\s*(?:mg/kg|ppm)",
        r"Sum\s+of\s+MOAH[^\n\r]*?(\d+(?:[.,]\d+)?)\s*(?:mg/kg|ppm)"
    ]
    
    for pattern in moah_patterns:
        match = re.search(pattern, raw_text, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            value_str = match.group(1).replace(',', '.')
            try:
                value = float(value_str)
                if value < 2:
                    result['MOH (MOSH/MOAH)'] = value_str
                else:
                    result['MOH (MOSH/MOAH)'] = 'review'
                break
            except ValueError:
                continue
    
    return result


def process_soy_allergen(result: dict, raw_text: str) -> dict:
    """
    Process Soy Allergen data.
    Check for Soy protein Content, if < 2.5 say 'Negative', otherwise 'review'.
    """
    # Look for Soy protein content values
    soy_patterns = [
        r"Soy\s+protein\s+[Cc]ontent[^\n\r]*?(\d+(?:[.,]\d+)?)\s*(?:mg/kg|ppm)",
        r"Soy\s+protein[^\n\r]*?(\d+(?:[.,]\d+)?)\s*(?:mg/kg|ppm)",
        r"Soy\s+allergen[^\n\r]*?(\d+(?:[.,]\d+)?)\s*(?:mg/kg|ppm)"
    ]
    
    for pattern in soy_patterns:
        match = re.search(pattern, raw_text, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            value_str = match.group(1).replace(',', '.')
            try:
                value = float(value_str)
                if value < 2.5:
                    result['Soy Allergen'] = 'Negative'
                else:
                    result['Soy Allergen'] = 'review'
                break
            except ValueError:
                continue
    
    return result


def process_cronobacter_spp(result: dict, raw_text: str) -> dict:
    """
    Process Cronobacter spp. data.
    - If Cronobacter is mentioned and absent/not detected → 'Negative'
    - If Cronobacter is mentioned and detected → 'Review'  
    - If Cronobacter is not mentioned anywhere → Leave field blank
    """
    # Look for Cronobacter mentions
    cronobacter_patterns = [
        r"Cronobacter[^\n\r]*?(absent|not\s+detected|negative|detected|positive)",
        r"Cronobacter\s+spp[^\n\r]*?(absent|not\s+detected|negative|detected|positive)"
    ]
    
    for pattern in cronobacter_patterns:
        match = re.search(pattern, raw_text, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            status = match.group(1).lower()
            if 'absent' in status or 'not detected' in status or 'negative' in status:
                result['Cronobacter spp.'] = 'Negative'
            elif 'detected' in status or 'positive' in status:
                result['Cronobacter spp.'] = 'Review'
            break
    
    # If no explicit mention found, leave the field blank (don't set any default value)
    # Only process if Cronobacter is actually mentioned in the document
    
    return result


def parse_scientific_notation(value_str: str) -> float:
    """
    Parse scientific notation like '1,9E+04' or '1.9E+04' to regular float.
    Examples:
    - '1,9E+04' → 19000.0
    - '2,5E+02' → 250.0
    - '1.2E-03' → 0.0012
    """
    # Handle European decimal notation (comma instead of dot)
    value_str = value_str.replace(',', '.')
    
    # Check if it's scientific notation
    scientific_match = re.search(r'([+-]?\d+\.?\d*)E([+-]?\d+)', value_str, re.IGNORECASE)
    if scientific_match:
        base = float(scientific_match.group(1))
        exponent = int(scientific_match.group(2))
        return base * (10 ** exponent)
    
    # If not scientific notation, try regular float
    regular_match = re.search(r'([+-]?\d+(?:[.,]\d+)?)', value_str)
    if regular_match:
        return float(regular_match.group(1).replace(',', '.'))
    
    raise ValueError(f"Could not parse numeric value from: {value_str}")


def process_microbiology_values(result: dict, raw_text: str) -> dict:
    """
    Process Enterobacteriaceae, Coliforms, E coli values.
    Handles scientific notation like '1,9E+04 cfu/g' (converts to 19000).
    If result < 10, show 'Negative', otherwise show the actual value.
    """
    microbe_fields = ['Enterobacteriaceae', 'Coliforms (in 1g)', 'E. coli', 'Total Plate Count', 'Total Viable count']
    
    # Look for these values in raw text with both scientific notation and regular numbers
    # CRITICAL: Patterns must be strict to avoid false positives from accreditation numbers, dates, etc.
    microbiology_patterns = {
        'Total Plate Count': [
            r'Total\s+plate\s+count[^\n]{0,50}?(\d+[.,]?\d*(?:E[+-]?\d+)?)\s*cfu',
            r'Total\s+plate\s+count[^\n]{0,50}?30°?C[^\n]{0,30}?(\d+[.,]?\d*(?:E[+-]?\d+)?)\s*cfu',
            r'TPC[^\n]{0,30}?(\d+[.,]?\d*(?:E[+-]?\d+)?)\s*cfu'
        ],
        'Total Viable count': [
            r'Total\s+viable\s+count[^\n]{0,50}?(\d+[.,]?\d*(?:E[+-]?\d+)?)\s*cfu',
            r'TVC[^\n]{0,30}?(\d+[.,]?\d*(?:E[+-]?\d+)?)\s*cfu'
        ],
        'Enterobacteriaceae': [
            r'Enterobacteriaceae[^\n]{0,50}?(<\s*\d+[.,]?\d*(?:E[+-]?\d+)?)\s*cfu',  # <10 or < 10
            r'Enterobacteriaceae[^\n]{0,50}?(\d+[.,]?\d*(?:E[+-]?\d+)?)\s*cfu',      # Regular numbers
            r'Enterobacteriaceae[^\n]{0,50}?(Not\s+detected|Negative|nd)',           # Not detected
            r'Enterobacteriaceae[^\n]{0,50}?(<\s*\d+)',                              # <10 without cfu (short range)
        ],
        'Coliforms (in 1g)': [
            # STRICT patterns - only match if we have clear context with cfu, detected, or specific format
            r'Coliforms?[^\n]{0,50}?(?:in\s+1\s?g)?[^\n]{0,30}?(<\s*\d+[.,]?\d*(?:E[+-]?\d+)?)\s*cfu',
            r'Coliforms?[^\n]{0,50}?(?:in\s+1\s?g)?[^\n]{0,30}?(\d+[.,]?\d*(?:E[+-]?\d+)?)\s*cfu',
            r'Coliforms?[^\n]{0,50}?(Not\s+detected|Negative|nd)(?:\s+per\s+|\s+in\s+)',  # Not detected per 1g
            # Only match numeric value if it's followed by specific units or context (within 20 chars)
            r'Coliforms?[^\n]{0,30}?(\d+[.,]?\d*)\s*(?:per|in|\/)\s*(?:1\s*g|gram)',
        ],
        'E. coli': [
            r'E\.?\s*coli[^\n]{0,50}?(<\s*\d+[.,]?\d*(?:E[+-]?\d+)?)\s*cfu',
            r'E\.?\s*coli[^\n]{0,50}?(\d+[.,]?\d*(?:E[+-]?\d+)?)\s*cfu',
            r'E\.?\s*coli[^\n]{0,50}?(Not\s+detected|Negative|nd)',
            r'E\.?\s*coli[^\n]{0,30}?(<\s*\d+)',
        ]
    }
    
    # Search for scientific notation patterns in raw text
    for field_name, patterns in microbiology_patterns.items():
        if field_name in result and result[field_name]:
            continue  # Skip if already processed
            
        for pattern in patterns:
            match = re.search(pattern, raw_text, flags=re.IGNORECASE)
            if match:
                # CRITICAL: Check the context around the match to filter out false positives
                # Extract context before the matched value to check for accreditation numbers, etc.
                match_start = match.start()
                context_start = max(0, match_start - 100)
                context = raw_text[context_start:match.end()]
                
                # Filter out matches that are clearly accreditation numbers or references
                if re.search(r'accreditation\s+number|accredited\s+method|L\d{3,4}|reference\s+number', context, flags=re.IGNORECASE):
                    print(f"{field_name}: Skipping match - found accreditation context in: {repr(context[-50:])})", file=sys.stderr)
                    continue  # Skip this match, try next pattern
                
                scientific_value = match.group(1)
                
                # Check if this is a "Not detected", "Negative", or "nd" result
                if re.search(r'(?i)not\s+detected|negative|^nd$', scientific_value):
                    result[field_name] = 'Negative'
                    print(f"{field_name}: Found 'Not detected' pattern", file=sys.stderr)
                    break  # Found a match, stop looking
                
                try:
                    # Handle "<" symbol for "less than" values (e.g., "<10", "< 10")
                    if '<' in scientific_value:
                        # Values like "<10" or "< 10" should be treated as "Negative"
                        result[field_name] = 'Negative'
                        print(f"{field_name}: Found '<' less than value: {scientific_value}", file=sys.stderr)
                    else:
                        numeric_value = parse_scientific_notation(scientific_value)
                        if numeric_value < 10:
                            result[field_name] = 'Negative'
                            print(f"{field_name}: Value {numeric_value} < 10, setting to Negative", file=sys.stderr)
                        else:
                            # Display as clean number without units
                            result[field_name] = str(int(numeric_value))
                            print(f"{field_name}: Setting to value {int(numeric_value)}", file=sys.stderr)
                    break  # Found a match, stop looking
                except ValueError as e:
                    print(f"{field_name}: Failed to parse value '{scientific_value}': {e}", file=sys.stderr)
                    continue
    
    # Process existing values that might already be in the result
    for field in microbe_fields:
        if field in result and result[field]:
            value_str = str(result[field]).strip()
            
            # Skip if already processed as 'Negative'
            if value_str.lower() == 'negative':
                continue
            
            try:
                # Handle "<" symbol for "less than" values
                if '<' in value_str:
                    # Values like "<10 cfu/g" should be treated as "Negative"
                    result[field] = 'Negative'
                else:
                    # Try to parse scientific notation or regular numbers
                    numeric_value = parse_scientific_notation(value_str)
                    if numeric_value < 10:
                        result[field] = 'Negative'
                    else:
                        # Display as clean number without units
                        result[field] = str(int(numeric_value))
            except ValueError:
                # If we can't parse it, keep the original value
                pass
    
    return result


def process_batch_numbers(result: dict, raw_text: str) -> dict:
    """
    Handle batch numbers that start with BA or CS (e.g., CS30-00-1195, BA001256).
    Also handle different lab formats like Disponent Number with CS batches.
    """
    if result.get('batch_id'):
        return result  # Already found
    
    # Look for CS and BA batch patterns
    batch_patterns = [
        r"\b(CS\d{2}-\d{2}-\d{4})\b",  # CS30-00-1195 format
        r"\b(BA\d{6})\b",              # BA001256 format
        r"batch\s*#?\s*(CS\d{2}-\d{2}-\d{4})",  # batch # CS30-00-1625
        r"Reference\s*:\s*batch\s*#?\s*(CS\d{2}-\d{2}-\d{4})",  # Reference : batch # CS30-00-1625
        r"Disponent\s+Number[^\n\r]*batch\s*#?\s*(CS\d{2}-\d{2}-\d{4})"  # Disponent Number : M20252511, Reference : batch # CS30-00-1625
    ]
    
    for pattern in batch_patterns:
        match = re.search(pattern, raw_text, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            result['batch_id'] = match.group(1)
            break
            
    return result


def process_dioxins_data(result: dict, raw_text: str) -> dict:
    """
    Process dioxin-related data with specialized extraction patterns.
    
    1. Sum Dioxins (WHO-PCDD/F-TEQ) - from "WHO PCDD/F-TEQ incl. LOQ 2005 0,158 pg/g fat ±0,025"
    2. Sum Dioxins and Dioxin Like PCB's (WHOPCDD/F-PCBTEQ) - from "WHO PCDD/F + DL-PCBs TEQ incl. LOQ 2005 0,271 pg/g fat ±0,046"
    3. Sum PCB28, PCB52, PCB101, PCB138,PCB153 and PCB180 - from "PCB SUM (PCB 28, 52, 101, 138, 153, 180) incl.LOQ Less than 0,600 ng/g fat"
    """
    
    # 1. Sum Dioxins (WHO-PCDD/F-TEQ) - Pattern: WHO PCDD/F-TEQ incl. LOQ 2005 0,158 pg/g fat ±0,025
    dioxin_teq_patterns = [
        r"WHO\s+PCDD/F-TEQ\s+incl\.\s+LOQ\s+\d+\s+(\d+[,\.]\d+)\s*pg/g\s+fat",
        r"WHO\s+PCDD/F-TEQ\s+incl\.\s+LOQ\s+\d+\s+(\d+[,\.]\d+)\s*pg/g",
        r"Sum\s+Dioxins\s+\(WHO-PCDD/F-TEQ\)[^\n\r]*?(\d+[,\.]\d+)\s*pg/g"
    ]
    
    for pattern in dioxin_teq_patterns:
        match = re.search(pattern, raw_text, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            value_str = match.group(1).replace(',', '.')
            try:
                float(value_str)  # Validate it's a number
                result['Sum Dioxins (WHO-PCDD/F-TEQ)'] = value_str
                break
            except ValueError:
                continue
    
    # 2. Sum Dioxins and Dioxin Like PCB's (WHOPCDD/F-PCBTEQ) - Pattern: WHO PCDD/F + DL-PCBs TEQ incl. LOQ 2005 0,271 pg/g fat ±0,046
    dioxin_dlpcb_patterns = [
        r"WHO\s+PCDD/F\s+\+\s+DL-PCBs\s+TEQ\s+incl\.\s+LOQ\s+\d+\s+(\d+[,\.]\d+)\s*pg/g\s+fat",
        r"WHO\s+PCDD/F\s+\+\s+DL-PCBs\s+TEQ\s+incl\.\s+LOQ\s+\d+\s+(\d+[,\.]\d+)\s*pg/g",
        r"Sum\s+Dioxins\s+and\s+Dioxin\s+Like\s+PCB['']?s[^\n\r]*?(\d+[,\.]\d+)\s*pg/g"
    ]
    
    for pattern in dioxin_dlpcb_patterns:
        match = re.search(pattern, raw_text, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            value_str = match.group(1).replace(',', '.')
            try:
                float(value_str)  # Validate it's a number
                result['Sum Dioxins and Dioxin Like PCB\'s (WHOPCDD/F-PCBTEQ)'] = value_str
                break
            except ValueError:
                continue
    
    # 3. Sum PCB28, PCB52, PCB101, PCB138,PCB153 and PCB180 - Pattern: PCB SUM (PCB 28, 52, 101, 138, 153, 180) incl.LOQ Less than 0,600 ng/g fat
    pcb_sum_patterns = [
        r"PCB\s+SUM\s+\(PCB\s+28[^\n\r]*?(?:Less\s+than\s+|<\s*)?(\d+[,\.]\d+)\s*ng/g\s+fat",
        r"PCB\s+SUM\s+\(PCB\s+28[^\n\r]*?(\d+[,\.]\d+)\s*ng/g",
        r"Sum\s+PCB28[^\n\r]*?(?:Less\s+than\s+|<\s*)?(\d+[,\.]\d+)\s*ng/g"
    ]
    
    for pattern in pcb_sum_patterns:
        match = re.search(pattern, raw_text, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            value_str = match.group(1).replace(',', '.')
            try:
                float(value_str)  # Validate it's a number
                result['Sum PCB28, PCB52, PCB101, PCB138,PCB153 and PCB180'] = value_str
                break
            except ValueError:
                continue
            
    return result


def call_openai_structured(raw_text: str, columns: list[str]) -> dict:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {}
    try:
        from openai import OpenAI  # type: ignore
    except Exception:
        return {}

    client = OpenAI(api_key=api_key)

    system_prompt = (
        "You are an expert lab analyst extracting data from Certificate of Analysis (COA) PDF reports. "
        "Your task is to identify the sample ID (format: MYYYYWWNN), batch ID (format: BA######), "
        "and extract lab test results with their exact values.\n\n"
        "IMPORTANT PARAMETER DEFINITIONS:\n"
        "- AI = Acetone Insoluble (% acetone insoluble matter)\n"
        "- AV = Acid Value (mg KOH/g)\n" 
        "- POV = Peroxide Value (meq O2/kg)\n"
        "- PC = Phosphatidylcholine (%)\n"
        "- PE = Phosphatidylethanolamine (%)\n"
        "- LPC = Lysophosphatidylcholine (%)\n"
        "- PA = Phosphatidic Acid (%)\n"
        "- PI = Phosphatidylinositol (%)\n"
        "- P = Phosphorus (%)\n"
        "- PL = Phospholipids (%)\n\n"
        "Return a flat JSON where keys EXACTLY match the provided column names. "
        "Preserve all symbols like '<', '>', '≤', '≥' in values. "
        "For GMO tests, use 'positive', 'negative', or actual values. "
        "For microbiology, convert 'less than X cfu/g' to just the number 'X'. "
        "CRITICAL RULE: Only convert 'Not detected' to 'negative' if the parameter is EXPLICITLY MENTIONED in the document with that result. "
        "CRITICAL RULE: If a parameter is not found or mentioned anywhere in the document, DO NOT include it in the JSON response at all. "
        "CRITICAL RULE: Do not add default values, placeholders, or 'negative' for missing parameters. "
        "CRITICAL RULE: Only return parameters that are explicitly mentioned and tested in the document. "
        "CRITICAL RULE: Do not return 'Sample #' or 'Batch' fields - the system handles sample/batch ID extraction separately."
    )

    # Build enhanced prompt with parameter definitions
    enhanced_columns = []
    for col in columns[:50]:  # Focus on most important columns first
        if col in PARAMETER_DEFINITIONS:
            enhanced_columns.append(f"{col} ({PARAMETER_DEFINITIONS[col]})")
        else:
            enhanced_columns.append(col)
    
    columns_list = ", ".join(enhanced_columns)

    user_prompt = f"""Lab Certificate of Analysis - Phase 1 Parameters Focus

Column References (match exactly):
{columns_list}

Raw PDF Text:
{raw_text}"""

    try:
        resp = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
        )
        content = resp.choices[0].message.content or "{}"
        # Attempt to locate a JSON block
        json_start = content.find("{")
        json_end = content.rfind("}")
        if json_start != -1 and json_end != -1 and json_end > json_start:
            content = content[json_start : json_end + 1]
        data = json.loads(content)
        if not isinstance(data, dict):
            return {}
        return data
    except Exception:
        return {}


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception as e:
        print(json.dumps({"error": f"Invalid input: {e}"}))
        sys.exit(1)

    pdf_path = payload.get("pdf_path")
    columns = payload.get("columns") or []
    phase = payload.get("phase", 1)
    
    if not pdf_path or not os.path.exists(pdf_path):
        print(json.dumps({"error": "Missing or invalid pdf_path"}))
        sys.exit(1)

    raw_text = extract_text_from_pdf(pdf_path)
    
    # Check if PDF has meaningful text content
    meaningful_text = raw_text.strip()
    if len(meaningful_text) < 50:  # Minimum threshold for meaningful content
        # Before giving up, check if this is a scanned PDF that might need OCR
        try:
            import pdfplumber
            with pdfplumber.open(pdf_path) as pdf:
                total_images = sum(len(page.images) for page in pdf.pages if hasattr(page, 'images'))
                if total_images > 0:
                    print(f"PDF appears to be scanned (found {total_images} images). Attempting OCR extraction...", file=sys.stderr)
                    
                    # Try OCR extraction
                    ocr_text = extract_text_with_ocr(pdf_path)
                    if len(ocr_text.strip()) >= 50:
                        print(f"OCR successful! Extracted {len(ocr_text)} characters", file=sys.stderr)
                        raw_text = ocr_text  # Use OCR text for processing
                        meaningful_text = raw_text.strip()
                    else:
                        print(json.dumps({
                            "error": "PDF appears to be a scanned image document. OCR extraction attempted but failed to extract sufficient text.",
                            "text_length": len(meaningful_text),
                            "ocr_text_length": len(ocr_text.strip()),
                            "images_found": total_images,
                            "suggestion": "Try using higher quality scan or professional OCR software.",
                            "extraction_phase": phase
                        }))
                        sys.exit(1)
                else:
                    print(json.dumps({
                        "error": "PDF file contains insufficient text content and no images. This may be an empty or corrupted document.",
                        "text_length": len(meaningful_text),
                        "extraction_phase": phase
                    }))
                    sys.exit(1)
        except Exception as e:
            print(f"Error checking PDF structure: {e}", file=sys.stderr)
            print(json.dumps({
                "error": "PDF file contains insufficient text content. This may be a scanned image or empty document. Please ensure the PDF has extractable text or use OCR processing.",
                "text_length": len(meaningful_text),
                "extraction_phase": phase
            }))
            sys.exit(1)
    
    print(f"PDF text extraction successful: {len(meaningful_text)} characters", file=sys.stderr)
    
    ids = find_ids(raw_text)

    # Check if this is a Spectral Service AG document
    is_spectral = detect_spectral_service_ag(raw_text)
    
    # For Spectral Service AG documents, use table extraction
    spectral_data = {}
    if is_spectral:
        spectral_data = extract_spectral_table_data(pdf_path)
        print(f"Detected Spectral Service AG document. Extracted data: {spectral_data}", file=sys.stderr)

    # Deterministic regex-based extraction for core fields first
    regex_data = extract_parameters_regex(raw_text, columns, pdf_path)
    ai_data = call_openai_structured(raw_text, columns)

    # Normalize AI keys to exact available column names (strip definitions/synonyms)
    normalized_ai: dict[str, str] = {}
    if isinstance(ai_data, dict):
        for k, v in ai_data.items():
            if not isinstance(v, str):
                try:
                    v = json.dumps(v, ensure_ascii=False)
                except Exception:
                    v = str(v)
            
            # Exact match first to get the correct parameter name
            exact = map_to_available_key([k], columns)
            base = re.sub(r"\s*\(.*\)$", "", k).strip()
            mapped = map_to_available_key([base], columns)
            
            # Get the final parameter name for cleaning
            final_param_name = exact or mapped or k
            
            # Clean the value using our standardization function with parameter name
            cleaned_v = clean_coa_value(str(v), final_param_name)
            
            if exact:
                normalized_ai[exact] = cleaned_v
                continue
            if mapped:
                normalized_ai[mapped] = cleaned_v
                continue
            # Handle common spelling variants
            if base.lower() in ["yeasts & molds", "yeasts & moulds"]:
                mapped = map_to_available_key(["Yeasts & Molds", "Yeasts & Moulds"], columns)
                if mapped:
                    normalized_ai[mapped] = cleaned_v
                    continue
            if base.lower().startswith("total plate count"):
                mapped = map_to_available_key(["Total Plate Count"], columns)
                if mapped:
                    normalized_ai[mapped] = cleaned_v
                    continue
            if base.lower().startswith("peroxide value"):
                mapped = map_to_available_key(["POV", "Peroxide Value"], columns)
                if mapped:
                    normalized_ai[mapped] = cleaned_v
                    continue

    result = {}
    if ids.get("sample_id"):
        result["sample_id"] = ids["sample_id"]
    if ids.get("batch_id"):
        result["batch_id"] = ids["batch_id"]
    
    # Add phase information for tracking
    result["extraction_phase"] = phase
    
    # Add document type detection info
    if is_spectral:
        result["document_type"] = "Spectral Service AG"
    
    # For Spectral documents, prioritize spectral data (already cleaned during extraction)
    if is_spectral and spectral_data:
        for k, v in spectral_data.items():
            # Map spectral keys to exact column names if they exist
            mapped_key = map_to_available_key([k], columns)
            if mapped_key:
                result[mapped_key] = v
            else:
                result[k] = v
    
    # Merge regex extraction (but don't override Spectral data) and clean values
    for k, v in regex_data.items():
        if k not in result or result[k] in (None, ""):
            cleaned_value = clean_coa_value(str(v), k) if v else v
            result[k] = cleaned_value

    # Merge normalized AI extracted fields without overwriting deterministic or Spectral values
    if isinstance(normalized_ai, dict):
        for k, v in normalized_ai.items():
            if k not in result or result[k] in (None, ""):
                # CRITICAL FIX: Phospholipid parameters (PC, PE, LPC, PA, PI, P, PL) should ONLY be extracted from Spectral documents
                phospholipid_params = ['pc', 'pe', 'lpc', 'pa', 'pi', 'p', 'pl']
                is_phospholipid = k.lower() in phospholipid_params
                
                # Skip phospholipid parameters completely for non-Spectral documents
                if is_phospholipid and not is_spectral:
                    continue  # Skip this parameter entirely for non-Spectral documents
                
                # For other parameters, apply false negative filtering
                if str(v).lower() == 'negative' and k not in ['Cronobacter spp.']:
                    # Check if this parameter has explicit negative result evidence (not just mentioned)
                    param_mentioned = False
                    explicit_negative = False
                    search_terms = [k.lower(), k.lower().replace(' ', ''), k.lower().replace(' ', '_')]
                    
                    # Add specific search terms and negative patterns for each parameter type
                    negative_patterns = []
                    if 'total plate count' in k.lower():
                        search_terms.extend(['total plate count', 'totalplatecount', 'tpc', 'plate count'])
                        negative_patterns.extend([r'total\s+plate\s+count[^.]*(?:not\s+detected|negative|nd)', r'tpc[^.]*(?:not\s+detected|negative|nd)'])
                    elif 'e. coli' in k.lower() or 'e coli' in k.lower():
                        search_terms.extend(['e. coli', 'e coli', 'ecoli', 'escherichia'])
                        negative_patterns.extend([r'e\.?\s*coli[^.]*(?:not\s+detected|negative|nd)', r'escherichia[^.]*(?:not\s+detected|negative|nd)'])
                    elif 'yeasts & molds' in k.lower():
                        search_terms.extend(['yeasts', 'molds', 'mould', 'yeast', 'fungi'])
                        negative_patterns.extend([r'yeasts?[^.]*(?:not\s+detected|negative|nd)', r'mou?lds?[^.]*(?:not\s+detected|negative|nd)'])
                    elif 'total viable count' in k.lower():
                        search_terms.extend(['viable count', 'viablecount', 'tvc'])
                        negative_patterns.extend([r'(?:total\s+)?viable\s+count[^.]*(?:not\s+detected|negative|nd)', r'tvc[^.]*(?:not\s+detected|negative|nd)'])
                    elif 'salmonella' in k.lower():
                        search_terms.extend(['salmonella'])
                        negative_patterns.extend([r'salmonella[^.]*(?:not\s+detected|negative|nd)'])
                    else:
                        # For other parameters, add specific negative patterns
                        negative_patterns.extend([rf'{re.escape(k.lower())}[^.]*(?:not\s+detected|negative|nd)', rf'{re.escape(k.lower().replace(" ", ""))}[^.]*(?:not\s+detected|negative|nd)'])
                        for term in search_terms:
                            negative_patterns.append(rf'{re.escape(term)}[^.]*(?:not\s+detected|negative|nd)')
                    
                    # Check if parameter is mentioned
                    for term in search_terms:
                        if term in raw_text.lower():
                            param_mentioned = True
                            break
                    
                    # Check if there's explicit negative result evidence
                    for pattern in negative_patterns:
                        if re.search(pattern, raw_text, flags=re.IGNORECASE):
                            explicit_negative = True
                            break
                    
                    # Only include 'negative' if there's explicit evidence for microbiology parameters
                    microbiology_params = ['total plate count', 'e. coli', 'yeasts & molds', 'total viable count', 'salmonella', 'cronobacter']
                    is_microbiology = any(mb_param in k.lower() for mb_param in microbiology_params)
                    
                    if explicit_negative and is_microbiology:
                        result[k] = v
                    # else: Skip this likely false negative - don't include it in the result
                else:
                    result[k] = v

    # Process pesticide review logic (but don't apply to Spectral documents since they focus on phospholipids)
    if not is_spectral:
        result = process_pesticide_review(result, raw_text)

    # Process new column logic for all documents
    result = process_moh_mosh_moah(result, raw_text)
    result = process_soy_allergen(result, raw_text)
    result = process_cronobacter_spp(result, raw_text)
    result = process_microbiology_values(result, raw_text)
    result = process_batch_numbers(result, raw_text)
    result = process_dioxins_data(result, raw_text)

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()


