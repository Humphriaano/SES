import { useMemo, useState, FormEvent } from 'react';
import toast from 'react-hot-toast';
import { Plus, Search, X, Pencil } from 'lucide-react';
import api from '../api/client';
import { useCustomCatalogue, loadCustomCatalogue, CustomDrug, CustomTest, CustomDiagnosis } from '../lib/customCatalogue';
import { allSingles } from '../data/investigationsCatalogue';
import { CSS as LIST_CSS } from './PriceListSection';

type Tab = 'drugs' | 'tests' | 'diagnoses';
const TABS: { id: Tab; label: string }[] = [
  { id: 'drugs', label: 'Drugs' },
  { id: 'tests', label: 'Investigations' },
  { id: 'diagnoses', label: 'Diagnoses' },
];

const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Infusion', 'Cream', 'Ointment', 'Eye drops', 'Ear drops', 'Inhaler', 'Suppository', 'Powder', 'Patch', 'Other'];
const ROUTES = ['Oral', 'IV', 'IM', 'SC', 'Topical', 'Inhaled', 'Rectal', 'Ophthalmic', 'Otic', 'Sublingual', 'Vaginal', 'Other'];
const SPECIMENS = ['Blood', 'Serum', 'Plasma', 'Urine', 'Stool', 'Sputum', 'HVS', 'CSF', 'Swab', 'Tissue / Biopsy', 'X-Ray', 'Ultrasound', 'CT', 'MRI'];
const SECTIONS = ['Haematology', 'Blood Chemistry', 'Chemistry/Endocrine', 'Microbiology', 'Immuno/Sero', 'Urinalysis', 'Blood Bank', 'Pathology', 'Radiology'];
const DATA_TYPES: [string, string][] = [['float', 'Number (decimals)'], ['integer', 'Whole number'], ['enum', 'Pick from a list'], ['free text', 'Free text'], ['date', 'Date']];

const errMsg = (e: any) => e?.response ? e.response.data?.error ?? `Something went wrong (${e.response.status}). Try again.` : 'Can’t reach the server.';

function Field({ id, label, hint, children, grow = 1 }: { id: string; label: string; hint?: string; children: React.ReactNode; grow?: number }) {
  return (
    <div style={{ flex: `${grow} 1 180px`, minWidth: 0 }}>
      <label className="a-k" htmlFor={id} style={{ display: 'block', marginBottom: 6 }}>
        {label}{hint && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}> · {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function FormShell({ title, onSubmit, onCancel, busy, error, children }: { title: string; onSubmit: (e: FormEvent) => void; onCancel: () => void; busy: boolean; error: string; children: React.ReactNode }) {
  return (
    <form onSubmit={onSubmit} style={{ padding: '16px 20px', background: 'var(--ws-head)', borderBottom: '1px solid var(--border-light)' }}>
      <div style={{ fontWeight: 500, color: 'var(--text-heading)', marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>{children}</div>
      {error && <p role="alert" className="a-err" style={{ margin: '12px 0 0' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" className="a-q" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="a-btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

// ── Drugs ─────────────────────────────────────────────────────────────────────
function DrugForm({ initial, onDone }: { initial: CustomDrug | null; onDone: () => void }) {
  const [v, setV] = useState({
    generic: initial?.generic ?? '', brand: initial?.brand ?? '', strength: initial?.strength ?? '', form: initial?.form ?? '',
    route: initial?.route ?? '', atcCode: initial?.atcCode ?? '', manufacturer: initial?.manufacturer ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => { setV({ ...v, [k]: e.target.value }); setError(''); };

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (initial) await api.patch(`/catalogue/drugs/${initial.id}`, v); else await api.post('/catalogue/drugs', v);
      await loadCustomCatalogue();
      toast.success(`${v.generic} ${initial ? 'updated' : 'added'}`);
      onDone();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <FormShell title={initial ? `Edit ${initial.generic}` : 'Add a drug'} onSubmit={save} onCancel={onDone} busy={busy} error={error}>
      <Field id="d-generic" label="Generic name" grow={2}><input id="d-generic" className="a-field" autoFocus maxLength={120} value={v.generic} onChange={set('generic')} placeholder="e.g. Amlodipine" /></Field>
      <Field id="d-brand" label="Brand name" hint="optional" grow={2}><input id="d-brand" className="a-field" maxLength={120} value={v.brand} onChange={set('brand')} placeholder="e.g. Norvasc" /></Field>
      <Field id="d-strength" label="Strength"><input id="d-strength" className="a-field" maxLength={60} value={v.strength} onChange={set('strength')} placeholder="e.g. 5mg or 125mg/5ml" /></Field>
      <Field id="d-form" label="Form">
        <input id="d-form" className="a-field" list="d-forms" maxLength={60} value={v.form} onChange={set('form')} placeholder="Tablet" />
        <datalist id="d-forms">{FORMS.map((f) => <option key={f} value={f} />)}</datalist>
      </Field>
      <Field id="d-route" label="Route">
        <input id="d-route" className="a-field" list="d-routes" maxLength={60} value={v.route} onChange={set('route')} placeholder="Oral" />
        <datalist id="d-routes">{ROUTES.map((f) => <option key={f} value={f} />)}</datalist>
      </Field>
      <Field id="d-atc" label="ATC code" hint="optional"><input id="d-atc" className="a-field" maxLength={10} value={v.atcCode} onChange={set('atcCode')} placeholder="C08CA01" /></Field>
      <Field id="d-mfr" label="Manufacturer" hint="optional" grow={2}><input id="d-mfr" className="a-field" maxLength={120} value={v.manufacturer} onChange={set('manufacturer')} /></Field>
    </FormShell>
  );
}

// ── Investigations ────────────────────────────────────────────────────────────
function TestForm({ initial, onDone }: { initial: CustomTest | null; onDone: () => void }) {
  const [kind, setKind] = useState<'SINGLE' | 'PANEL'>(initial?.kind ?? 'SINGLE');
  const [v, setV] = useState({
    name: initial?.name ?? '', abbr: initial?.abbr ?? '', loinc: initial?.loinc ?? '', specimen: initial?.specimen ?? '', subType: initial?.subType ?? '',
    dataType: initial?.dataType ?? 'float', units: initial?.units ?? '', referenceRange: initial?.referenceRange ?? '',
    options: (initial?.options ?? []).join('\n'), searchNames: (initial?.searchNames ?? []).join(', '),
  });
  const [components, setComponents] = useState<number[]>(initial?.componentIds ?? []);
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => { setV({ ...v, [k]: e.target.value }); setError(''); };

  const singles = allSingles();
  const byId = useMemo(() => new Map(singles.map((s) => [s.id, s])), [singles]);
  const hits = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (q.length < 2) return [];
    return singles.filter((s) => s.id !== 0 && !components.includes(s.id) && (s.name.toLowerCase().includes(q) || (s.abbr || '').toLowerCase().includes(q))).slice(0, 8);
  }, [find, singles, components]);
  const numeric = v.dataType === 'float' || v.dataType === 'integer';

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const body = kind === 'PANEL'
      ? { kind, name: v.name, abbr: v.abbr, loinc: v.loinc, specimen: v.specimen, subType: v.subType, searchNames: v.searchNames.split(',').map((s) => s.trim()).filter(Boolean), componentIds: components }
      : { kind, name: v.name, abbr: v.abbr, loinc: v.loinc, specimen: v.specimen, subType: v.subType, dataType: v.dataType, units: v.units, referenceRange: v.referenceRange, options: v.options.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) };
    try {
      if (initial) await api.patch(`/catalogue/tests/${initial.rowId}`, body); else await api.post('/catalogue/tests', body);
      await loadCustomCatalogue();
      toast.success(`${v.name} ${initial ? 'updated' : 'added'}`);
      onDone();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <FormShell title={initial ? `Edit ${initial.name}` : 'Add an investigation'} onSubmit={save} onCancel={onDone} busy={busy} error={error}>
      {!initial && (
        <div style={{ flexBasis: '100%', display: 'flex', gap: 6 }} role="radiogroup" aria-label="What are you adding">
          {([['SINGLE', 'Single test'], ['PANEL', 'Panel (group of tests)']] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={`pl-tab${kind === k ? ' on' : ''}`} onClick={() => setKind(k)} style={{ height: 32 }}>{l}</button>
          ))}
        </div>
      )}
      <Field id="t-name" label={kind === 'PANEL' ? 'Panel name' : 'Test name'} grow={2}><input id="t-name" className="a-field" autoFocus maxLength={160} value={v.name} onChange={set('name')} placeholder={kind === 'PANEL' ? 'e.g. Lipid profile' : 'e.g. Serum Creatinine'} /></Field>
      <Field id="t-abbr" label="Short name" hint="optional"><input id="t-abbr" className="a-field" maxLength={60} value={v.abbr} onChange={set('abbr')} placeholder="e.g. Creat" /></Field>
      <Field id="t-loinc" label="LOINC code" hint="optional"><input id="t-loinc" className="a-field" maxLength={12} value={v.loinc} onChange={set('loinc')} placeholder="2160-0" inputMode="numeric" /></Field>
      <Field id="t-spec" label="Specimen">
        <input id="t-spec" className="a-field" list="t-specs" maxLength={80} value={v.specimen} onChange={set('specimen')} placeholder="Blood" />
        <datalist id="t-specs">{SPECIMENS.map((f) => <option key={f} value={f} />)}</datalist>
      </Field>
      <Field id="t-sect" label="Section" hint="optional">
        <input id="t-sect" className="a-field" list="t-sects" maxLength={60} value={v.subType} onChange={set('subType')} placeholder="Haematology" />
        <datalist id="t-sects">{SECTIONS.map((f) => <option key={f} value={f} />)}</datalist>
      </Field>

      {kind === 'SINGLE' ? (
        <>
          <Field id="t-type" label="Result is">
            <select id="t-type" className="a-field" value={v.dataType} onChange={set('dataType')}>{DATA_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          {numeric && <Field id="t-units" label="Units"><input id="t-units" className="a-field" maxLength={30} value={v.units} onChange={set('units')} placeholder="mmol/L" /></Field>}
          <Field id="t-ref" label="Reference range" hint="optional, e.g. M 62-106, F 44-80"><input id="t-ref" className="a-field" maxLength={120} value={v.referenceRange} onChange={set('referenceRange')} /></Field>
          {v.dataType === 'enum' && (
            <Field id="t-opts" label="Possible results" hint="one per line" grow={3}>
              <textarea id="t-opts" className="a-field" rows={4} value={v.options} onChange={set('options')} placeholder={'Positive\nNegative'} style={{ height: 'auto', padding: 10, resize: 'vertical' }} />
            </Field>
          )}
        </>
      ) : (
        <>
          <Field id="t-syn" label="Other names to search by" hint="optional, comma separated" grow={3}><input id="t-syn" className="a-field" maxLength={300} value={v.searchNames} onChange={set('searchNames')} placeholder="LFTs, liver profile" /></Field>
          <div style={{ flexBasis: '100%' }}>
            <label className="a-k" htmlFor="t-find" style={{ display: 'block', marginBottom: 6 }}>Tests in this panel <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· {components.length} added · pick from the single tests, built-in or ones you’ve added</span></label>
            {components.length > 0 && (
              <ol style={{ listStyle: 'none', margin: '0 0 10px', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {components.map((id) => {
                  const s = byId.get(id);
                  return (
                    <li key={id} className="a-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 10px' }}>
                      {s ? `${s.name}${s.units ? ` (${s.units})` : ''}` : `Test #${id} (no longer available)`}
                      <button type="button" aria-label={`Remove ${s?.name ?? id}`} onClick={() => setComponents(components.filter((c) => c !== id))} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit', display: 'inline-flex', padding: 2 }}><X size={13} /></button>
                    </li>
                  );
                })}
              </ol>
            )}
            <div style={{ position: 'relative', maxWidth: 420 }}>
              <input id="t-find" className="a-field" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search a single test to add…" autoComplete="off" />
              {hits.length > 0 && (
                <div role="listbox" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', maxHeight: 240, overflowY: 'auto' }}>
                  {hits.map((s) => (
                    <button key={s.id} type="button" role="option" aria-selected="false" onClick={() => { setComponents([...components, s.id]); setFind(''); setError(''); }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 0, borderBottom: '1px solid var(--border-light)', background: 'none', cursor: 'pointer', color: 'var(--text-heading)', font: 'inherit', fontSize: 13 }}>
                      {s.name} <span className="a-faint">{[s.specimen, s.units].filter(Boolean).join(' · ')}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </FormShell>
  );
}

// ── Diagnoses ─────────────────────────────────────────────────────────────────
function DiagnosisForm({ initial, onDone }: { initial: CustomDiagnosis | null; onDone: () => void }) {
  const [v, setV] = useState({ code: initial?.code ?? '', description: initial?.description ?? '', category: initial?.category ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => { setV({ ...v, [k]: e.target.value }); setError(''); };

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (initial) await api.patch(`/catalogue/diagnoses/${initial.id}`, v); else await api.post('/catalogue/diagnoses', v);
      await loadCustomCatalogue();
      toast.success(`${v.description} ${initial ? 'updated' : 'added'}`);
      onDone();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <FormShell title={initial ? `Edit ${initial.description}` : 'Add a diagnosis'} onSubmit={save} onCancel={onDone} busy={busy} error={error}>
      <Field id="g-code" label="ICD-11 code"><input id="g-code" className="a-field" autoFocus maxLength={24} value={v.code} onChange={set('code')} placeholder="e.g. 5A11" /></Field>
      <Field id="g-name" label="Diagnosis name" grow={3}><input id="g-name" className="a-field" maxLength={240} value={v.description} onChange={set('description')} placeholder="e.g. Type 2 diabetes mellitus" /></Field>
      <Field id="g-cat" label="Category" hint="optional" grow={2}><input id="g-cat" className="a-field" maxLength={60} value={v.category} onChange={set('category')} placeholder="Endocrine/Metabolic" /></Field>
    </FormShell>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────
export default function CatalogueSection() {
  const cat = useCustomCatalogue();
  const [tab, setTab] = useState<Tab>('drugs');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<'new' | CustomDrug | CustomTest | CustomDiagnosis | null>(null);

  const term = q.trim().toLowerCase();
  const has = (...s: (string | null | undefined)[]) => !term || s.some((x) => x?.toLowerCase().includes(term));
  const drugs = cat.drugs.filter((d) => has(d.generic, d.brand, d.code, d.strength));
  const tests = cat.tests.filter((t) => has(t.name, t.abbr, t.loinc));
  const diagnoses = cat.diagnoses.filter((d) => has(d.code, d.description, d.category));
  const counts = { drugs: cat.drugs.length, tests: cat.tests.length, diagnoses: cat.diagnoses.length };

  async function toggle(kind: 'drugs' | 'tests', id: string, active: boolean) {
    try { await api.patch(`/catalogue/${kind}/${id}`, { active: !active }); await loadCustomCatalogue(); }
    catch (e) { toast.error(errMsg(e)); }
  }

  const close = () => setEditing(null);
  const empty = (what: string) => (
    <div style={{ padding: '44px 20px 48px', textAlign: 'center' }}>
      <p style={{ margin: '0 0 4px', fontWeight: 500, color: 'var(--text-heading)' }}>{term ? `Nothing matches “${q.trim()}”` : `You haven’t added any ${what} yet`}</p>
      <p className="a-muted" style={{ margin: 0 }}>{term ? 'Try a different word.' : `Anything missing from the built-in list can be added here and is available to staff straight away.`}</p>
    </div>
  );

  return (
    <section aria-labelledby="cat-h" className="a-card">
      <div className="a-head" style={{ padding: '14px 16px 14px 20px' }}>
        <div>
          <h2 id="cat-h" className="a-h2" style={{ marginBottom: 2 }}>Catalogue</h2>
          <p className="a-muted" style={{ margin: 0, fontSize: 13 }}>Add drugs, investigations and diagnoses that are missing from the built-in lists. New drugs and tests also appear in the price list.</p>
        </div>
        <button type="button" className="a-btn" onClick={() => setEditing('new')} disabled={editing !== null}><Plus size={15} strokeWidth={2.2} /> Add {tab === 'drugs' ? 'drug' : tab === 'tests' ? 'investigation' : 'diagnosis'}</button>
      </div>

      {editing !== null && (tab === 'drugs'
        ? <DrugForm key={editing === 'new' ? 'new' : (editing as CustomDrug).id} initial={editing === 'new' ? null : (editing as CustomDrug)} onDone={close} />
        : tab === 'tests'
          ? <TestForm key={editing === 'new' ? 'new' : (editing as CustomTest).rowId} initial={editing === 'new' ? null : (editing as CustomTest)} onDone={close} />
          : <DiagnosisForm key={editing === 'new' ? 'new' : (editing as CustomDiagnosis).id} initial={editing === 'new' ? null : (editing as CustomDiagnosis)} onDone={close} />)}

      <div className="pl-bar">
        <div role="tablist" aria-label="Catalogue" style={{ display: 'flex', gap: 4 }}>
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`pl-tab${tab === t.id ? ' on' : ''}`} onClick={() => { setTab(t.id); setEditing(null); setQ(''); }}>
              {t.label} · {counts[t.id]}
            </button>
          ))}
        </div>
        <label className="a-search" style={{ width: 280 }}>
          <Search size={16} color="var(--text-subtle)" aria-hidden="true" />
          <span className="sr-only">Search what you’ve added</span>
          <input type="search" placeholder="Search what you’ve added" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      {tab === 'drugs' && (drugs.length === 0 ? empty('drugs') : (
        <div style={{ overflowX: 'auto' }}>
          <table className="a-tbl" style={{ minWidth: 700 }}>
            <thead><tr><th style={{ paddingLeft: 20 }}>Drug</th><th>Strength · form · route</th><th>Code</th><th>Active</th><th style={{ paddingRight: 20 }} /></tr></thead>
            <tbody>{drugs.map((d) => (
              <tr key={d.id} style={{ opacity: d.active ? 1 : 0.55 }}>
                <td style={{ paddingLeft: 20 }}><div style={{ fontWeight: 500, color: 'var(--text-heading)' }}>{d.generic}</div><div className="a-faint" style={{ fontSize: 12 }}>{[d.brand, d.manufacturer, d.atcCode].filter(Boolean).join(' · ') || '—'}</div></td>
                <td className="a-muted">{[d.strength, d.form, d.route].join(' · ')}</td>
                <td className="a-faint">{d.code}</td>
                <td><button type="button" role="switch" aria-checked={d.active} aria-label={`${d.generic} active`} className={`a-sw${d.active ? ' on' : ''}`} onClick={() => toggle('drugs', d.id, d.active)} /></td>
                <td style={{ paddingRight: 20, textAlign: 'right' }}><button type="button" className="a-q" onClick={() => setEditing(d)} disabled={editing !== null}><Pencil size={13} style={{ marginRight: 5, verticalAlign: -1 }} />Edit</button></td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}

      {tab === 'tests' && (tests.length === 0 ? empty('investigations') : (
        <div style={{ overflowX: 'auto' }}>
          <table className="a-tbl" style={{ minWidth: 700 }}>
            <thead><tr><th style={{ paddingLeft: 20 }}>Investigation</th><th>Details</th><th>LOINC</th><th>Active</th><th style={{ paddingRight: 20 }} /></tr></thead>
            <tbody>{tests.map((t) => (
              <tr key={t.rowId} style={{ opacity: t.active ? 1 : 0.55 }}>
                <td style={{ paddingLeft: 20 }}><div style={{ fontWeight: 500, color: 'var(--text-heading)' }}>{t.name} <span className="a-tag">{t.kind === 'PANEL' ? 'Panel' : 'Test'}</span></div><div className="a-faint" style={{ fontSize: 12 }}>{[t.abbr, t.specimen, t.subType].filter(Boolean).join(' · ')}</div></td>
                <td className="a-muted" style={{ fontSize: 13 }}>{t.kind === 'PANEL' ? `${t.componentIds.length} tests` : [t.dataType, t.units, t.referenceRange].filter(Boolean).join(' · ')}</td>
                <td className="a-faint">{t.loinc ?? '—'}</td>
                <td><button type="button" role="switch" aria-checked={t.active} aria-label={`${t.name} active`} className={`a-sw${t.active ? ' on' : ''}`} onClick={() => toggle('tests', t.rowId, t.active)} /></td>
                <td style={{ paddingRight: 20, textAlign: 'right' }}><button type="button" className="a-q" onClick={() => setEditing(t)} disabled={editing !== null}><Pencil size={13} style={{ marginRight: 5, verticalAlign: -1 }} />Edit</button></td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}

      {tab === 'diagnoses' && (diagnoses.length === 0 ? empty('diagnoses') : (
        <div style={{ overflowX: 'auto' }}>
          <table className="a-tbl" style={{ minWidth: 600 }}>
            <thead><tr><th style={{ paddingLeft: 20 }}>Code</th><th>Diagnosis</th><th>Category</th><th style={{ paddingRight: 20 }} /></tr></thead>
            <tbody>{diagnoses.map((d) => (
              <tr key={d.id}>
                <td style={{ paddingLeft: 20, fontWeight: 500, color: 'var(--text-heading)' }}>{d.code}</td>
                <td>{d.description}</td>
                <td className="a-muted">{d.category ?? '—'}</td>
                <td style={{ paddingRight: 20, textAlign: 'right' }}><button type="button" className="a-q" onClick={() => setEditing(d)} disabled={editing !== null}><Pencil size={13} style={{ marginRight: 5, verticalAlign: -1 }} />Edit</button></td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}
      <style>{LIST_CSS}</style>
    </section>
  );
}
