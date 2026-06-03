// parseInvestigationsCatalogue.js
// Run from project root: node scripts/parseInvestigationsCatalogue.js
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require(path.resolve(__dirname, '../server/node_modules/xlsx'));

const EXCEL_PATH = path.join(__dirname, '..', 'SES', 'Reference documents', 'investigations for SC+ 2.0 Progress.xlsx');
const OUTPUT_PATH = path.join(__dirname, '..', 'SES', 'client', 'src', 'data', 'investigationsCatalogue.json');

// Resolve relative to script location
const excelPath = path.resolve(__dirname, '../Reference documents/investigations for SC+ 2.0 Progress.xlsx');
const outputPath = path.resolve(__dirname, '../client/src/data/investigationsCatalogue.json');

const wb = XLSX.readFile(excelPath);

function findColIdx(headers, ...names) {
  for (const name of names) {
    const idx = headers.findIndex(h => h != null && String(h).trim().toLowerCase() === name.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function mode(arr) {
  const freq = {};
  let max = 0, result = null;
  for (const v of arr) {
    if (!v) continue;
    freq[v] = (freq[v] || 0) + 1;
    if (freq[v] > max) { max = freq[v]; result = v; }
  }
  return result;
}

const panels = [];
const PANEL_SHEETS = wb.SheetNames.filter(n => n !== 'All investigations');

PANEL_SHEETS.forEach((sheetName, sheetIndex) => {
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  if (rows.length < 3) return;

  // Row 1 (index 1): search names — collect all non-empty cells from the whole row
  const searchRow = rows[1] || [];
  const searchNames = [];
  for (const cell of searchRow) {
    if (cell == null || String(cell).trim() === '') continue;
    const str = String(cell).trim();
    // Split on comma
    const parts = str.split(',').map(s => s.trim()).filter(Boolean);
    searchNames.push(...parts);
  }
  // Remove "Composite Tests" label
  const filteredSearchNames = searchNames.filter(s => s.toLowerCase() !== 'composite tests');

  // Row 2 (index 2): headers
  const headers = rows[2] || [];
  const idIdx = findColIdx(headers, 'id');
  const testUnitIdx = findColIdx(headers, 'test_unit');
  const abbrvIdx = findColIdx(headers, 'abbrv_syn');
  const specimenIdx = findColIdx(headers, 'specimen');
  const dataTypeIdx = findColIdx(headers, 'data_type');
  const unitsIdx = findColIdx(headers, 'units');
  const commentsIdx = findColIdx(headers, 'comments');

  // Rows 3+ (index 3+): component data
  const components = [];
  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c == null)) continue;
    const id = row[idIdx];
    const name = row[testUnitIdx];
    const abbr = row[abbrvIdx];
    const specimen = row[specimenIdx];
    const dataType = row[dataTypeIdx];
    const rawUnits = row[unitsIdx];
    const comments = row[commentsIdx];

    if (id == null || name == null) continue;

    const comp = {
      id: typeof id === 'number' ? id : parseInt(id, 10),
      name: String(name).trim(),
      abbr: abbr ? String(abbr).trim() : '',
      specimen: specimen ? String(specimen).trim() : '',
      dataType: dataType ? String(dataType).trim() : 'free_text',
      units: null,
      referenceRange: comments ? String(comments).trim() || null : null,
    };

    if (dataType && String(dataType).trim().toLowerCase() === 'enum') {
      comp.options = rawUnits ? String(rawUnits).split(',').map(s => s.trim()).filter(Boolean) : [];
    } else {
      comp.units = rawUnits ? String(rawUnits).trim() || null : null;
    }

    components.push(comp);
  }

  // Panel specimen = most common specimen among components
  const panelSpecimen = mode(components.map(c => c.specimen)) || '';

  // Use first search name (after filtering) or sheet name as panel name
  const panelName = filteredSearchNames.length > 0 ? filteredSearchNames[0] : sheetName;

  panels.push({
    id: `panel_${sheetIndex}`,
    panelName,
    searchNames: filteredSearchNames,
    specimen: panelSpecimen,
    components,
  });
});

// ── All investigations sheet — singles ────────────────────────────────────────
const allSheet = wb.Sheets['All investigations'];
const allRows = XLSX.utils.sheet_to_json(allSheet, { header: 1, defval: null });
const allHeaders = allRows[0] || [];

const idIdx = findColIdx(allHeaders, 'id');
const testUnitIdx = findColIdx(allHeaders, 'test_unit');
const abbrvIdx = findColIdx(allHeaders, 'abbrv_syn');
const specimenIdx = findColIdx(allHeaders, 'specimen');
const dataTypeIdx = findColIdx(allHeaders, 'data_type');
const unitsIdx = findColIdx(allHeaders, 'units');
const commentsIdx = findColIdx(allHeaders, 'comments');
const subTypeIdx = findColIdx(allHeaders, 'Sub Type', 'sub_type', 'subtype');
const groupTestIdx = findColIdx(allHeaders, 'group_test');

const singles = [];
for (let i = 1; i < allRows.length; i++) {
  const row = allRows[i];
  if (!row || row.every(c => c == null)) continue;

  const groupTest = row[groupTestIdx];
  if (groupTest == null) continue;
  const gtStr = String(groupTest).trim().toLowerCase();
  if (gtStr !== 'false') continue;

  const id = row[idIdx];
  const name = row[testUnitIdx];
  if (id == null || name == null) continue;

  const rawUnits = row[unitsIdx];
  const dataType = row[dataTypeIdx];
  const dtStr = dataType ? String(dataType).trim() : 'free_text';
  const comments = row[commentsIdx];
  const subType = row[subTypeIdx];

  const single = {
    id: typeof id === 'number' ? id : parseInt(id, 10),
    name: String(name).trim(),
    abbr: row[abbrvIdx] ? String(row[abbrvIdx]).trim() : '',
    specimen: row[specimenIdx] ? String(row[specimenIdx]).trim() : '',
    dataType: dtStr,
    units: null,
    referenceRange: comments ? String(comments).trim() || null : null,
    subType: subType ? String(subType).trim() : undefined,
  };

  if (dtStr.toLowerCase() === 'enum') {
    single.options = rawUnits ? String(rawUnits).split(',').map(s => s.trim()).filter(Boolean) : [];
  } else {
    single.units = rawUnits ? String(rawUnits).trim() || null : null;
  }

  singles.push(single);
}

const catalogue = { panels, singles };
fs.writeFileSync(outputPath, JSON.stringify(catalogue, null, 2), 'utf8');

console.log('✓ Catalogue written to:', outputPath);
console.log(`  Panels: ${panels.length}`);
console.log(`  Singles: ${singles.length}`);

// Verify
console.log('\nVerification:');
console.log('  panels >= 5:', panels.length >= 5 ? 'PASS' : 'FAIL');
console.log('  singles >= 20:', singles.length >= 20 ? 'PASS' : 'FAIL');
const fbcPanel = panels.find(p => p.searchNames.some(s => s.toLowerCase().includes('fbc') || s.toLowerCase().includes('full blood count')));
console.log('  FBC panel found:', fbcPanel ? `PASS (${fbcPanel.panelName})` : 'FAIL');
if (fbcPanel) {
  console.log('  FBC search names:', fbcPanel.searchNames);
  console.log('  FBC components:', fbcPanel.components.length);
}
