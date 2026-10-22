import React, { useState, useRef } from 'react';
import { supabase } from '../supabaseClient';

const inputC    = "w-full bg-white/50 border border-black/10 rounded-xl px-4 py-3 text-sm font-medium placeholder:text-black/30 outline-none focus:border-black/30 focus:bg-white/70 transition";
const MAX_BYTES = 5 * 1024 * 1024;

export default function QuickAddInstructorModal({ studioId, themeColor, existingInstructors = [], onClose, onCreated }) {
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '', specialties: '', instagram_url: '', bio: '',
  });
  const [photoFile,    setPhotoFile]    = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [error,        setError]        = useState('');
  const [saving,       setSaving]       = useState(false);
  const photoRef = useRef(null);

  const setField = key => e => { setForm(f => ({ ...f, [key]: e.target.value })); setError(''); };

  // Real-time duplicate warnings (soft — doesn't block)
  function getDuplicateWarning() {
    const name  = form.full_name.trim().toLowerCase();
    const phone = form.phone.trim();
    const email = form.email.trim().toLowerCase();
    if (phone && existingInstructors.some(i => i.phone === phone))
      return 'Bu telefon numarasıyla kayıtlı bir eğitmen zaten var.';
    if (email && email.includes('@') && existingInstructors.some(i => i.email?.toLowerCase() === email))
      return 'Bu e-posta adresiyle kayıtlı bir eğitmen zaten var.';
    if (name.length > 1 && existingInstructors.some(i => i.full_name.toLowerCase() === name))
      return 'Bu isimde bir eğitmen zaten bulunuyor.';
    return null;
  }

  function handlePhotoSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
      setError('Yalnızca JPG, PNG veya WEBP desteklenir.'); return;
    }
    if (file.size > MAX_BYTES) { setError('Fotoğraf 5 MB limitini aşıyor.'); return; }
    setError('');
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    e.target.value = '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.full_name.trim()) { setError('Ad Soyad zorunludur.'); return; }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Geçersiz e-posta formatı.'); return;
    }
    setSaving(true); setError('');

    const specialties = form.specialties.split(',').map(s => s.trim()).filter(Boolean);

    const { data: inserted, error: insertErr } = await supabase.from('instructors').insert({
      studio_id:     studioId,
      full_name:     form.full_name.trim(),
      phone:         form.phone.trim()         || null,
      email:         form.email.trim()         || null,
      specialties:   specialties.length ? specialties : null,
      instagram_url: form.instagram_url.trim() || null,
      bio:           form.bio.trim()           || null,
      is_active:     true,
    }).select().single();

    if (insertErr) {
      setSaving(false);
      setError('Eğitmen eklenemedi. Lütfen tekrar deneyin.');
      return;
    }

    // Upload photo if selected (fire-and-forget style; won't block onCreated)
    let profileImageUrl = null;
    if (photoFile) {
      const ext  = photoFile.name.split('.').pop().toLowerCase();
      const path = `instructors/${studioId}/${inserted.id}/profile_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('studio-assets').upload(path, photoFile, { upsert: true });
      if (!upErr) {
        const { data: { publicUrl } } = supabase.storage.from('studio-assets').getPublicUrl(path);
        profileImageUrl = publicUrl;
        await supabase.from('instructors').update({ profile_image_url: profileImageUrl }).eq('id', inserted.id);
      }
    }

    setSaving(false);
    onCreated({ ...inserted, profile_image_url: profileImageUrl, phone: form.phone.trim() || null, email: form.email.trim() || null });
  }

  const duplicateWarning = getDuplicateWarning();

  return (
    // z-[70] so it sits above the z-50 class modal
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={saving ? undefined : onClose}
    >
      <div
        className="w-full max-w-md max-h-[88vh] overflow-y-auto bg-white/96 backdrop-blur-xl border border-white/60 rounded-3xl shadow-2xl p-7"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 className="text-lg font-bold">Yeni Eğitmen</h3>
            <p className="text-xs text-black/40 mt-0.5">Eklendikten sonra otomatik seçilecek</p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-black/50 font-bold transition disabled:opacity-30"
          >✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Profile photo */}
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/40 border-2 border-dashed border-black/15 overflow-hidden flex-shrink-0 flex items-center justify-center">
              {photoPreview
                ? <img src={photoPreview} alt="" className="w-full h-full object-cover" />
                : <span className="text-2xl opacity-20">📷</span>
              }
            </div>
            <div>
              <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handlePhotoSelect} />
              <button type="button" onClick={() => photoRef.current.click()} style={{ color: themeColor }}
                className="text-sm font-semibold hover:opacity-70 transition">
                {photoPreview ? 'Fotoğrafı Değiştir' : 'Fotoğraf Ekle'}
              </button>
              <p className="text-xs text-black/30 mt-0.5">JPG, PNG, WEBP · Kare önerilir</p>
            </div>
          </div>

          {/* Full name */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-black/50">Ad Soyad *</label>
            <input type="text" value={form.full_name} onChange={setField('full_name')}
              placeholder="Selay Türkmen" className={inputC} autoFocus />
            {duplicateWarning && (
              <p className="text-xs text-amber-600 font-medium">⚠ {duplicateWarning}</p>
            )}
          </div>

          {/* Phone + Email */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-semibold text-black/50">Telefon</label>
              <input type="tel" value={form.phone} onChange={setField('phone')}
                placeholder="+90 555 000 0000" className={inputC} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-semibold text-black/50">E-posta</label>
              <input type="email" value={form.email} onChange={setField('email')}
                placeholder="selay@studio.com" className={inputC} />
            </div>
          </div>

          {/* Specialties */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-black/50">Uzmanlık Alanları</label>
            <input type="text" value={form.specialties} onChange={setField('specialties')}
              placeholder="Reformer, Pilates, Mobility" className={inputC} />
            <p className="text-[11px] text-black/30">Virgülle ayırın</p>
          </div>

          {/* Instagram */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-black/50">Instagram</label>
            <input type="text" value={form.instagram_url} onChange={setField('instagram_url')}
              placeholder="@eğitmenadi" className={inputC} />
          </div>

          {/* Bio */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-black/50">Kısa Bio</label>
            <textarea value={form.bio} onChange={setField('bio')}
              placeholder="Eğitmen hakkında kısa bilgi..." rows={2}
              className={inputC + ' resize-none'} />
          </div>

          {error && <p className="text-sm text-red-500/80 font-medium">{error}</p>}

          <div className="flex gap-3 mt-1">
            <button type="button" onClick={onClose} disabled={saving}
              className="flex-1 py-3 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 font-semibold text-sm transition disabled:opacity-40">
              İptal
            </button>
            <button type="submit" disabled={saving} style={{ backgroundColor: themeColor }}
              className="flex-1 py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition">
              {saving ? 'Eğitmen Ekleniyor...' : 'Eğitmeni Ekle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
