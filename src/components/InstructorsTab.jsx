import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';

const glass     = "bg-white/25 backdrop-blur-xl border border-white/40 shadow-sm rounded-3xl";
const inputC    = "w-full bg-white/50 border border-black/10 rounded-xl px-4 py-3 text-sm font-medium placeholder:text-black/30 outline-none focus:border-black/30 focus:bg-white/70 transition";
const MAX_BYTES = 5 * 1024 * 1024;

const EMPTY = {
  full_name: '', email: '', phone: '', bio: '',
  specialties: '', instagram_url: '', is_active: true,
};

function Avatar({ instr, themeColor, size = 'md' }) {
  const sz  = size === 'lg' ? 'w-20 h-20 text-2xl' : size === 'sm' ? 'w-9 h-9 text-sm' : 'w-14 h-14 text-lg';
  const rnd = size === 'lg' ? 'rounded-3xl' : 'rounded-2xl';
  if (instr.profile_image_url)
    return <img src={instr.profile_image_url} alt={instr.full_name} className={`${sz} ${rnd} object-cover flex-shrink-0`} />;
  return (
    <div className={`${sz} ${rnd} flex items-center justify-center text-white font-bold flex-shrink-0`} style={{ backgroundColor: themeColor }}>
      {instr.full_name?.charAt(0).toUpperCase()}
    </div>
  );
}

export default function InstructorsTab({ studioId, themeColor, showToast }) {
  const [instructors,   setInstructors]   = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [classCounts,   setClassCounts]   = useState({});
  const [showModal,     setShowModal]     = useState(false);
  const [editing,       setEditing]       = useState(null);
  const [form,          setForm]          = useState(EMPTY);
  const [formError,     setFormError]     = useState('');
  const [saving,        setSaving]        = useState(false);
  const [photoFile,     setPhotoFile]     = useState(null);
  const [photoPreview,  setPhotoPreview]  = useState(null);
  const [photoLoading,  setPhotoLoading]  = useState(false);
  const [detail,        setDetail]        = useState(null);
  const [detailClasses, setDetailClasses] = useState([]);
  const photoRef = useRef(null);

  useEffect(() => { if (studioId) { fetch_(); fetchCounts(); } }, [studioId]);

  async function fetch_() {
    setLoading(true);
    const { data } = await supabase
      .from('instructors').select('*').eq('studio_id', studioId)
      .order('display_order').order('full_name');
    setInstructors(data ?? []);
    setLoading(false);
  }

  async function fetchCounts() {
    const { data } = await supabase
      .from('classes').select('instructor_id').eq('studio_id', studioId)
      .gte('start_time', new Date().toISOString()).not('instructor_id', 'is', null);
    const c = {};
    (data ?? []).forEach(r => { if (r.instructor_id) c[r.instructor_id] = (c[r.instructor_id] || 0) + 1; });
    setClassCounts(c);
  }

  async function fetchDetailClasses(instrId) {
    const { data } = await supabase
      .from('classes').select('id, title, start_time, end_time, current_capacity, max_capacity')
      .eq('studio_id', studioId).eq('instructor_id', instrId)
      .gte('start_time', new Date().toISOString()).order('start_time').limit(10);
    setDetailClasses(data ?? []);
  }

  function openAdd() {
    setEditing(null); setForm(EMPTY); setFormError('');
    setPhotoFile(null); setPhotoPreview(null); setShowModal(true);
  }

  function openEdit(instr) {
    setEditing(instr);
    setForm({
      full_name:     instr.full_name,
      email:         instr.email         ?? '',
      phone:         instr.phone         ?? '',
      bio:           instr.bio           ?? '',
      specialties:   (instr.specialties  ?? []).join(', '),
      instagram_url: instr.instagram_url ?? '',
      is_active:     instr.is_active,
    });
    setFormError('');
    setPhotoFile(null);
    setPhotoPreview(instr.profile_image_url || null);
    setShowModal(true);
  }

  function handlePhotoSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
      setFormError('Yalnızca JPG, PNG veya WEBP desteklenir.'); return;
    }
    if (file.size > MAX_BYTES) { setFormError('Fotoğraf 5 MB limitini aşıyor.'); return; }
    setFormError('');
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    e.target.value = '';
  }

  async function uploadPhoto(instrId) {
    if (!photoFile) return editing?.profile_image_url ?? null;
    setPhotoLoading(true);
    // Remove orphan if replacing
    if (editing?.profile_image_url) {
      const old = editing.profile_image_url.split('/studio-assets/')[1];
      if (old) await supabase.storage.from('studio-assets').remove([old]);
    }
    const ext  = photoFile.name.split('.').pop().toLowerCase();
    const path = `instructors/${studioId}/${instrId}/profile_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('studio-assets').upload(path, photoFile, { upsert: true });
    setPhotoLoading(false);
    if (error) { showToast(false, 'Fotoğraf yüklenemedi.'); return null; }
    const { data: { publicUrl } } = supabase.storage.from('studio-assets').getPublicUrl(path);
    return publicUrl;
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.full_name.trim()) { setFormError('Ad Soyad zorunludur.'); return; }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setFormError('Geçersiz e-posta formatı.'); return;
    }
    setSaving(true); setFormError('');
    const specialties = form.specialties.split(',').map(s => s.trim()).filter(Boolean);

    if (editing) {
      const photoUrl = await uploadPhoto(editing.id);
      const { error } = await supabase.from('instructors').update({
        full_name:         form.full_name.trim(),
        email:             form.email.trim()         || null,
        phone:             form.phone.trim()         || null,
        bio:               form.bio.trim()           || null,
        specialties:       specialties.length ? specialties : null,
        instagram_url:     form.instagram_url.trim() || null,
        is_active:         form.is_active,
        profile_image_url: photoUrl,
        updated_at:        new Date().toISOString(),
      }).eq('id', editing.id);
      setSaving(false);
      if (error) { setFormError(error.message); return; }
      showToast(true, 'Eğitmen güncellendi.');
    } else {
      const { data: inserted, error: insertErr } = await supabase.from('instructors').insert({
        studio_id:     studioId,
        full_name:     form.full_name.trim(),
        email:         form.email.trim()         || null,
        phone:         form.phone.trim()         || null,
        bio:           form.bio.trim()           || null,
        specialties:   specialties.length ? specialties : null,
        instagram_url: form.instagram_url.trim() || null,
        is_active:     form.is_active,
      }).select().single();
      if (insertErr) { setSaving(false); setFormError(insertErr.message); return; }
      if (photoFile) {
        const photoUrl = await uploadPhoto(inserted.id);
        if (photoUrl) await supabase.from('instructors').update({ profile_image_url: photoUrl }).eq('id', inserted.id);
      }
      setSaving(false);
      showToast(true, `${form.full_name.trim()} eklendi.`);
    }
    setShowModal(false); fetch_(); fetchCounts();
  }

  async function handleToggleActive(instr) {
    const { error } = await supabase.from('instructors')
      .update({ is_active: !instr.is_active, updated_at: new Date().toISOString() })
      .eq('id', instr.id);
    if (error) showToast(false, 'Güncelleme başarısız.');
    else { showToast(true, instr.is_active ? 'Pasifleştirildi.' : 'Aktifleştirildi.'); fetch_(); }
  }

  function openDetail(instr) { setDetail(instr); fetchDetailClasses(instr.id); }

  const activeCount   = instructors.filter(i => i.is_active).length;
  const inactiveCount = instructors.filter(i => !i.is_active).length;

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <header className="flex items-center justify-between mt-2">
        <div>
          <h1 className="text-3xl font-bold">Eğitmenler</h1>
          <p className="text-black/60 mt-1 font-medium">Stüdyonuzdaki eğitmenleri yönetin ve derslerle eşleştirin.</p>
        </div>
        <button onClick={openAdd} style={{ backgroundColor: themeColor }}
          className="flex items-center gap-2 text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:opacity-90 transition shadow-sm">
          <span className="text-lg leading-none">+</span> Yeni Eğitmen
        </button>
      </header>

      {/* Stats */}
      {instructors.length > 0 && (
        <div className="flex gap-3">
          {[
            { label: 'Toplam', value: instructors.length, color: 'text-black'       },
            { label: 'Aktif',  value: activeCount,        color: 'text-emerald-700' },
            { label: 'Pasif',  value: inactiveCount,      color: 'text-black/40'    },
          ].map(s => (
            <div key={s.label} className={`${glass} px-5 py-3 flex items-center gap-3`}>
              <span className={`text-2xl font-bold ${s.color}`}>{s.value}</span>
              <span className="text-sm text-black/40 font-medium">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="py-20 text-center text-black/40">Yükleniyor...</div>
      ) : instructors.length === 0 ? (
        <div className={`${glass} p-16 flex flex-col items-center gap-4`}>
          <span className="text-5xl opacity-20">👩‍🏫</span>
          <p className="font-semibold text-black/40">Henüz eğitmen eklenmedi.</p>
          <button onClick={openAdd} style={{ backgroundColor: themeColor }}
            className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition">
            İlk Eğitmeni Ekle
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {instructors.map(instr => {
            const count = classCounts[instr.id] || 0;
            return (
              <div key={instr.id} className={`${glass} p-5 flex flex-col gap-4 cursor-pointer hover:bg-white/35 transition`}
                onClick={() => openDetail(instr)}>
                <div className="flex items-start gap-4">
                  <Avatar instr={instr} themeColor={themeColor} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-base">{instr.full_name}</p>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${instr.is_active ? 'bg-emerald-400/20 text-emerald-700' : 'bg-black/10 text-black/40'}`}>
                        {instr.is_active ? 'Aktif' : 'Pasif'}
                      </span>
                    </div>
                    {instr.specialties?.length > 0 && (
                      <p className="text-xs text-black/50 mt-1 leading-relaxed">{instr.specialties.join(' • ')}</p>
                    )}
                    {instr.email && <p className="text-xs text-black/30 mt-0.5">{instr.email}</p>}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-black/40 font-medium">
                    {count > 0 ? `${count} yaklaşan ders` : 'Planlanmış ders yok'}
                  </span>
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <button onClick={() => openEdit(instr)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/60 border border-white/70 hover:bg-white/80 transition">
                      Düzenle
                    </button>
                    <button onClick={() => handleToggleActive(instr)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/60 border border-white/70 hover:bg-white/80 transition">
                      {instr.is_active ? 'Pasifleştir' : 'Aktifleştir'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── ADD / EDIT MODAL ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4"
          onClick={() => setShowModal(false)}>
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white/90 backdrop-blur-xl border border-white/60 rounded-3xl shadow-2xl p-8"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-7">
              <h3 className="text-xl font-bold">{editing ? 'Eğitmeni Düzenle' : 'Yeni Eğitmen Ekle'}</h3>
              <button onClick={() => setShowModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-black/50 font-bold transition">✕</button>
            </div>
            <form onSubmit={handleSave} className="flex flex-col gap-5">
              {/* Photo */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-black/50">Profil Fotoğrafı</label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-white/40 border-2 border-dashed border-black/15 overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {photoPreview
                      ? <img src={photoPreview} alt="" className="w-full h-full object-cover" />
                      : <span className="text-3xl opacity-20">📷</span>
                    }
                  </div>
                  <div>
                    <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handlePhotoSelect} />
                    <button type="button" onClick={() => photoRef.current.click()} style={{ color: themeColor }}
                      className="text-sm font-semibold hover:opacity-70 transition">
                      {photoPreview ? 'Fotoğrafı Değiştir' : 'Fotoğraf Seç'}
                    </button>
                    <p className="text-xs text-black/30 mt-0.5">JPG, PNG veya WEBP · Maks. 5 MB · Kare önerilir</p>
                  </div>
                </div>
              </div>

              {/* Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-black/50">Ad Soyad *</label>
                <input type="text" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="Selay Türkmen" className={inputC} />
              </div>

              {/* Email & Phone */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-black/50">E-posta</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="selay@studio.com" className={inputC} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-black/50">Telefon</label>
                  <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="+90 555 123 4567" className={inputC} />
                </div>
              </div>

              {/* Specialties */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-black/50">Uzmanlık Alanları</label>
                <input type="text" value={form.specialties} onChange={e => setForm(f => ({ ...f, specialties: e.target.value }))}
                  placeholder="Reformer, Pilates, Mobility (virgülle ayırın)" className={inputC} />
              </div>

              {/* Bio */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-black/50">Bio</label>
                <textarea value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
                  placeholder="Eğitmen hakkında kısa bilgi..." rows={3} className={inputC + ' resize-none'} />
              </div>

              {/* Instagram */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-black/50">Instagram</label>
                <input type="text" value={form.instagram_url} onChange={e => setForm(f => ({ ...f, instagram_url: e.target.value }))}
                  placeholder="@eğitmenadi veya https://instagram.com/..." className={inputC} />
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between border-t border-black/5 pt-4">
                <div>
                  <p className="text-sm font-semibold text-black/70">Aktif</p>
                  <p className="text-xs text-black/40 mt-0.5">Pasif eğitmenler ders formunda görünmez</p>
                </div>
                <button type="button" onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                  className="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-300"
                  style={{ backgroundColor: form.is_active ? themeColor : 'rgba(0,0,0,0.15)' }}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-300 ${form.is_active ? 'left-6' : 'left-1'}`} />
                </button>
              </div>

              {formError && <p className="text-sm text-red-500/80 font-medium">{formError}</p>}

              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => setShowModal(false)}
                  className="flex-1 py-3 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 font-semibold text-sm transition">
                  İptal
                </button>
                <button type="submit" disabled={saving || photoLoading} style={{ backgroundColor: themeColor }}
                  className="flex-1 py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition">
                  {saving || photoLoading ? 'Kaydediliyor...' : editing ? 'Güncelle' : 'Eğitmen Ekle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── DETAIL DRAWER ── */}
      {detail && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setDetail(null)} />
          <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[440px] bg-white/90 backdrop-blur-xl border-l border-white/50 shadow-2xl flex flex-col overflow-hidden">
            {/* Drawer header */}
            <div className="flex items-start justify-between p-6 border-b border-black/5 flex-shrink-0">
              <div className="flex items-center gap-4">
                <Avatar instr={detail} themeColor={themeColor} size="lg" />
                <div>
                  <h2 className="text-lg font-bold">{detail.full_name}</h2>
                  {detail.specialties?.length > 0 && (
                    <p className="text-xs text-black/50 mt-1">{detail.specialties.join(' • ')}</p>
                  )}
                  <span className={`mt-2 inline-block px-3 py-0.5 rounded-full text-[10px] font-bold ${detail.is_active ? 'bg-emerald-400/20 text-emerald-700' : 'bg-black/10 text-black/40'}`}>
                    {detail.is_active ? 'Aktif' : 'Pasif'}
                  </span>
                </div>
              </div>
              <button onClick={() => setDetail(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-black/50 font-bold transition">✕</button>
            </div>

            {/* Drawer content */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
              {detail.bio && (
                <div>
                  <p className="text-xs font-bold text-black/40 uppercase tracking-wider mb-2">Bio</p>
                  <p className="text-sm text-black/70 leading-relaxed">{detail.bio}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-bold text-black/40 uppercase tracking-wider mb-2">İletişim</p>
                <div className="bg-white/50 border border-black/5 rounded-2xl p-4 flex flex-col gap-3">
                  {[
                    { label: 'E-posta',   value: detail.email },
                    { label: 'Telefon',   value: detail.phone },
                    { label: 'Instagram', value: detail.instagram_url },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center">
                      <span className="text-sm text-black/40 font-medium">{label}</span>
                      <span className="text-sm font-semibold">{value || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-black/40 uppercase tracking-wider mb-2">Yaklaşan Dersler</p>
                {detailClasses.length === 0 ? (
                  <p className="text-sm text-black/30 text-center py-4">Planlanmış yaklaşan ders yok.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {detailClasses.map(cls => (
                      <div key={cls.id} className="bg-white/50 border border-black/5 rounded-2xl px-4 py-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">{cls.title}</p>
                          <p className="text-xs text-black/40">
                            {new Date(cls.start_time).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' })}
                            {' · '}
                            {new Date(cls.start_time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <span className="text-xs font-semibold text-black/40">{cls.current_capacity}/{cls.max_capacity}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Drawer footer */}
            <div className="p-6 border-t border-black/5 flex gap-3 flex-shrink-0">
              <button onClick={() => { setDetail(null); openEdit(detail); }} style={{ backgroundColor: themeColor }}
                className="flex-1 py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition">
                Düzenle
              </button>
              <button onClick={() => { handleToggleActive(detail); setDetail(null); }}
                className="flex-1 py-3 rounded-xl border border-black/10 font-semibold text-sm hover:bg-black/5 transition">
                {detail.is_active ? 'Pasifleştir' : 'Aktifleştir'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
