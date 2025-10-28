# Spectral Service AG Malformed Table Fix

## Issue Summary

**Problem:** COA extraction from Spectral Service AG documents (specifically `BA001750 - M20253405 - PL.pdf`) was only extracting the PL (total phospholipids) value, while all other phospholipid parameters (PC, PE, PI, PA, LPC, P) were showing as "-" (missing).

**Root Cause:** The PDF table structure is malformed - all Weight-% values are packed into a single multi-line cell instead of being distributed across individual parameter rows.

## Table Structure Issue

### Normal Table Structure (Expected)
```
| Parameter | Weight-% |
|-----------|----------|
| PC        | 25.18    |
| 1-LPC     | 0.10     |
| 2-LPC     | 1.05     |
| PI        | 21.69    |
| PE        | 10.32    |
| PA        | 3.50     |
| Sum       | 67.41    |
```

### Malformed Table Structure (Actual)
```
| Parameter | Weight-%                              |
|-----------|---------------------------------------|
| Phospho.. | 25.18\n0.10\n1.05\n21.69\n0.57\n...  |  ← ALL values in ONE cell
| PC        | (empty)                               |
| 1-LPC     | (empty)                               |
| 2-LPC     | (empty)                               |
| PI        | (empty)                               |
| PE        | (empty)                               |
| PA        | (empty)                               |
| Sum       | 67.41\n2.72                           |  ← Separate cell
```

## Solution Implemented

### 1. **Multi-line Cell Detection**
```python
# Detect when Weight-% column has multi-line values
if '\n' in weight_cell:
    numeric_lines = [line.strip() for line in lines 
                     if line.strip() and re.search(r'\d+[.,]?\d*', line.strip())]
    if len(numeric_lines) >= 5:  # Multiple values detected
        weight_values_list = numeric_lines
```

### 2. **Parameter-to-Value Matching**
```python
# Build list of parameters (excluding header rows)
parameters_list = ['PC', '1-LPC', '2-LPC', 'PI', 'PE', 'PA', ...]

# Match by position
for idx, parameter in enumerate(parameters_list):
    if idx < len(weight_values_list):
        weight_value = weight_values_list[idx]
        # Map parameter to value
```

### 3. **Special Handling for Sum/Phosphorus**
Sum and Phosphorus rows often have their own separate cell values (not part of the multi-line cell), so they are extracted separately.

### 4. **LPC Calculation with Precision Fix**
```python
# Calculate LPC = 1-LPC + 2-LPC
lpc_sum = lpc_components['1-LPC'] + lpc_components['2-LPC']
lpc_sum_rounded = round(lpc_sum, 2)  # 1.15 instead of 1.1500000000000001
results['LPC'] = str(lpc_sum_rounded)
```

## Extracted Values (After Fix)

| Parameter | Value  | Description                  |
|-----------|--------|------------------------------|
| PC        | 25.18  | Phosphatidylcholine         |
| PE        | 10.32  | Phosphatidylethanolamine    |
| PI        | 21.69  | Phosphatidylinositol        |
| PA        | 3.50   | Phosphatidic Acid           |
| LPC       | 1.15   | Lysophosphatidylcholine     |
| PL        | 67.41  | Total Phospholipids         |

## Prevention Measures

### 1. **Comprehensive Documentation**
- Added detailed function docstring explaining both table formats
- Inline comments throughout the extraction logic
- Clear explanation of the malformed table structure

### 2. **Automated Test**
Created `test/spectral_extraction.test.ts` to validate:
- All phospholipid values are extracted correctly
- LPC calculation has proper precision
- Document type is correctly identified

### 3. **Robust Fallback Logic**
The code handles both table formats:
```python
if weight_values_list and len(weight_values_list) >= 5:
    # Handle malformed table (multi-line cell)
    # ... match by position
else:
    # Handle well-formed table (original logic)
    # ... extract from individual cells
```

### 4. **Debug Logging**
Extensive stderr logging for troubleshooting:
```
Found multi-line Weight-% cell at row 3: 13 values
Matching 15 parameters to 13 weight values
Matched row 4: parameter='PC' -> weight='25.18'
Found PC: 25.18
...
```

## Testing

### Manual Test
```bash
cd /home/scott/Desktop/Office/red/backend
cat <<'EOF' | python3 src/python/parse_coa_pdf.py 2>/dev/null | jq '.'
{
  "pdf_path": "/home/scott/Desktop/Office/red/docs/BA001750 - M20253405 - PL.pdf",
  "columns": ["PC", "PE", "LPC", "PA", "PI", "P", "PL"],
  "phase": 1
}
EOF
```

**Expected Output:**
```json
{
  "sample_id": "M20253405",
  "batch_id": "BA001750",
  "extraction_phase": 1,
  "document_type": "Spectral Service AG",
  "PC": "25.18",
  "PI": "21.69",
  "PE": "10.32",
  "PA": "3.50",
  "PL": "67.41",
  "LPC": "1.15"
}
```

### Automated Test
```bash
npm test -- test/spectral_extraction.test.ts
```

## Files Modified

1. **`src/python/parse_coa_pdf.py`**
   - `extract_spectral_table_data()` - Enhanced function docstring
   - Multi-line cell detection logic (lines 182-209)
   - Parameter list building with Sum/Phosphorus handling (lines 211-247)
   - Position-based value matching (lines 249-286)
   - LPC calculation with rounding (lines 337-349)

2. **`test/spectral_extraction.test.ts`** (NEW)
   - Comprehensive test for phospholipid extraction
   - LPC precision validation
   - Regression prevention

3. **`SPECTRAL_TABLE_FIX.md`** (NEW)
   - This documentation file

## Future Considerations

If similar malformed table issues occur with other lab document formats:

1. Apply the same detection pattern (multi-line cell with `\n` and multiple numeric values)
2. Build parameter list from table structure
3. Match values by position
4. Handle special rows (totals, calculations) separately
5. Add automated tests for the specific document format
6. Document the fix with examples

## Commit Message Template
```
Fix: Complete phospholipid extraction from malformed Spectral Service AG tables

- Detect and handle multi-line Weight-% cells in Spectral PDFs
- Match values to parameters by row position
- Extract all phospholipids: PC, PE, PI, PA, LPC, PL
- Fix LPC calculation precision (round to 2 decimals)
- Add comprehensive documentation and tests

Issue: BA001750 - M20253405 - PL.pdf only extracted PL, missing all other values
Root Cause: Table structure has all Weight-% values in one multi-line cell
Solution: Split multi-line cell and match by position

Test: npm test -- test/spectral_extraction.test.ts
```

## Contact

For questions about this fix, refer to:
- Code: `backend/src/python/parse_coa_pdf.py` (lines 102-354)
- Tests: `backend/test/spectral_extraction.test.ts`
- This documentation: `backend/SPECTRAL_TABLE_FIX.md`

