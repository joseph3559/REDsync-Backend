// COA Header Configuration based on header explainer
// This configuration defines which columns to focus on for Phase 1 vs Phase 2
// and provides parameter definitions
// Parameter definitions
const PARAMETER_DEFINITIONS = {
    'AI': {
        fullName: 'Acetone Insoluble',
        definition: 'Acetone insoluble matter content',
        unit: '%'
    },
    'AV': {
        fullName: 'Acid Value',
        definition: 'Acid value measurement',
        unit: 'mg KOH/g'
    },
    'POV': {
        fullName: 'Peroxide Value',
        definition: 'Peroxide value measurement',
        unit: 'meq O2/kg'
    },
    'PC': {
        fullName: 'Phosphatidylcholine',
        definition: 'Phosphatidylcholine content',
        unit: '%'
    },
    'PE': {
        fullName: 'Phosphatidylethanolamine',
        definition: 'Phosphatidylethanolamine content',
        unit: '%'
    },
    'LPC': {
        fullName: 'Lysophosphatidylcholine',
        definition: 'Lysophosphatidylcholine content',
        unit: '%'
    },
    'PA': {
        fullName: 'Phosphatidic Acid',
        definition: 'Phosphatidic acid content',
        unit: '%'
    },
    'PI': {
        fullName: 'Phosphatidylinositol',
        definition: 'Phosphatidylinositol content',
        unit: '%'
    },
    'P': {
        fullName: 'Phosphorus',
        definition: 'Total phosphorus content',
        unit: '%'
    },
    'PL': {
        fullName: 'Phospholipids',
        definition: 'Total phospholipids content',
        unit: '%'
    }
};
// Header configuration based on original COA Database.xlsm
export const HEADER_CONFIG = [
    { name: 'Sample #', laboratory: 'N/A', type: 'Identifier', phase: 1, ignore: false },
    { name: 'Batch', laboratory: 'N/A', type: 'Identifier', phase: 1, ignore: false },
    { name: 'AI', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'AV', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'POV', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'Color Gardner (As is)', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'Color Gardner (10% dil.)', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'Color Iodine', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'Moisture', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'Viscosity at 25°C', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'Toluene Insolubles', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'Hexane Insolubles', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'Iron (Fe)', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'PC', laboratory: 'Spectral Service', type: 'PL', phase: 1, ignore: false },
    { name: 'PE', laboratory: 'Spectral Service', type: 'PL', phase: 1, ignore: false },
    { name: 'LPC', laboratory: 'Spectral Service', type: 'PL', phase: 1, ignore: false },
    { name: 'Total Plate Count', laboratory: 'Nofalab or TLR', type: 'Microbiology', phase: 1, ignore: false },
    { name: 'Total Viable count', laboratory: 'Nofalab or TLR', type: 'Microbiology', phase: 1, ignore: false },
    { name: 'Yeasts & Molds', laboratory: 'Nofalab or TLR', type: 'Microbiology', phase: 1, ignore: false },
    { name: 'Yeasts', laboratory: 'Nofalab or TLR', type: 'Microbiology', phase: 1, ignore: false },
    { name: 'Moulds', laboratory: 'Nofalab or TLR', type: 'Microbiology', phase: 1, ignore: false },
    { name: 'Lypolytic Bacteria', laboratory: 'Nofalab or TLR', type: 'Microbiology', phase: 1, ignore: false },
    { name: 'Enterobacteriaceae', laboratory: 'Nofalab or TLR', type: 'Microbiology', phase: 1, ignore: false },
    { name: 'Coliforms (in 1g)', laboratory: 'Nofalab or TLR', type: 'Microbiology', phase: 1, ignore: false },
    { name: 'Salmonella (in 25g)', laboratory: 'Nofalab or TLR', type: 'Microbiology', phase: 1, ignore: false },
    { name: 'PCR, 50 cycl. (GMO), 35S/NOS/FMV', laboratory: 'Alimentaire', type: 'GMO', phase: 1, ignore: false },
    { name: 'E. coli', laboratory: 'Nofalab or TLR', type: 'Microbiology', phase: 1, ignore: false },
    { name: 'Specific gravity', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'FFA (%Oleic) at loading', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'Iodine value', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'Soap content', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'Insoluble matters', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'Moisture and insolubles', laboratory: 'Nofalab or TLR', type: 'Chemical', phase: 1, ignore: false },
    { name: 'Sum PCB28, PCB52, PCB101, PCB138,PCB153 and PCB180', laboratory: 'Nofalab or TLR', type: 'Contaminant', phase: 1, ignore: false },
    { name: 'Sum Dioxins (WHO-PCDD/F-TEQ)', laboratory: 'Nofalab or TLR', type: 'Contaminant', phase: 1, ignore: false },
    { name: 'Sum Dioxins and Dioxin Like PCB\'s (WHOPCDD/F-PCBTEQ)', laboratory: 'Nofalab or TLR', type: 'Contaminant', phase: 1, ignore: false },
    { name: 'Lead', laboratory: 'Nofalab or TLR', type: 'Contaminant', phase: 1, ignore: false },
    { name: 'Arsenic', laboratory: 'Nofalab or TLR', type: 'Contaminant', phase: 1, ignore: false },
    { name: 'PA', laboratory: 'Spectral Service', type: 'PL', phase: 1, ignore: false },
    { name: 'PI', laboratory: 'Spectral Service', type: 'PL', phase: 1, ignore: false },
    { name: 'P', laboratory: 'Spectral Service', type: 'PL', phase: 1, ignore: false },
    { name: 'PL', laboratory: 'Spectral Service', type: 'PL', phase: 1, ignore: false },
    { name: 'Mercury', laboratory: 'Nofalab or TLR', type: 'Contaminant', phase: 1, ignore: false },
    { name: 'FA', laboratory: 'N.a.', type: 'N.a.', phase: 1, ignore: false },
    { name: 'Listeria monocytogenes (in 25g)', laboratory: 'Nofalab or TLR', type: 'Microbiology', phase: 1, ignore: false },
    { name: 'Coag.-Pos. staphylococci', laboratory: 'Nofalab or TLR', type: 'Microbiology', phase: 1, ignore: false },
    { name: 'Pesticides', laboratory: 'Nofalab or TLR', type: 'Contaminant', phase: 1, ignore: false },
    { name: 'Heavy Metals', laboratory: 'Nofalab or TLR', type: 'Contaminant', phase: 1, ignore: false },
    { name: 'PAH4', laboratory: 'Nofalab or TLR', type: 'Contaminant', phase: 1, ignore: false },
    { name: 'Ochratoxin A', laboratory: 'Nofalab or TLR', type: 'Contaminant', phase: 1, ignore: false },
    { name: 'Peanut content', laboratory: 'IFP', type: 'Contaminant', phase: 1, ignore: false },
    { name: 'Salmonella (in 250g)', laboratory: 'Nofalab or TLR', type: 'Microbiology', phase: 1, ignore: false },
    { name: 'Hydrolysis Degree (LPC/(LPC+PC) in mol%)', laboratory: 'Spectral Service', type: 'PL', phase: 1, ignore: false },
    { name: 'Bacillus cereus', laboratory: 'Nofalab or TLR', type: 'Microbiology', phase: 1, ignore: false },
    { name: 'MOH (MOSH/MOAH)', laboratory: 'Nofalab or TLR', type: 'Contaminant', phase: 1, ignore: false },
    { name: 'Soy Allergen', laboratory: 'IFP', type: 'Contaminant', phase: 1, ignore: false },
    { name: 'Cronobacter spp.', laboratory: 'Nofalab or TLR', type: 'Microbiology', phase: 1, ignore: false },
];
// Enhance columns with definitions
HEADER_CONFIG.forEach(col => {
    const def = PARAMETER_DEFINITIONS[col.name];
    if (def) {
        col.definition = def.definition;
        col.fullName = def.fullName;
        col.unit = def.unit;
    }
});
export function getPhase1Columns() {
    return HEADER_CONFIG.filter(col => col.phase === 1 && !col.ignore);
}
export function getPhase2Columns() {
    return HEADER_CONFIG.filter(col => col.phase === 2 && !col.ignore);
}
export function getAllActiveColumns() {
    return HEADER_CONFIG.filter(col => !col.ignore);
}
export function getIgnoredColumns() {
    return HEADER_CONFIG.filter(col => col.ignore);
}
export function getColumnsByLaboratory(lab) {
    return HEADER_CONFIG.filter(col => col.laboratory.includes(lab) && !col.ignore);
}
export function getColumnsByType(type) {
    return HEADER_CONFIG.filter(col => col.type === type && !col.ignore);
}
export function getColumnConfig(columnName) {
    return HEADER_CONFIG.find(col => col.name === columnName);
}
export function getParameterDefinition(parameterCode) {
    const def = PARAMETER_DEFINITIONS[parameterCode];
    return def ? `${def.fullName} (${def.definition})` : parameterCode;
}
