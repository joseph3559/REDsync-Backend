#!/usr/bin/env python3
import sys
import json
import os
import re

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


def extract_spectral_table_data(path: str) -> dict:
    """Extract structured table data specifically for Spectral Service AG documents."""
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
                            results['LPC'] = str(lpc_sum)
                            print(f"Calculated LPC: {lpc_sum} (1-LPC: {lpc_components['1-LPC']} + 2-LPC: {lpc_components['2-LPC']})", file=sys.stderr)
                        elif '1-LPC' in lpc_components:
                            results['LPC'] = str(lpc_components['1-LPC'])
                            print(f"Using 1-LPC only: {lpc_components['1-LPC']}", file=sys.stderr)
                        elif '2-LPC' in lpc_components:
                            results['LPC'] = str(lpc_components['2-LPC'])
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
        # Look for M followed by 8 digits in the description (with or without space)
        sample_in_desc = re.search(r"\bM\s*\d{8}\b", desc_text)
        if sample_in_desc:
            sample_id = sample_in_desc.group(0).replace(' ', '')  # Remove any spaces
            print(f"Sample ID extracted from description: '{sample_id}' from '{desc_text.strip()}'", file=sys.stderr)
    
    # Priority 2: Check "Sample No:" field
    if not sample_id:
        sample_no_match = re.search(r"Sample\s+No:\s*([^\n\r]*)", text, flags=re.IGNORECASE)
        if sample_no_match:
            sample_no_text = sample_no_match.group(1)
            # Look for M followed by 8 digits (with or without space)
            sample_in_no = re.search(r"\bM\s*\d{8}\b", sample_no_text)
            if sample_in_no:
                sample_id = sample_in_no.group(0).replace(' ', '')  # Remove any spaces
                print(f"Sample ID extracted from 'Sample No': '{sample_id}' from '{sample_no_text.strip()}'", file=sys.stderr)
    
    # Priority 3: If not found in specific fields, search entire text
    if not sample_id:
        # Look for M followed by optional space and 8 digits
        sample_match = re.search(r"\bM\s*\d{8}\b", text)
        if sample_match:
            sample_id = sample_match.group(0).replace(' ', '')  # Remove any spaces
            print(f"Sample ID extracted from general text: '{sample_id}'", file=sys.stderr)
    
    # Extract batch ID
    batch_match = re.search(r"\bBA\d{6}\b", text)
    if batch_match:
        batch_id = batch_match.group(0)
    
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


def map_to_available_key(candidates: list[str], available: list[str]) -> str | None:
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
    
    # Handle "Not detected" cases - convert to "negative"
    if re.search(r"(?i)\b(not\s+detected|nd)\b", value):
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


def extract_parameters_regex(raw_text: str, columns: list[str]) -> dict:
    """Lightweight, deterministic extraction for common parameters and synonyms.
    Only returns keys that exist in provided columns list (exact case preserved).
    """
    text = raw_text
    out: dict[str, str] = {}

    def capture(pattern: str) -> str | None:
        m = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE | re.DOTALL)
        return m.group(1).strip() if m else None

    def extract_scalar(s: str, param_name: str = "") -> str:
        if s is None:
            return s
        return clean_coa_value(s, param_name)

    # AI (Acetone/Aceton insoluble)
    ai_val = capture(r"(?:Acetone|Aceton)\s+insoluble\s*([^\n\r]*)")
    if ai_val:
        key = map_to_available_key(["AI", "Acetone Insoluble", "Aceton insoluble"], columns)
        if key:
            out[key] = ai_val

    # AV (Acid value)
    av_val = capture(r"Acid\s+value\s*([^\n\r]*)")
    if av_val:
        key = map_to_available_key(["AV", "Acid Value"], columns)
        if key:
            out[key] = av_val

    # POV (Peroxide value)
    # Sometimes appears multiple times. Prefer the occurrence that contains a numeric/ND/limit value.
    pov_val = None
    matches = list(re.finditer(r"Peroxide\s+value\s*([^\n\r]*)", text, flags=re.IGNORECASE))
    for m in matches:
        candidate = m.group(1).strip()
        if re.search(r"\d|not\s+detected|less\s+than", candidate, flags=re.IGNORECASE):
            pov_val = candidate
    if pov_val is None and matches:
        pov_val = matches[-1].group(1).strip()
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

    # Toluene insolubles
    tol_val = capture(r"Toluene\s+insoluble(?:\s+matter)?\s*([^\n\r]*)")
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

    # Calculate Heavy Metals sum (Arsenic + Cadmium + Lead + Mercury - NOT Iron)
    heavy_metals_key = map_to_available_key(["Heavy Metals"], columns)
    if heavy_metals_key:
        heavy_metals_sum = 0
        heavy_metals_components = {}
        
        # Only include specific metals for Heavy Metals calculation
        for metal in ['Arsenic', 'Cadmium', 'Lead', 'Mercury']:
            if metal in metals_data:
                heavy_metals_sum += metals_data[metal]
                heavy_metals_components[metal] = metals_data[metal]
        
        if heavy_metals_components:  # At least one heavy metal found
            out[heavy_metals_key] = str(heavy_metals_sum)
            print(f"Heavy Metals calculation: {heavy_metals_components} = {heavy_metals_sum}", file=sys.stderr)

    # Microbiology
    ent_val = capture(r"Enterobacteriaceae\s*([^\n\r]*)")
    if ent_val:
        key = map_to_available_key(["Enterobacteriaceae"], columns)
        if key:
            out[key] = ent_val
    # Total plate count - extract '160 cfu/g' etc.
    tpc_val = None
    m_tpc = re.search(r"Total\s+plate\s+count[^\n\r]*?(\d[\d\s\.,]*\s*cfu\/g)", text, flags=re.IGNORECASE)
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
    Check for pesticide data and set to 'review' if mixed results found.
    Looks for patterns indicating both detected and not detected pesticides.
    """
    pesticide_fields = ['Pesticides', 'pesticides']
    
    for field in pesticide_fields:
        if field in result:
            continue  # Skip if already processed
            
        # Look for pesticide mentions in the text
        pesticide_patterns = [
            r"pesticide[s]?\s*(?:residue[s]?)?\s*([^\n\r]*)",
            r"organochlorine[s]?\s*([^\n\r]*)", 
            r"organophosphate[s]?\s*([^\n\r]*)",
            r"chlorpyrifos\s*([^\n\r]*)",
            r"dimethoate\s*([^\n\r]*)",
            r"malathion\s*([^\n\r]*)"
        ]
        
        detected_count = 0
        not_detected_count = 0
        
        for pattern in pesticide_patterns:
            matches = re.finditer(pattern, raw_text, flags=re.IGNORECASE | re.MULTILINE)
            for match in matches:
                value = match.group(1).strip().lower()
                if 'not detected' in value or 'negative' in value or '<' in value:
                    not_detected_count += 1
                elif 'detected' in value or 'positive' in value or any(c.isdigit() for c in value):
                    detected_count += 1
        
        # If we have both detected and not detected, mark for review
        if detected_count > 0 and not_detected_count > 0:
            result['Pesticides'] = 'review'
        elif not_detected_count > 0 and detected_count == 0:
            result['Pesticides'] = 'negative'
            
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
        "Convert 'Not detected' values to 'negative'. "
        "If a parameter is not found, omit it completely."
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
    ids = find_ids(raw_text)

    # Check if this is a Spectral Service AG document
    is_spectral = detect_spectral_service_ag(raw_text)
    
    # For Spectral Service AG documents, use table extraction
    spectral_data = {}
    if is_spectral:
        spectral_data = extract_spectral_table_data(pdf_path)
        print(f"Detected Spectral Service AG document. Extracted data: {spectral_data}", file=sys.stderr)

    # Deterministic regex-based extraction for core fields first
    regex_data = extract_parameters_regex(raw_text, columns)
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
                result[k] = v

    # Process pesticide review logic (but don't apply to Spectral documents since they focus on phospholipids)
    if not is_spectral:
        result = process_pesticide_review(result, raw_text)

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()


