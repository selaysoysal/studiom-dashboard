import React, { useState, useRef } from 'react';
import { supabase } from '../supabaseClient';

const glassStyle = "bg-white/25 backdrop-blur-xl border border-white/40 shadow-sm rounded-3xl";
const inputClass = "w-full bg-white/50 border border-black/10 rounded-xl px-4 py-3 text-sm font-medium placeholder:text-black/30 outline-none focus:border-black/30 focus:bg-white/70 transition";

function ColorField({ label, value, onChange }) {
  const ref = useRef(null);
  const [hex, setHex] = useState(value);
  const [hexError, setHexError] = useState(false);

  function handleHexInput(e) {
    const v = e.target.value;
    setHex(v);
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
      setHexError(false);
      onChange(v);
    } else {
      setHexError(true);
    }
  }

  function handlePicker(e) {
    const v = e.target.value;
    setHex(v);
    setHexError(false);
    onChange(v);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-semibold text-black/50">{label}</label>
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl shadow-sm flex-shrink-0 cursor-pointer border border-white/60"
          style={{ backgroundColor: /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : value }}
          onClick={() => ref.current.click()}
        />
        <input ref={ref} type="color" value={/^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : value} onChange={handlePicker} className="sr-only" />
        <input
          type="text"
          value={hex}
          onChange={handleHexInput}
          placeholder="#000000"
          maxLength={7}
          className={`${inputClass} font-mono ${hexError ? 'border-red-300 bg-red-50/30' : ''}`}
        />
      </div>
      {hexError && <p className="text-xs text-red-500/70">Geçerli bir hex renk kodu girin (#RRGGBB)</p>}
    </div>
  );
}

export default function StudioSettings({
  studioId, themeColor, setThemeColor, secondaryColor, setSecondaryColor,
  logoUrl, setLogoUrl, studioCode, showToast,
}) {
  const logoInputRef = useRef(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);

  React.useEffect(() => {
    if (!studioId) return;
    supabase.from('studios')
      .select('name, phone, email, website, address, city, instagram_url, description')
      .eq('id', studioId)
      .single()
      .then(({ data }) => {
        if (data) setForm({
          name: data.name ?? '',
          phone: data.phone ?? '',
          email: data.email ?? '',
          website: data.website ?? '',
          address: data.address ?? '',
          city: data.city ?? '',
          instagram_url: data.instagram_url ?? '',
          description: data.description ?? '',
        });
      });
  }, [studioId]);

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    const ext = file.name.split('.').pop();
    const filePath = `logos/${studioId}/logo_${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from('studio-assets').upload(filePath, file, { upsert: true });
    if (!uploadError) {
      const { data: { publicUrl } } = supabase.storage.from('studio-assets').getPublicUrl(filePath);
      await supabase.from('studios').update({ logo_url: publicUrl }).eq('id', studioId);
      setLogoUrl(publicUrl);
      showToast(true, 'Logo güncellendi.');
    } else {
      showToast(false, 'Logo yüklenemedi.');
    }
    setLogoUploading(false);
    e.target.value = '';
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    const { error } = await supabase.from('studios').update({
      ...form,
      theme_color: themeColor,
      secondary_color: secondaryColor,
    }).eq('id', studioId);
    setSaving(false);
    if (error) showToast(false, 'Kaydetme sırasında hata oluştu.');
    else showToast(true, 'Stüdyo ayarları kaydedildi.');
  }

  if (!form) return <div className="py-20 text-center text-black/40">Yükleniyor...</div>;

  function field(key, label, placeholder, type = 'text') {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-semibold text-black/50">{label}</label>
        {type === 'textarea' ? (
          <textarea
            value={form[key]}
            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            placeholder={placeholder}
            rows={3}
            className={inputClass + ' resize-none'}
          />
        ) : (
          <input
            type={type}
            value={form[key]}
            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            placeholder={placeholder}
            className={inputClass}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="mt-2">
        <h1 className="text-3xl font-bold">Stüdyo Ayarları</h1>
        <p className="text-black/60 mt-1 font-medium">Stüdyo bilgilerini ve görünümünü yönetin</p>
      </header>

      <div className="grid grid-cols-3 gap-6">
        <form onSubmit={handleSave} className="col-span-2 flex flex-col gap-5">

          {/* Logo */}
          <div className={`${glassStyle} p-6 flex flex-col gap-4`}>
            <h2 className="text-base font-bold">Logo & Görünüm</h2>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-white/40 border border-white/60 flex items-center justify-center overflow-hidden flex-shrink-0">
                {logoUrl
                  ? <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
                  : <span style={{ color: themeColor }} className="font-bold text-xl">S</span>
                }
              </div>
              <div>
                <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="sr-only" />
                <button
                  type="button"
                  onClick={() => logoInputRef.current.click()}
                  disabled={logoUploading}
                  style={{ color: themeColor }}
                  className="text-sm font-semibold hover:opacity-70 disabled:opacity-40 transition"
                >
                  {logoUploading ? 'Yükleniyor...' : 'Logo Değiştir'}
                </button>
                <p className="text-xs text-black/30 mt-1">PNG veya JPG. Kare format önerilir.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <ColorField label="Ana Tema Rengi" value={themeColor} onChange={setThemeColor} />
              <ColorField label="İkincil Renk" value={secondaryColor} onChange={setSecondaryColor} />
            </div>
          </div>

          {/* Studio Info */}
          <div className={`${glassStyle} p-6 flex flex-col gap-4`}>
            <h2 className="text-base font-bold">Stüdyo Bilgileri</h2>
            {field('name', 'Stüdyo Adı', 'Pilates Studio')}
            <div className="grid grid-cols-2 gap-4">
              {field('phone', 'Telefon', '+90 212 000 00 00')}
              {field('email', 'E-posta', 'info@studio.com', 'email')}
            </div>
            {field('website', 'Website', 'https://www.studio.com')}
            <div className="grid grid-cols-2 gap-4">
              {field('city', 'Şehir', 'İstanbul')}
              {field('address', 'Adres', 'Bağdat Caddesi No:1')}
            </div>
            {field('instagram_url', 'Instagram', '@studiom')}
            {field('description', 'Açıklama', 'Stüdyo hakkında kısa açıklama...', 'textarea')}
          </div>

          {/* Studio Code (read-only) */}
          <div className={`${glassStyle} p-6 flex flex-col gap-3`}>
            <h2 className="text-base font-bold">Teknik Bilgiler</h2>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-black/50">Stüdyo Kodu</label>
              <div className="bg-white/30 border border-white/50 rounded-xl px-4 py-3">
                <span className="font-mono font-bold tracking-widest text-sm text-black/50">{studioCode || '—'}</span>
              </div>
              <p className="text-xs text-black/30">Dahili stüdyo tanımlayıcısı.</p>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            style={{ backgroundColor: themeColor }}
            className="py-3.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition"
          >
            {saving ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
          </button>
        </form>

        {/* Preview */}
        <div className="col-span-1 flex flex-col gap-4">
          <div className={`${glassStyle} p-5 flex flex-col gap-3`}>
            <h2 className="text-sm font-bold text-black/50 uppercase tracking-wider">Renk Önizleme</h2>
            <div className="rounded-2xl overflow-hidden border border-white/50">
              <div className="p-4 flex items-center gap-3" style={{ backgroundColor: themeColor }}>
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center overflow-hidden">
                  {logoUrl
                    ? <img src={logoUrl} alt="" className="w-full h-full object-cover" />
                    : <span className="text-white font-bold text-sm">S</span>
                  }
                </div>
                <div>
                  <p className="text-white font-bold text-sm">{form.name || 'Stüdyo Adı'}</p>
                  <p className="text-white/70 text-xs">{form.city || 'Şehir'}</p>
                </div>
              </div>
              <div className="bg-white/80 p-4 flex flex-col gap-2">
                <div className="h-2 rounded-full w-3/4" style={{ backgroundColor: themeColor }} />
                <div className="h-2 rounded-full w-1/2" style={{ backgroundColor: secondaryColor }} />
                <div className="flex gap-2 mt-2">
                  <div className="flex-1 py-2 rounded-xl text-center text-xs font-bold text-white" style={{ backgroundColor: themeColor }}>
                    Ana Renk
                  </div>
                  <div className="flex-1 py-2 rounded-xl text-center text-xs font-bold" style={{ backgroundColor: secondaryColor, color: themeColor }}>
                    İkincil
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 flex flex-col items-center gap-1">
                <div className="w-8 h-8 rounded-lg" style={{ backgroundColor: themeColor }} />
                <p className="text-[10px] font-mono text-black/40">{themeColor}</p>
              </div>
              <div className="flex-1 flex flex-col items-center gap-1">
                <div className="w-8 h-8 rounded-lg" style={{ backgroundColor: secondaryColor }} />
                <p className="text-[10px] font-mono text-black/40">{secondaryColor}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
