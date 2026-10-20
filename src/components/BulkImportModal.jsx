import React, { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../supabaseClient';

// ── Config ──────────────────────────────────────────────
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ROWS       = 5000;

// ── Field definitions ────────────────────────────────────
const SYSTEM_FIELDS = [
  { key: 'full_name',             label: 'Ad Soyad',           required: true  },
  { key: 'email',                 label: 'E-posta',            required: false },
  { key: 'phone',                 label: 'Telefon',            required: false },
  { key: 'membership_type',       label: 'Üyelik Paketi',      required: false },
  { key: 'membership_start_date', label: 'Üyelik Başlangıç',   required: false },
  { key: 'membership_end_date',   label: 'Üyelik Bitiş',       required: false },
  { key: 'last_payment_date',     label: 'Son Ödeme Tarihi',   required: false },
  { key: 'remaining_lessons',     label: 'Kalan Ders',         required: false },
  { key: 'is_unlimited',          label: 'Sınırsız',           required: false },
  { key: 'member_level',          label: 'Üye Seviyesi',       required: false },
  { key: 'member_code',           label: 'Üye Kodu',           required: false },
  { key: 'payment_amount',        label: 'Ödeme Tutarı',       required: false },
  { key: 'payment_currency',      label: 'Para Birimi',        required: false },
  { key: 'payment_method',        label: 'Ödeme Yöntemi',      required: false },
  { key: '__ignore__',            label: '— Yoksay —',         required: false },
];

const ALIASES = {
  full_name:             ['full_name','ad soyad','adsoyad','name','member name','isim','ad','tam ad'],
  email:                 ['email','e-posta','eposta','mail','e mail'],
  phone:                 ['phone','telefon','tel','gsm','cep','mobile'],
  membership_type:       ['membership_type','paket','package','üyelik tipi','membership','üyelik paketi'],
  membership_start_date: ['membership_start_date','başlangıç','start','start date','üyelik başlangıç','başlangıç tarihi'],
  membership_end_date:   ['membership_end_date','bitiş','end','end date','üyelik bitiş','bitiş tarihi','expiry'],
  last_payment_date:     ['last_payment_date','ödeme tarihi','payment date','son ödeme','last payment'],
  remaining_lessons:     ['remaining_lessons','kalan ders','ders hakkı','credits','lessons','remaining'],
  is_unlimited:          ['is_unlimited','sınırsız','unlimited'],
  member_level:          ['member_level','seviye','level'],
  member_code:           ['member_code','üye kodu','kod','code','activation code','aktivasyon kodu'],
  payment_amount:        ['payment_amount','tutar','amount','ödeme tutarı'],
  payment_currency:      ['payment_currency','para birimi','currency'],
  payment_method:        ['payment_method','ödeme yöntemi','method','yöntem'],
};

// ── Helpers ──────────────────────────────────────────────
function autoMatch(headers) {
  const m = {};
  headers.forEach(h => {
    const norm = h.toLowerCase().trim();
    let matched = '';
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (aliases.includes(norm)) { matched = field; break; }
    }
    m[h] = matched;
  });
  return m;
}

function parseBool(v) {
  if (v === null || v === undefined || v === '') return false;
  return ['true','1','yes','evet'].includes(String(v).toLowerCase().trim());
}

function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().split('T')[0];
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().split('T')[0];
  }
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

function parseInteger(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v).trim(), 10);
  return isNaN(n) ? null : n;
}

function safeStr(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  // Escape formula injection for exported CSVs/Excel
  if (['+','-','@','='].includes(s[0])) return "'" + s;
  return s;
}

function escapeXML(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function validateRow(rawRow, mapping, membershipTypes, existingCodes, batchCodes, idx) {
  const row = {};
  const errors = [];
  const warnings = [];

  for (const [fileHeader, fieldKey] of Object.entries(mapping)) {
    if (!fieldKey || fieldKey === '__ignore__') continue;
    row[fieldKey] = rawRow[fileHeader];
  }

  // full_name
  const fullName = String(row.full_name || '').trim();
  if (!fullName) errors.push('Ad Soyad zorunludur');

  // email
  const email = String(row.email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.push('Geçersiz e-posta formatı');

  // dates
  const startDate = parseDate(row.membership_start_date);
  const endDate   = parseDate(row.membership_end_date);
  const payDate   = parseDate(row.last_payment_date);

  if (row.membership_start_date && !startDate)
    errors.push('Geçersiz başlangıç tarihi');
  if (row.membership_end_date && !endDate)
    errors.push('Geçersiz bitiş tarihi');
  if (startDate && endDate && endDate < startDate)
    errors.push('Bitiş tarihi başlangıçtan önce olamaz');
  if (row.last_payment_date && !payDate)
    warnings.push('Geçersiz son ödeme tarihi');

  // remaining_lessons
  const lessons = parseInteger(row.remaining_lessons);
  if (row.remaining_lessons !== undefined && row.remaining_lessons !== '' && lessons === null)
    errors.push('Kalan ders sayısı tam sayı olmalı');
  if (lessons !== null && lessons < 0)
    errors.push('Kalan ders sayısı 0 veya daha büyük olmalı');

  // member_level
  const level = parseInteger(row.member_level);
  if (row.member_level !== undefined && row.member_level !== '' && level === null)
    errors.push('Üye seviyesi 1–10 arası tam sayı olmalı');
  if (level !== null && (level < 1 || level > 10))
    errors.push('Üye seviyesi 1–10 arasında olmalı');

  // membership_type
  const mt = String(row.membership_type || '').trim();
  if (mt) {
    const found = membershipTypes.find(t => t.name.toLowerCase() === mt.toLowerCase());
    if (!found) errors.push(`Bilinmeyen paket: "${mt}"`);
  }

  // member_code duplicate
  const code = String(row.member_code || '').trim().toUpperCase();
  let isDuplicate = false;
  if (code) {
    if (existingCodes.has(code)) { isDuplicate = true; }
    else if (batchCodes.has(code)) { errors.push(`Dosyada tekrarlanan üye kodu: ${code}`); }
    else { batchCodes.add(code); }
  } else {
    batchCodes.add(`__auto__${idx}`);
  }

  // studio_id in file: warn and ignore
  if (rawRow['studio_id'] !== undefined)
    warnings.push('studio_id dosyadan alınmaz, otomatik atanır');

  const normalized = {
    full_name:             fullName,
    email:                 email || null,
    phone:                 String(row.phone || '').trim() || null,
    membership_type:       mt || null,
    membership_start_date: startDate,
    membership_end_date:   endDate,
    last_payment_date:     payDate,
    remaining_lessons:     lessons ?? 0,
    is_unlimited:          parseBool(row.is_unlimited),
    member_level:          level ?? 1,
    member_code:           code || null,
    payment_amount:        String(row.payment_amount || '').trim() || null,
    payment_currency:      String(row.payment_currency || '').trim() || null,
    payment_method:        String(row.payment_method || '').trim() || null,
  };

  const status = errors.length > 0 ? 'error'
    : isDuplicate ? 'duplicate'
    : warnings.length > 0 ? 'warning'
    : 'ready';

  return { idx: idx + 1, normalized, errors, warnings, status, isDuplicate };
}

async function parseFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'xml') return parseXML(await file.text());
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: 'array', cellDates: true, cellFormula: false });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { raw: true, defval: '', header: 1 });
  if (!raw.length) return { headers: [], rows: [] };
  const headers = raw[0].map(h => String(h ?? '').trim()).filter(Boolean);
  const rows = raw.slice(1).filter(r => r.some(c => c !== '')).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

function parseXML(text) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(text, 'application/xml');
  const parseError = doc.querySelector('parseerror');
  if (parseError) throw new Error('Geçersiz XML: ' + parseError.textContent.slice(0, 100));
  const members = Array.from(doc.querySelectorAll('member'));
  if (!members.length) throw new Error('<member> elementi bulunamadı');
  const headers = new Set();
  members.forEach(m => Array.from(m.children).forEach(c => headers.add(c.tagName)));
  const hdrs = Array.from(headers);
  const rows = members.map(m => {
    const obj = {};
    hdrs.forEach(h => {
      const el = m.querySelector(h);
      obj[h] = el ? el.textContent.trim() : '';
    });
    return obj;
  });
  return { headers: hdrs, rows };
}

function downloadTemplate() {
  const hdrs = ['full_name','email','phone','membership_type','membership_start_date',
    'membership_end_date','last_payment_date','remaining_lessons','is_unlimited',
    'member_level','member_code','payment_amount','payment_currency','payment_method'];
  const ex   = ['Selay Türkmen','selay@example.com','+905551112233','Premium',
    '2026-10-01','2026-11-01','2026-10-01','8','false','3','','','TRY','Nakit'];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([hdrs, ex]);
  XLSX.utils.book_append_sheet(wb, ws, 'Members');
  XLSX.writeFile(wb, 'studiom_member_import_template.xlsx');
}

function downloadXMLExample() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<members>
  <member>
    <full_name>Selay Türkmen</full_name>
    <email>selay@example.com</email>
    <phone>+905551112233</phone>
    <membership_type>Premium</membership_type>
    <membership_start_date>2026-10-01</membership_start_date>
    <membership_end_date>2026-11-01</membership_end_date>
    <last_payment_date>2026-10-01</last_payment_date>
    <remaining_lessons>8</remaining_lessons>
    <is_unlimited>false</is_unlimited>
    <member_level>3</member_level>
    <member_code></member_code>
    <payment_amount>1500</payment_amount>
    <payment_currency>TRY</payment_currency>
    <payment_method>Nakit</payment_method>
  </member>
</members>`;
  const blob = new Blob([xml], { type: 'application/xml' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'studiom_member_import_example.xml' });
  a.click(); URL.revokeObjectURL(url);
}

function downloadErrorReport(errors) {
  const hdrs = ['row_number','full_name','error'];
  const rows = errors.map(e => [e.row, safeStr(e.full_name), safeStr(e.error)]);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([hdrs, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Errors');
  XLSX.writeFile(wb, 'studiom_import_errors.xlsx');
}

// ── Styles ───────────────────────────────────────────────
const glass  = "bg-white/25 backdrop-blur-xl border border-white/40 shadow-sm rounded-3xl";
const inputC = "w-full bg-white/50 border border-black/10 rounded-xl px-4 py-3 text-sm font-medium placeholder:text-black/30 outline-none focus:border-black/30 focus:bg-white/70 transition";

const STATUS_STYLE = {
  ready:     { cls: 'bg-emerald-400/20 text-emerald-700', label: 'Hazır'   },
  warning:   { cls: 'bg-amber-400/20 text-amber-700',     label: 'Uyarı'   },
  error:     { cls: 'bg-red-400/20 text-red-600',         label: 'Hata'    },
  duplicate: { cls: 'bg-blue-400/20 text-blue-700',       label: 'Tekrar'  },
};

// ── Main Component ───────────────────────────────────────
export default function BulkImportModal({ studioId, membershipTypes, themeColor, onClose, onImportComplete }) {
  const [step,        setStep]        = useState('upload');   // upload|mapping|preview|importing|result
  const [dragging,    setDragging]    = useState(false);
  const [parseError,  setParseError]  = useState('');
  const [fileInfo,    setFileInfo]    = useState(null);
  const [headers,     setHeaders]     = useState([]);
  const [rawRows,     setRawRows]     = useState([]);
  const [mapping,     setMapping]     = useState({});
  const [validated,   setValidated]   = useState([]);
  const [previewTab,  setPreviewTab]  = useState('all');
  const [dupStrategy, setDupStrategy] = useState('skip');
  const [existingCodes, setExistingCodes] = useState(new Set());
  const [importing,   setImporting]   = useState(false);
  const [result,      setResult]      = useState(null);
  const fileRef = useRef(null);

  // ── File handling ──────────────────────────────────────
  async function handleFile(file) {
    setParseError('');
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx','xls','csv','xml'].includes(ext)) {
      setParseError('Desteklenmeyen format. Excel, CSV veya XML yükleyin.'); return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setParseError('Dosya 10 MB limitini aşıyor.'); return;
    }
    try {
      const { headers: hdrs, rows } = await parseFile(file);
      if (!rows.length) { setParseError('Dosyada veri satırı bulunamadı.'); return; }
      if (rows.length > MAX_ROWS) { setParseError(`Maksimum ${MAX_ROWS} satır yüklenebilir (dosyada: ${rows.length}).`); return; }
      setFileInfo({ name: file.name, type: ext, rowCount: rows.length });
      setHeaders(hdrs);
      setRawRows(rows);
      setMapping(autoMatch(hdrs));
      setStep('mapping');
    } catch (e) {
      setParseError('Dosya okunamadı: ' + e.message);
    }
  }

  const onDrop = useCallback(e => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  // ── Validate step ──────────────────────────────────────
  async function goToPreview() {
    // Fetch existing member_codes for this studio
    const { data } = await supabase.from('profiles').select('member_code').eq('studio_id', studioId);
    const codes = new Set((data ?? []).map(r => r.member_code).filter(Boolean));
    setExistingCodes(codes);

    const batchCodes = new Set();
    const results = rawRows.map((row, i) =>
      validateRow(row, mapping, membershipTypes, codes, batchCodes, i)
    );
    setValidated(results);
    setPreviewTab('all');
    setStep('preview');
  }

  // ── Import ─────────────────────────────────────────────
  async function runImport() {
    setStep('importing'); setImporting(true);
    const toSend = validated
      .filter(r => r.status !== 'error' && !(r.status === 'duplicate' && dupStrategy === 'skip'))
      .map(r => r.normalized);

    const { data, error } = await supabase.rpc('import_members', {
      p_rows:               toSend,
      p_duplicate_strategy: dupStrategy,
      p_file_name:          fileInfo?.name,
      p_file_type:          fileInfo?.type,
    });

    setImporting(false);
    if (error) {
      setResult({ rpcError: error.message });
    } else {
      setResult({
        ...data,
        clientErrors: validated.filter(r => r.status === 'error'),
      });
      onImportComplete?.();
    }
    setStep('result');
  }

  // ── Preview filter ─────────────────────────────────────
  const tabs = [
    { key: 'all',       label: 'Tümü',     count: validated.length },
    { key: 'ready',     label: 'Hazır',    count: validated.filter(r => r.status === 'ready').length    },
    { key: 'warning',   label: 'Uyarı',    count: validated.filter(r => r.status === 'warning').length  },
    { key: 'error',     label: 'Hata',     count: validated.filter(r => r.status === 'error').length    },
    { key: 'duplicate', label: 'Tekrar',   count: validated.filter(r => r.status === 'duplicate').length },
  ];
  const visibleRows = previewTab === 'all' ? validated : validated.filter(r => r.status === previewTab);

  const readyCount = validated.filter(r => r.status === 'ready' || r.status === 'warning').length;
  const dupCount   = validated.filter(r => r.status === 'duplicate').length;
  const errCount   = validated.filter(r => r.status === 'error').length;

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[92vh] flex flex-col bg-white/90 backdrop-blur-xl border border-white/60 rounded-3xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-black/5 flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold">Toplu Üye İçe Aktarma</h2>
            <div className="flex items-center gap-2 mt-1.5">
              {['upload','mapping','preview','importing','result'].map((s, i, arr) => (
                <React.Fragment key={s}>
                  <span className="text-xs font-semibold" style={{ color: step === s ? themeColor : 'rgba(0,0,0,0.3)' }}>
                    {['Yükle','Eşleştir','Önizle','İçe Aktar','Sonuç'][i]}
                  </span>
                  {i < arr.length - 1 && <span className="text-black/20 text-xs">›</span>}
                </React.Fragment>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-black/50 font-bold transition">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6">

          {/* ── STEP: UPLOAD ── */}
          {step === 'upload' && (
            <div className="flex flex-col gap-6">
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current.click()}
                className="border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors"
                style={{ borderColor: dragging ? themeColor : 'rgba(0,0,0,0.15)', backgroundColor: dragging ? themeColor + '08' : 'transparent' }}
              >
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.xml" className="sr-only"
                  onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
                <p className="text-4xl mb-3">📂</p>
                <p className="font-bold text-black/70">Üye Dosyası Yükle</p>
                <p className="text-sm text-black/40 mt-1">Sürükle & bırak veya tıkla</p>
                <p className="text-xs text-black/30 mt-2">Excel (.xlsx, .xls), CSV, XML · Maks. 10 MB · Maks. 5.000 satır</p>
                <button type="button" className="mt-5 px-5 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition" style={{ backgroundColor: themeColor }}>
                  Dosya Seç
                </button>
              </div>

              {parseError && (
                <div className="bg-red-50/80 border border-red-200/60 rounded-xl px-4 py-3 text-sm text-red-600 font-medium">
                  ⚠ {parseError}
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={downloadTemplate} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-black/10 bg-white/40 hover:bg-white/60 text-sm font-semibold transition">
                  ⬇ Excel Şablonunu İndir
                </button>
                <button onClick={downloadXMLExample} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-black/10 bg-white/40 hover:bg-white/60 text-sm font-semibold transition">
                  ⬇ XML Örneğini İndir
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: MAPPING ── */}
          {step === 'mapping' && (
            <div className="flex flex-col gap-5">
              <div className="bg-emerald-400/10 border border-emerald-300/40 rounded-xl px-4 py-3 text-sm font-medium text-emerald-700">
                ✓ <strong>{fileInfo?.name}</strong> — {fileInfo?.rowCount} satır okundu
              </div>
              <div>
                <p className="text-sm font-semibold text-black/50 mb-3">Dosya kolonlarını Studiom alanlarıyla eşleştirin:</p>
                <div className="flex flex-col gap-2">
                  {headers.map(h => (
                    <div key={h} className="grid grid-cols-2 gap-4 items-center bg-white/40 border border-white/60 rounded-xl px-4 py-3">
                      <span className="text-sm font-semibold text-black/70">{h}</span>
                      <select
                        value={mapping[h] || ''}
                        onChange={e => setMapping(prev => ({ ...prev, [h]: e.target.value }))}
                        className={inputC}
                      >
                        <option value="">— Yoksay —</option>
                        {SYSTEM_FIELDS.filter(f => f.key !== '__ignore__').map(f => (
                          <option key={f.key} value={f.key}>
                            {f.label}{f.required ? ' *' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              {!Object.values(mapping).includes('full_name') && (
                <p className="text-sm text-amber-600 font-medium">⚠ "Ad Soyad" alanı eşleştirilmedi — zorunludur.</p>
              )}
            </div>
          )}

          {/* ── STEP: PREVIEW ── */}
          {step === 'preview' && (
            <div className="flex flex-col gap-5">
              {/* Summary */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Toplam',  value: validated.length, color: 'text-black' },
                  { label: 'Hazır',   value: readyCount, color: 'text-emerald-700' },
                  { label: 'Hata',    value: errCount, color: 'text-red-600' },
                  { label: 'Tekrar',  value: dupCount, color: 'text-blue-700' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-white/40 border border-white/60 rounded-2xl p-4 text-center">
                    <p className={`text-2xl font-bold ${color}`}>{value}</p>
                    <p className="text-xs text-black/40 font-medium mt-1">{label}</p>
                  </div>
                ))}
              </div>

              {/* Duplicate strategy */}
              {dupCount > 0 && (
                <div className="flex items-center justify-between bg-blue-50/60 border border-blue-200/40 rounded-xl px-4 py-3">
                  <p className="text-sm font-semibold text-blue-700">{dupCount} tekrarlayan üye kodu bulundu</p>
                  <div className="flex gap-2">
                    {['skip','update'].map(s => (
                      <button key={s} onClick={() => setDupStrategy(s)}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold transition"
                        style={dupStrategy === s ? { backgroundColor: themeColor, color: '#fff' } : { backgroundColor: 'rgba(0,0,0,0.06)' }}>
                        {s === 'skip' ? 'Atla' : 'Güncelle'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Tabs */}
              <div className="flex gap-1 bg-black/5 rounded-xl p-1">
                {tabs.filter(t => t.count > 0 || t.key === 'all').map(t => (
                  <button key={t.key} onClick={() => setPreviewTab(t.key)}
                    className="flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition"
                    style={previewTab === t.key ? { backgroundColor: themeColor, color: '#fff' } : {}}>
                    {t.label} ({t.count})
                  </button>
                ))}
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-2xl border border-white/60">
                <table className="w-full text-sm">
                  <thead className="bg-white/40">
                    <tr>
                      {['#','Ad Soyad','E-posta','Paket','Bitiş','Durum'].map(c => (
                        <th key={c} className="text-left px-4 py-2.5 text-xs font-bold text-black/50 uppercase tracking-wider whitespace-nowrap">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.slice(0, 100).map(r => {
                      const st = STATUS_STYLE[r.status];
                      return (
                        <tr key={r.idx} className="border-t border-black/5 hover:bg-white/20 transition">
                          <td className="px-4 py-2.5 text-black/40 text-xs">{r.idx}</td>
                          <td className="px-4 py-2.5 font-medium">{r.normalized.full_name || <span className="text-red-400">—</span>}</td>
                          <td className="px-4 py-2.5 text-black/50 text-xs">{r.normalized.email || '—'}</td>
                          <td className="px-4 py-2.5 text-black/50 text-xs">{r.normalized.membership_type || '—'}</td>
                          <td className="px-4 py-2.5 text-black/50 text-xs">{r.normalized.membership_end_date || '—'}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col gap-1">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold w-fit ${st.cls}`}>{st.label}</span>
                              {[...r.errors, ...r.warnings].map((msg, i) => (
                                <span key={i} className="text-[10px] text-red-500/70 leading-tight">{msg}</span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {visibleRows.length > 100 && (
                      <tr><td colSpan={6} className="px-4 py-3 text-center text-xs text-black/30">+{visibleRows.length - 100} satır daha (ilk 100 gösteriliyor)</td></tr>
                    )}
                    {visibleRows.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-6 text-center text-black/30">Bu filtrede satır yok.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── STEP: IMPORTING ── */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-20 gap-5">
              <div className="w-14 h-14 rounded-full border-4 border-black/10 animate-spin" style={{ borderTopColor: themeColor }} />
              <p className="font-semibold text-black/60">İçe aktarılıyor...</p>
            </div>
          )}

          {/* ── STEP: RESULT ── */}
          {step === 'result' && result && (
            <div className="flex flex-col gap-6">
              {result.rpcError ? (
                <div className="bg-red-50/80 border border-red-200/60 rounded-xl px-4 py-4 text-sm text-red-600 font-medium">
                  ⚠ Sunucu hatası: {result.rpcError}
                </div>
              ) : (
                <>
                  <div className="text-center py-4">
                    <p className="text-5xl mb-3">✅</p>
                    <h3 className="text-2xl font-bold">İçe Aktarma Tamamlandı</h3>
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: 'İçe Aktarıldı', value: result.imported, color: 'text-emerald-700' },
                      { label: 'Güncellendi',    value: result.updated,  color: 'text-blue-700'    },
                      { label: 'Atlandı',        value: result.skipped,  color: 'text-amber-700'   },
                      { label: 'Başarısız',      value: result.failed + (result.clientErrors?.length ?? 0), color: 'text-red-600' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-white/40 border border-white/60 rounded-2xl p-4 text-center">
                        <p className={`text-2xl font-bold ${color}`}>{value}</p>
                        <p className="text-xs text-black/40 font-medium mt-1">{label}</p>
                      </div>
                    ))}
                  </div>
                  {(result.errors?.length > 0 || result.clientErrors?.length > 0) && (
                    <div className="flex flex-col gap-2">
                      <p className="text-sm font-semibold text-black/50">Hata detayları:</p>
                      <div className="max-h-40 overflow-y-auto flex flex-col gap-1.5">
                        {[...(result.errors ?? []), ...(result.clientErrors ?? []).map(e => ({
                          row: e.idx, full_name: e.normalized.full_name, error: e.errors.join(', ')
                        }))].map((e, i) => (
                          <div key={i} className="bg-red-50/60 border border-red-100 rounded-xl px-3 py-2 text-xs">
                            <span className="font-bold text-red-600">Satır {e.row}:</span>
                            <span className="text-red-500/80 ml-2">{e.full_name}</span>
                            <span className="text-red-400 ml-2">— {e.error}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-8 py-5 border-t border-black/5 flex-shrink-0 gap-3">
          <div className="flex gap-2">
            {step === 'result' && !result?.rpcError && (result.errors?.length > 0 || result.clientErrors?.length > 0) && (
              <button
                onClick={() => downloadErrorReport([
                  ...(result.errors ?? []),
                  ...(result.clientErrors ?? []).map(e => ({ row: e.idx, full_name: e.normalized.full_name, error: e.errors.join(', ') }))
                ])}
                className="px-4 py-2.5 rounded-xl border border-black/10 bg-white/40 hover:bg-white/60 text-sm font-semibold transition"
              >
                ⬇ Hata Raporunu İndir
              </button>
            )}
            {step === 'result' && (
              <button
                onClick={() => { setStep('upload'); setFileInfo(null); setHeaders([]); setRawRows([]); setMapping({}); setValidated([]); setResult(null); }}
                className="px-4 py-2.5 rounded-xl border border-black/10 bg-white/40 hover:bg-white/60 text-sm font-semibold transition"
              >
                Yeni Dosya Yükle
              </button>
            )}
          </div>
          <div className="flex gap-2 ml-auto">
            {step === 'upload' && (
              <button onClick={onClose} className="px-5 py-2.5 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 text-sm font-semibold transition">İptal</button>
            )}
            {step === 'mapping' && (
              <>
                <button onClick={() => setStep('upload')} className="px-5 py-2.5 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 text-sm font-semibold transition">Geri</button>
                <button
                  onClick={goToPreview}
                  disabled={!Object.values(mapping).includes('full_name')}
                  style={{ backgroundColor: themeColor }}
                  className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition"
                >
                  Doğrula & Önizle →
                </button>
              </>
            )}
            {step === 'preview' && (
              <>
                <button onClick={() => setStep('mapping')} className="px-5 py-2.5 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 text-sm font-semibold transition">Geri</button>
                <button
                  onClick={runImport}
                  disabled={readyCount + (dupStrategy === 'update' ? dupCount : 0) === 0}
                  style={{ backgroundColor: themeColor }}
                  className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition"
                >
                  {readyCount + (dupStrategy === 'update' ? dupCount : 0)} Üyeyi İçe Aktar →
                </button>
              </>
            )}
            {step === 'result' && (
              <button onClick={onClose} style={{ backgroundColor: themeColor }} className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition">
                Üyeleri Görüntüle
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
