/*
  Product mapping rules to normalize many raw product descriptions into
  a RED taxonomy with two levels:
  - level1: one of 'RED Product', 'To be defined', 'Irrelevant'
  - level2: concrete label such as 'REDLEC Fluid 100 IP' or
            'Undefined - Hydrolyzed Soy Lecithin'

  The function below uses case-insensitive keyword checks and light regex.
  Keep rules conservative to avoid false positives.
*/

export type RedMapping = {
  level1: 'RED Product' | 'To be defined' | 'Irrelevant';
  level2:
    | 'REDLEC Fluid 100 IP'
    | 'REDLEC Fluid 150'
    | 'REDLEC Fluid 150 Premium'
    | 'REDLEC Powder 100 IP'
    | 'REDLEC RPI SB 100 IP'
    | 'REDLEC S Fluid 150 Bio-Organic'
    | 'REDLEC S Fluid 150 Premium'
    | 'REDLEC S Powder'
    | 'PS'
    | 'Undefined - Hydrolyzed Soy Lecithin'
    | 'Undefined - Lecithin'
    | 'Undefined - Non-GMO Soy Lecithin Granules'
    | 'Undefined - PS'
    | 'Undefined - Soy Lecithin'
    | 'Undefined - Soy Lecithin Granules'
    | 'Undefined - Soy Lecithin Powder High PC'
    | 'Undefined - Sunflower Lecithin Granules'
    | 'Undefined - Hydrolyzed Soy Lecithin Blend'
    | 'Undefined - Lecithin Blend'
    | 'N.A.';
};

const redProducts: Array<{ match: RegExp; value: RedMapping['level2'] }> = [
  { match: /redlec\s*fluid\s*100\s*ip/i, value: 'REDLEC Fluid 100 IP' },
  { match: /redlec\s*fluid\s*150(?!\s*premium)/i, value: 'REDLEC Fluid 150' },
  { match: /redlec\s*fluid\s*150\s*premium/i, value: 'REDLEC Fluid 150 Premium' },
  { match: /redlec\s*powder\s*100\s*ip/i, value: 'REDLEC Powder 100 IP' },
  { match: /redlec\s*rpi\s*sb\s*100\s*ip/i, value: 'REDLEC RPI SB 100 IP' },
  { match: /redlec\s*s\s*fluid\s*150\s*bio[- ]?organic/i, value: 'REDLEC S Fluid 150 Bio-Organic' },
  { match: /redlec\s*s\s*fluid\s*150\s*premium/i, value: 'REDLEC S Fluid 150 Premium' },
  { match: /redlec\s*s\s*powder/i, value: 'REDLEC S Powder' },
];

const undefinedProducts: Array<{ match: RegExp; value: RedMapping['level2'] }> = [
  { match: /\bps\b|phosphatidylserine/i, value: 'PS' },
  { match: /hydroly(s|z)ed\s+soy\s+lecithin(?!\s*blend)/i, value: 'Undefined - Hydrolyzed Soy Lecithin' },
  { match: /\blecithin\b(?!\s*blend)/i, value: 'Undefined - Lecithin' },
  { match: /non[- ]?gmo.*soy.*granules/i, value: 'Undefined - Non-GMO Soy Lecithin Granules' },
  { match: /\bps\b|phosphatidylserine/i, value: 'Undefined - PS' },
  { match: /soy\s+lecithin(?!.*granules)(?!.*powder)/i, value: 'Undefined - Soy Lecithin' },
  { match: /soy\s+lecithin.*granules/i, value: 'Undefined - Soy Lecithin Granules' },
  { match: /powder.*high\s*pc|high\s*pc.*powder/i, value: 'Undefined - Soy Lecithin Powder High PC' },
  { match: /sunflower.*lecithin.*granules/i, value: 'Undefined - Sunflower Lecithin Granules' },
  { match: /hydroly(s|z)ed.*lecithin.*blend/i, value: 'Undefined - Hydrolyzed Soy Lecithin Blend' },
  { match: /lecithin.*blend/i, value: 'Undefined - Lecithin Blend' },
  { match: /\bna\b|^n\.?a\.?$/i, value: 'N.A.' },
];

export function mapProductToRedEquivalent(text: string): RedMapping | null {
  const hay = (text || '').toLowerCase();
  if (!hay.trim()) return null;

  for (const r of redProducts) {
    if (r.match.test(hay)) return { level1: 'RED Product', level2: r.value };
  }
  for (const r of undefinedProducts) {
    if (r.match.test(hay)) return { level1: 'To be defined', level2: r.value };
  }
  return null;
}


