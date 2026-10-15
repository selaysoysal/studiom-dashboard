import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from './supabaseClient';

const glassStyle = "bg-white/25 backdrop-blur-xl border border-white/40 shadow-sm rounded-3xl";
const QR_PREFIX  = 'STUDIOM-';

const WEEK_DAYS = [
  { label: 'Pzt', value: 1 }, { label: 'Sal', value: 2 },
  { label: 'Çar', value: 3 }, { label: 'Per', value: 4 },
  { label: 'Cum', value: 5 }, { label: 'Cmt', value: 6 },
  { label: 'Paz', value: 0 },
];

const EMPTY_FORM = {
  title: '', instructorName: '', startTime: '', endTime: '',
  maxCapacity: 15, isRecurring: false, selectedDays: [], endDate: '',
};
const EMPTY_MEMBER_FORM = {
  fullName: '', email: '', phone: '',
  membershipTypeId: '', packageLessons: 0, memberLevel: 1, isUnlimited: false,
};
const EMPTY_AUTH_FORM = { email: '', password: '' };


const inputClass =
  "w-full bg-white/50 border border-black/10 rounded-xl px-4 py-3 text-sm font-medium " +
  "placeholder:text-black/30 outline-none focus:border-black/30 focus:bg-white/70 transition";

function formatTime(isoString) {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(isoString) {
  if (!isoString) return '-';
  const date     = new Date(isoString);
  const dayMonth = date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  const weekday  = date.toLocaleDateString('tr-TR', { weekday: 'short' });
  return `${dayMonth}, ${weekday}`;
}

function generateMemberCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  return `STM-${suffix}`;
}

function buildRecurringSessions(formData, studioId) {
  const startDT   = new Date(formData.startTime);
  const hours     = startDT.getHours(), minutes = startDT.getMinutes();
  const durationMs = formData.endTime
    ? new Date(formData.endTime).getTime() - startDT.getTime()
    : 60 * 60 * 1000;
  const cursor = new Date(startDT.getFullYear(), startDT.getMonth(), startDT.getDate());
  const [ey, em, ed] = formData.endDate.split('-').map(Number);
  const endDT = new Date(ey, em - 1, ed, 23, 59, 59, 999);
  const sessions = [];
  while (cursor <= endDT) {
    if (formData.selectedDays.includes(cursor.getDay())) {
      const sessionStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), hours, minutes);
      sessions.push({
        studio_id: studioId, title: formData.title.trim(),
        instructor_name: formData.instructorName.trim(),
        start_time: sessionStart.toISOString(),
        end_time: new Date(sessionStart.getTime() + durationMs).toISOString(),
        max_capacity: Number(formData.maxCapacity), current_capacity: 0,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return sessions;
}

export default function App() {
  // ── Auth ──────────────────────────────────────────────────
  const [user,        setUser]        = useState(null);
  const [authForm,    setAuthForm]    = useState(EMPTY_AUTH_FORM);
  const [authError,   setAuthError]   = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // ── Navigasyon ────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('overview');

  // ── Dersler ──────────────────────────────────────────────
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // ── Üye Sayısı ────────────────────────────────────────────
  const [totalMembers,        setTotalMembers]        = useState(0);
  const [totalMembersLoading, setTotalMembersLoading] = useState(false);

  // ── Üyeler ───────────────────────────────────────────────
  const [members,        setMembers]        = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberSearch,   setMemberSearch]   = useState('');

  // ── Üyelik Paketleri ─────────────────────────────────────
  const [membershipTypes,        setMembershipTypes]        = useState([]);
  const [membershipTypesLoading, setMembershipTypesLoading] = useState(false);
  const [pkgForm,                setPkgForm]                = useState({ name: '', defaultLessonCount: 10, isUnlimited: false });
  const [isPkgSubmitting,        setIsPkgSubmitting]        = useState(false);
  const [pkgError,               setPkgError]              = useState('');

  // ── Üye Düzenleme Modalı ─────────────────────────────────
  const [isEditModalOpen,  setIsEditModalOpen]  = useState(false);
  const [selectedMember,   setSelectedMember]   = useState(null);
  const [editForm,         setEditForm]         = useState({});
  const [editFormError,    setEditFormError]    = useState('');
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);

  // ── Üye Ekleme Modalı ────────────────────────────────────
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [memberForm,           setMemberForm]           = useState(EMPTY_MEMBER_FORM);
  const [memberFormError,      setMemberFormError]      = useState('');
  const [isMemberSubmitting,   setIsMemberSubmitting]   = useState(false);
  const [newMemberCode,        setNewMemberCode]        = useState(null);
  const [memberCodeCopied,     setMemberCodeCopied]     = useState(false);

  // ── Yoklama Modalı ────────────────────────────────────────
  const [attendanceClass,      setAttendanceClass]      = useState(null);
  const [registrations,        setRegistrations]        = useState([]);
  const [registrationsLoading, setRegistrationsLoading] = useState(false);

  // ── QR Hızlı Giriş ───────────────────────────────────────
  const [qrInput,      setQrInput]      = useState('');
  const [checkInToast, setCheckInToast] = useState(null);

  // ── Stüdyo Ayarları ──────────────────────────────────────
  const [studioId,      setStudioId]      = useState(null);
  const [themeColor,    setThemeColor]    = useState('#006D68');
  const [studioCode,    setStudioCode]    = useState('');
  const [logoUrl,       setLogoUrl]       = useState(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [copied,        setCopied]        = useState(false);
  const colorInputRef = useRef(null);
  const logoInputRef  = useRef(null);

  // ── Ders Ekleme Modalı ───────────────────────────────────
  const [isModalOpen,  setIsModalOpen]  = useState(false);
  const [formData,     setFormData]     = useState(EMPTY_FORM);
  const [formError,    setFormError]    = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Auth Session ──────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) { setUser(session.user); fetchStudioSettings(session.user.id); }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) { setUser(null); setStudioId(null); }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (studioId) { fetchClasses(); fetchTotalMembers(); fetchMembershipTypes(); } }, [studioId]);
  useEffect(() => { if (activeTab === 'members' && studioId) fetchMembers(); }, [activeTab, studioId]);

  // ── Veri Çekme ───────────────────────────────────────────
  async function fetchClasses() {
    setLoading(true); setError(null);
    const { data, error } = await supabase
      .from('classes')
      .select('id, start_time, title, instructor_name, current_capacity, max_capacity')
      .eq('studio_id', studioId)
      .order('start_time', { ascending: true });
    if (error) setError(error.message); else setClasses(data ?? []);
    setLoading(false);
  }

  async function fetchMembers() {
    setMembersLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, membership_type_id, remaining_lessons, last_check_in, is_activated, member_level, is_unlimited')
      .eq('studio_id', studioId)
      .order('full_name', { ascending: true });
    if (!error) setMembers(data ?? []);
    setMembersLoading(false);
  }

  async function fetchTotalMembers() {
    setTotalMembersLoading(true);
    const { count, error } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('studio_id', studioId);
    if (!error && count !== null) setTotalMembers(count);
    setTotalMembersLoading(false);
  }

  async function fetchStudioSettings(userId) {
    const { data, error } = await supabase
      .from('studios')
      .select('id, theme_color, studio_code, logo_url')
      .eq('owner_id', userId)
      .single();
    if (!error && data) {
      setStudioId(data.id);
      setThemeColor(data.theme_color ?? '#006D68');
      setStudioCode(data.studio_code ?? '');
      setLogoUrl(data.logo_url ?? null);
    }
  }

  // ── Auth İşlemleri ────────────────────────────────────────
  function handleAuthFormChange(e) {
    const { name, value } = e.target;
    setAuthForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleLogin(e) {
    e.preventDefault();
    setAuthLoading(true); setAuthError('');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: authForm.email.trim(), password: authForm.password,
    });
    if (error) { setAuthError(error.message); setAuthLoading(false); return; }
    setUser(data.user);
    await fetchStudioSettings(data.user.id);
    setAuthLoading(false);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setUser(null); setStudioId(null);
  }

  // ── Yoklama ───────────────────────────────────────────────
  async function openAttendance(cls) {
    setAttendanceClass(cls); setRegistrationsLoading(true);
    const { data, error } = await supabase
      .from('class_registrations')
      .select('id, profile_id, status, profiles(full_name, membership_tier, remaining_lessons)')
      .eq('class_id', cls.id)
      .order('created_at', { ascending: true });
    setRegistrations(error ? [] : (data ?? []));
    setRegistrationsLoading(false);
  }

  function closeAttendance() { setAttendanceClass(null); setRegistrations([]); }

  async function handleAttendanceUpdate(registrationId, profileId, newStatus) {
    const { error } = await supabase
      .from('class_registrations').update({ status: newStatus }).eq('id', registrationId);
    if (error) return;
    if (newStatus === 'attended') {
      const { data: profile } = await supabase
        .from('profiles').select('remaining_lessons, is_unlimited').eq('id', profileId).single();
      if (profile) {
        const updates = { last_check_in: new Date().toISOString() };
        if (!profile.is_unlimited && profile.remaining_lessons > 0) {
          updates.remaining_lessons = profile.remaining_lessons - 1;
        }
        await supabase.from('profiles').update(updates).eq('id', profileId);
      }
    }
    setRegistrations(prev => prev.map(r =>
      r.id === registrationId ? {
        ...r, status: newStatus,
        profiles: r.profiles ? {
          ...r.profiles,
          remaining_lessons: (newStatus === 'attended' && !r.profiles.is_unlimited)
            ? Math.max(0, (r.profiles.remaining_lessons ?? 0) - 1)
            : r.profiles.remaining_lessons,
        } : r.profiles,
      } : r
    ));
  }

  // ── QR / Hızlı Giriş ─────────────────────────────────────
  function showToast(success, message) {
    setCheckInToast({ success, message });
    setTimeout(() => setCheckInToast(null), 4000);
  }

  async function handleQRCheckIn() {
    const raw = qrInput.trim();
    if (!raw) return;
    setQrInput('');
    const profileId = raw.startsWith(QR_PREFIX) ? raw.slice(QR_PREFIX.length) : raw;
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('id, full_name, remaining_lessons, is_unlimited').eq('id', profileId).single();
    if (profileError || !profile) { showToast(false, 'Üye bulunamadı. QR kodu kontrol edin.'); return; }
    if (!profile.is_unlimited && (profile.remaining_lessons ?? 0) <= 0) {
      showToast(false, `${profile.full_name} — Kalan ders hakkı bulunmuyor.`); return;
    }
    const now         = new Date();
    const windowStart = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const windowEnd   = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const { data: nearbyClasses } = await supabase
      .from('classes').select('id').gte('start_time', windowStart).lte('start_time', windowEnd);
    const classIds = (nearbyClasses ?? []).map(c => c.id);
    if (classIds.length === 0) { showToast(false, `${profile.full_name} — Bu saatte aktif ders bulunamadı.`); return; }
    const { data: registration } = await supabase
      .from('class_registrations').select('id')
      .eq('profile_id', profileId).in('class_id', classIds).eq('status', 'enrolled').maybeSingle();
    if (!registration) { showToast(false, `${profile.full_name} — Bu saatte kayıtlı ders bulunamadı.`); return; }
    await supabase.from('class_registrations').update({ status: 'attended' }).eq('id', registration.id);
    if (profile.is_unlimited) {
      await supabase.from('profiles').update({ last_check_in: now.toISOString() }).eq('id', profileId);
      showToast(true, `Giriş Başarılı: ${profile.full_name} — Sınırsız Paket ∞`);
    } else {
      const newLessons = Math.max(0, profile.remaining_lessons - 1);
      await supabase.from('profiles')
        .update({ remaining_lessons: newLessons, last_check_in: now.toISOString() }).eq('id', profileId);
      showToast(true, `Giriş Başarılı: ${profile.full_name} — Kalan Ders: ${newLessons}`);
    }
  }

  // ── Stüdyo Ayarları ──────────────────────────────────────
  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    const ext      = file.name.split('.').pop();
    const filePath = `logos/${studioId}/logo_${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('studio-assets')
      .upload(filePath, file, { upsert: true });
    if (uploadError) { setLogoUploading(false); return; }
    const { data: { publicUrl } } = supabase.storage
      .from('studio-assets')
      .getPublicUrl(filePath);
    await supabase.from('studios').update({ logo_url: publicUrl }).eq('id', studioId);
    setLogoUrl(publicUrl);
    setLogoUploading(false);
    e.target.value = '';
  }

  async function handleColorChange(e) {
    const newColor = e.target.value;
    setThemeColor(newColor);
    await supabase.from('studios').update({ theme_color: newColor }).eq('id', studioId);
  }

  async function handleCopy() {
    try { await navigator.clipboard.writeText(studioCode); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }

  // ── Ders Ekleme Modal ─────────────────────────────────────
  function openModal()  { setIsModalOpen(true); }
  function closeModal() { setIsModalOpen(false); setFormData(EMPTY_FORM); setFormError(''); }
  function handleFormChange(e) {
    const { name, value } = e.target;
    setFormData(prev => {
      const updated = { ...prev, [name]: value };
      if (name === 'startTime' && value) {
        const start  = new Date(value);
        const autoEnd = new Date(start.getTime() + 60 * 60 * 1000);
        const pad = n => String(n).padStart(2, '0');
        updated.endTime = `${autoEnd.getFullYear()}-${pad(autoEnd.getMonth() + 1)}-${pad(autoEnd.getDate())}T${pad(autoEnd.getHours())}:${pad(autoEnd.getMinutes())}`;
      }
      return updated;
    });
  }
  function toggleRecurring() {
    setFormData(prev => ({ ...prev, isRecurring: !prev.isRecurring, selectedDays: [], endDate: '' }));
  }
  function toggleDay(dayValue) {
    setFormData(prev => {
      const days = prev.selectedDays.includes(dayValue)
        ? prev.selectedDays.filter(d => d !== dayValue)
        : [...prev.selectedDays, dayValue];
      return { ...prev, selectedDays: days };
    });
  }
  async function handleAddClass(e) {
    e.preventDefault();
    if (!formData.title.trim() || !formData.instructorName.trim() || !formData.startTime || !formData.endTime) {
      setFormError('Lütfen tüm alanları doldurun.'); return;
    }
    if (new Date(formData.endTime) <= new Date(formData.startTime)) {
      setFormError('Bitiş saati başlangıç saatinden sonra olmalıdır.'); return;
    }
    if (formData.isRecurring) {
      if (formData.selectedDays.length === 0) { setFormError('En az bir gün seçin.'); return; }
      if (!formData.endDate) { setFormError('Bitiş tarihini girin.'); return; }
      const [ey, em, ed] = formData.endDate.split('-').map(Number);
      if (new Date(ey, em - 1, ed) < new Date(formData.startTime)) {
        setFormError('Bitiş tarihi başlangıç tarihinden önce olamaz.'); return;
      }
    }
    setIsSubmitting(true); setFormError('');
    let insertError = null;
    if (formData.isRecurring) {
      const sessions = buildRecurringSessions(formData, studioId);
      if (sessions.length === 0) {
        setFormError('Seçilen tarih aralığında bu günlere denk gelen seans bulunamadı.');
        setIsSubmitting(false); return;
      }
      const { error } = await supabase.from('classes').insert(sessions);
      insertError = error;
    } else {
      const { error } = await supabase.from('classes').insert({
        studio_id: studioId, title: formData.title.trim(),
        instructor_name: formData.instructorName.trim(),
        start_time: formData.startTime, end_time: formData.endTime,
        max_capacity: Number(formData.maxCapacity), current_capacity: 0,
      });
      insertError = error;
    }
    setIsSubmitting(false);
    if (insertError) { setFormError(insertError.message); return; }
    closeModal(); fetchClasses();
  }

  // ── Üyelik Paketleri CRUD ─────────────────────────────────
  async function fetchMembershipTypes() {
    setMembershipTypesLoading(true);
    const { data } = await supabase
      .from('membership_types')
      .select('id, name, default_lesson_count, is_unlimited')
      .eq('studio_id', studioId)
      .order('created_at', { ascending: true });
    setMembershipTypes(data ?? []);
    setMembershipTypesLoading(false);
  }
  async function handleAddPackage(e) {
    e.preventDefault();
    if (!pkgForm.name.trim()) { setPkgError('Paket adı zorunludur.'); return; }
    if (!pkgForm.isUnlimited && Number(pkgForm.defaultLessonCount) < 1) {
      setPkgError('Ders hakkı en az 1 olmalıdır.'); return;
    }
    setIsPkgSubmitting(true); setPkgError('');
    const { error } = await supabase.from('membership_types').insert({
      studio_id: studioId,
      name: pkgForm.name.trim(),
      default_lesson_count: pkgForm.isUnlimited ? 0 : Number(pkgForm.defaultLessonCount),
      is_unlimited: pkgForm.isUnlimited,
    });
    setIsPkgSubmitting(false);
    if (error) { setPkgError(error.message); return; }
    setPkgForm({ name: '', defaultLessonCount: 10, isUnlimited: false });
    fetchMembershipTypes();
    showToast(true, `"${pkgForm.name.trim()}" paketi oluşturuldu.`);
  }
  async function handleDeletePackage(id, name) {
    const { error } = await supabase.from('membership_types').delete().eq('id', id);
    if (error) { showToast(false, 'Paket silinirken hata oluştu.'); return; }
    setMembershipTypes(prev => prev.filter(t => t.id !== id));
    showToast(true, `"${name}" paketi silindi.`);
  }

  // ── Üye Ekleme Modal ─────────────────────────────────────
  function openAddMemberModal()  { setIsAddMemberModalOpen(true); }
  function closeAddMemberModal() {
    setIsAddMemberModalOpen(false); setMemberForm(EMPTY_MEMBER_FORM);
    setMemberFormError(''); setNewMemberCode(null); setMemberCodeCopied(false);
  }
  function handleMemberFormChange(e) {
    const { name, value } = e.target;
    setMemberForm(prev => ({ ...prev, [name]: value }));
  }
  function handleMemberTypeChange(typeId) {
    const type = membershipTypes.find(t => t.id === typeId);
    setMemberForm(prev => ({
      ...prev,
      membershipTypeId: typeId,
      packageLessons:   type ? type.default_lesson_count : prev.packageLessons,
      isUnlimited:      type ? type.is_unlimited : prev.isUnlimited,
    }));
  }
  async function handleAddMember(e) {
    e.preventDefault();
    if (!studioId) {
      setMemberFormError('Stüdyo bilgisi yükleniyor, lütfen bekleyin.'); return;
    }
    if (!memberForm.fullName.trim() || !memberForm.email.trim() || !memberForm.phone.trim()) {
      setMemberFormError('Ad Soyad, e-posta ve telefon alanları zorunludur.'); return;
    }
    setIsMemberSubmitting(true); setMemberFormError('');
    const memberCode = generateMemberCode();
    const { error } = await supabase.from('profiles').insert({
      id: crypto.randomUUID(), studio_id: studioId,
      full_name: memberForm.fullName.trim(), email: memberForm.email.trim(),
      phone: memberForm.phone.trim(),
      membership_type_id: memberForm.membershipTypeId || null,
      remaining_lessons: memberForm.isUnlimited ? 0 : Number(memberForm.packageLessons),
      is_unlimited: memberForm.isUnlimited,
      last_check_in: null, member_code: memberCode, is_activated: false,
      member_level: Number(memberForm.memberLevel),
    });
    setIsMemberSubmitting(false);
    if (error) { setMemberFormError(error.message); return; }
    setNewMemberCode(memberCode); fetchMembers();
  }

  // ── Üye Düzenleme Modal ──────────────────────────────────
  function openEditModal(member) {
    setSelectedMember(member);
    setEditForm({
      fullName:         member.full_name          ?? '',
      email:            member.email              ?? '',
      phone:            member.phone              ?? '',
      remainingLessons: member.remaining_lessons  ?? 0,
      membershipTypeId: member.membership_type_id ?? '',
      isActivated:      member.is_activated       ?? false,
      memberLevel:      member.member_level        ?? 1,
      isUnlimited:      member.is_unlimited        ?? false,
    });
    setEditFormError('');
    setIsEditModalOpen(true);
  }
  function closeEditModal() {
    setIsEditModalOpen(false);
    setSelectedMember(null);
    setEditFormError('');
  }
  function handleEditFormChange(e) {
    const { name, value } = e.target;
    setEditForm(prev => ({ ...prev, [name]: value }));
  }
  function handleEditTypeChange(typeId) {
    const type = membershipTypes.find(t => t.id === typeId);
    setEditForm(prev => ({
      ...prev,
      membershipTypeId: typeId,
      ...(type ? { remainingLessons: type.default_lesson_count, isUnlimited: type.is_unlimited } : {}),
    }));
  }
  async function handleUpdateMember(e) {
    e.preventDefault();
    if (!editForm.fullName.trim()) { setEditFormError('Ad Soyad alanı zorunludur.'); return; }
    setIsEditSubmitting(true); setEditFormError('');
    const { error } = await supabase.from('profiles').update({
      full_name:          editForm.fullName.trim(),
      email:              editForm.email.trim(),
      phone:              editForm.phone.trim(),
      remaining_lessons:  editForm.isUnlimited ? 0 : Number(editForm.remainingLessons),
      membership_type_id: editForm.membershipTypeId || null,
      is_activated:       editForm.isActivated,
      member_level:       Number(editForm.memberLevel),
      is_unlimited:       editForm.isUnlimited,
    }).eq('id', selectedMember.id);
    setIsEditSubmitting(false);
    if (error) { setEditFormError(error.message); showToast(false, 'Güncelleme sırasında bir hata oluştu.'); return; }
    setMembers(prev => prev.map(m => m.id === selectedMember.id ? {
      ...m,
      full_name:          editForm.fullName.trim(),
      email:              editForm.email.trim(),
      phone:              editForm.phone.trim(),
      remaining_lessons:  editForm.isUnlimited ? 0 : Number(editForm.remainingLessons),
      membership_type_id: editForm.membershipTypeId || null,
      is_activated:       editForm.isActivated,
      member_level:       Number(editForm.memberLevel),
      is_unlimited:       editForm.isUnlimited,
    } : m));
    closeEditModal();
    showToast(true, `${editForm.fullName.trim()} bilgileri başarıyla güncellendi.`);
  }

  // ── Seviye Yardımcısı ─────────────────────────────────────
  function levelInfo(level) {
    if (level <= 3) return { label: 'Başlangıç', bg: 'bg-emerald-400/20', text: 'text-emerald-700' };
    if (level <= 7) return { label: 'Orta',      bg: 'bg-amber-400/20',   text: 'text-amber-700'   };
    return              { label: 'İleri',      bg: 'bg-purple-400/20',  text: 'text-purple-700'  };
  }

  // ── Yardımcılar ───────────────────────────────────────────
  const occupancyRate = useMemo(() => {
    if (!classes.length) return 0;
    const totalCurrent = classes.reduce((sum, c) => sum + (c.current_capacity ?? 0), 0);
    const totalMax     = classes.reduce((sum, c) => sum + (c.max_capacity ?? 0), 0);
    if (totalMax === 0) return 0;
    return Math.round((totalCurrent / totalMax) * 100);
  }, [classes]);

  const filteredMembers = members.filter(m =>
    (m.full_name ?? '').toLowerCase().includes(memberSearch.toLowerCase())
  );
  function navStyle(tab) { return tab === activeTab ? { backgroundColor: themeColor } : {}; }
  function navClass(tab) {
    return `w-full text-left px-4 py-3 rounded-xl font-semibold transition ${
      tab === activeTab ? 'text-white' : 'text-black/70 font-medium hover:bg-white/30'
    }`;
  }

  // ─────────────────────────────────────────────────────────
  // ── AUTH EKRANI ───────────────────────────────────────────
  if (!user) return (
    <div className="min-h-screen bg-gradient-to-br from-[#FDF1E7] to-[#D3ECEB] flex items-center justify-center p-6 font-sans text-[#1A1A1A]">
      <div className={`w-full max-w-sm p-8 ${glassStyle}`}>

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-white/60 rounded-full flex items-center justify-center mb-4">
            <span style={{ color: themeColor }} className="font-black text-xl tracking-tight">S</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Studiom</h1>
          <p className="text-black/40 text-sm mt-1 font-semibold tracking-wider uppercase">Yönetim Paneli</p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-black/50">E-posta</label>
            <input
              type="email" name="email" value={authForm.email}
              onChange={handleAuthFormChange} placeholder="studio@mail.com"
              className={inputClass} autoFocus autoComplete="email"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-black/50">Şifre</label>
            <input
              type="password" name="password" value={authForm.password}
              onChange={handleAuthFormChange} placeholder="••••••••"
              className={inputClass} autoComplete="current-password"
            />
          </div>
          {authError && (
            <div className="flex items-start gap-2.5 bg-red-50/70 border border-red-200/60 rounded-xl px-4 py-3">
              <span className="text-red-400 mt-0.5 flex-shrink-0">⚠</span>
              <p className="text-sm text-red-600/90 font-medium leading-snug">{authError}</p>
            </div>
          )}
          <button
            type="submit" disabled={authLoading}
            style={{ backgroundColor: themeColor }}
            className="py-3.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition-opacity mt-1"
          >
            {authLoading ? 'Giriş Yapılıyor...' : 'Giriş Yap'}
          </button>
        </form>

        <p className="text-center text-xs text-black/30 mt-8 font-medium">
          Sadece yetkili stüdyo yöneticileri giriş yapabilir.
        </p>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────
  // ── DASHBOARD ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FDF1E7] to-[#D3ECEB] flex p-6 gap-6 font-sans text-[#1A1A1A]">

      {/* ── SOL MENÜ ─────────────────────────────────────── */}
      <aside className={`w-64 flex flex-col p-6 ${glassStyle}`}>
        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 bg-white/60 rounded-full mb-3 overflow-hidden flex items-center justify-center">
            {logoUrl
              ? <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
              : <span style={{ color: themeColor }} className="font-bold text-xl">S</span>
            }
          </div>
          <span className="text-xs font-semibold text-black/50 tracking-wider">YÖNETİM PANELİ</span>
        </div>
        <nav className="flex flex-col gap-2 flex-1">
          <button onClick={() => setActiveTab('overview')} style={navStyle('overview')} className={navClass('overview')}>
            Genel Bakış
          </button>
          <button onClick={() => setActiveTab('members')} style={navStyle('members')} className={navClass('members')}>
            Üye Yönetimi
          </button>
          <button onClick={() => setActiveTab('packages')} style={navStyle('packages')} className={navClass('packages')}>
            Üyelik Paketleri
          </button>
        </nav>
        {/* Çıkış */}
        <div className="border-t border-white/30 pt-4 mt-4">
          <p className="text-xs text-black/40 font-medium px-1 mb-2 truncate">{user.email}</p>
          <button
            onClick={handleSignOut}
            className="w-full text-left px-4 py-3 rounded-xl font-semibold text-sm text-black/60 hover:bg-black/5 hover:text-black/80 transition"
          >
            Çıkış Yap
          </button>
        </div>
      </aside>

      {/* ── ANA İÇERİK ───────────────────────────────────── */}
      <main className="flex-1 flex flex-col gap-6 overflow-auto">

        {/* ════ GENEL BAKIŞ ════ */}
        {activeTab === 'overview' && (<>

          <header className="flex justify-between items-center mt-2">
            <div>
              <h1 className="text-3xl font-bold">Bugün stüdyoda neler oluyor?</h1>
              <p className="text-black/60 mt-1 font-medium">1 Haziran 2026, Pazartesi</p>
            </div>
            <button
              onClick={openModal} style={{ backgroundColor: themeColor }}
              className="flex items-center gap-2 text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity shadow-sm"
            >
              <span className="text-lg leading-none">+</span> Yeni Ders Ekle
            </button>
          </header>

          {/* İstatistik Kartları */}
          <div className="grid grid-cols-3 gap-4">

            {/* Toplam Üye — dinamik */}
            <div className={`p-5 flex flex-col gap-2 ${glassStyle}`}>
              <span className="text-xl">👤</span>
              <p className="text-2xl font-bold">
                {totalMembersLoading ? <span className="text-black/30 text-lg">—</span> : totalMembers}
              </p>
              <p className="text-sm text-black/50 font-medium">Aktif Üyeler</p>
            </div>

            {/* Bugünkü Dersler — dinamik */}
            <div className={`p-5 flex flex-col gap-2 ${glassStyle}`}>
              <span className="text-xl">🏋️</span>
              <p className="text-2xl font-bold">
                {loading ? <span className="text-black/30 text-lg">—</span> : classes.length}
              </p>
              <p className="text-sm text-black/50 font-medium">Bugünkü Dersler</p>
            </div>

            {/* Ortalama Doluluk — dinamik, progress bar */}
            <div className={`p-5 flex flex-col gap-2 ${glassStyle}`}>
              <span className="text-xl">📊</span>
              <p className="text-2xl font-bold">
                {loading ? <span className="text-black/30 text-lg">—</span> : `%${occupancyRate}`}
              </p>
              <p className="text-sm text-black/50 font-medium">Ort. Doluluk</p>
              <div className="w-full bg-black/10 rounded-full h-1.5 mt-1">
                <div
                  className="h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${occupancyRate}%`, backgroundColor: themeColor }}
                />
              </div>
            </div>

          </div>

          {/* Ders Tablosu + Görünüm Paneli */}
          <div className="grid grid-cols-3 gap-6">

            <div className={`col-span-2 p-6 flex flex-col gap-5 ${glassStyle}`}>
              <h2 className="text-2xl font-bold">Yaklaşan Dersler</h2>
              <table className="w-full">
                <thead>
                  <tr>
                    {["TARİH","SAAT","DERS ADI","EĞİTMEN","KAPASİTE","YOKLAMA"].map((col) => (
                      <th key={col} className="text-left text-sm uppercase opacity-50 font-semibold pb-3 tracking-wider">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="py-8 text-center text-black/40 font-medium">Veriler yükleniyor...</td></tr>
                  ) : error ? (
                    <tr><td colSpan={6} className="py-8 text-center text-red-500/70 font-medium">Hata: {error}</td></tr>
                  ) : classes.length === 0 ? (
                    <tr><td colSpan={6} className="py-8 text-center text-black/40 font-medium">Bugün planlanmış ders bulunmuyor.</td></tr>
                  ) : (
                    classes.map((cls, i) => {
                      const isFull = cls.current_capacity >= cls.max_capacity;
                      return (
                        <tr key={cls.id} className={i < classes.length - 1 ? "border-b border-white/20" : ""}>
                          <td className="py-4 text-black/70 font-medium">{formatDate(cls.start_time)}</td>
                          <td style={{ color: themeColor }} className="py-4 font-bold">{formatTime(cls.start_time)}</td>
                          <td className="py-4 font-semibold">{cls.title}</td>
                          <td className="py-4 text-black/70">{cls.instructor_name}</td>
                          <td className="py-4">
                            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${isFull ? "bg-amber-400/25 text-amber-700" : "bg-emerald-400/25 text-emerald-700"}`}>
                              {cls.current_capacity} / {cls.max_capacity}
                            </span>
                          </td>
                          <td className="py-4">
                            <button
                              onClick={() => openAttendance(cls)} style={{ backgroundColor: themeColor }}
                              className="px-3 py-1.5 rounded-xl text-white text-xs font-semibold hover:opacity-80 transition whitespace-nowrap"
                            >
                              Yoklama Al
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className={`col-span-1 p-6 flex flex-col gap-6 ${glassStyle}`}>
              <h2 className="text-2xl font-bold">Uygulama Görünümü</h2>

              {/* Logo Yükleme */}
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-black/50 uppercase tracking-wider">Uygulama İkonu / Logo</p>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-white/40 border border-white/60 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {logoUrl
                      ? <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
                      : <span style={{ color: themeColor }} className="font-bold text-xl">S</span>
                    }
                  </div>
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="sr-only"
                    />
                    <button
                      onClick={() => logoInputRef.current.click()}
                      disabled={logoUploading}
                      style={{ color: themeColor }}
                      className="text-sm font-semibold hover:opacity-70 disabled:opacity-40 transition text-left"
                    >
                      {logoUploading ? 'Yükleniyor...' : 'Yeni İkon Seç'}
                    </button>
                    <p className="text-xs text-black/30 leading-snug">PNG veya JPG. Kare format önerilir.</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-black/50 uppercase tracking-wider">Ana Tema Rengi</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div style={{ backgroundColor: themeColor }} className="w-8 h-8 rounded-lg shadow-sm flex-shrink-0 transition-colors duration-300" />
                    <span className="font-mono font-semibold text-sm">{themeColor}</span>
                  </div>
                  <input ref={colorInputRef} type="color" value={themeColor} onChange={handleColorChange} className="sr-only" aria-label="Tema rengi seç" />
                  <button onClick={() => colorInputRef.current.click()} style={{ color: themeColor }} className="text-sm font-semibold hover:opacity-70 transition">
                    Değiştir
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-black/50 uppercase tracking-wider">Stüdyo Kodu</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-white/30 border border-white/50 rounded-xl px-4 py-2">
                    <span className="font-mono font-bold tracking-widest text-sm">{studioCode || '—'}</span>
                  </div>
                  <button
                    onClick={handleCopy}
                    className={`px-3 py-2 border border-white/50 rounded-xl text-sm font-semibold transition-all duration-200 ${copied ? "bg-emerald-400/30 text-emerald-700 border-emerald-300/50" : "bg-white/40 hover:bg-white/60"}`}
                  >
                    {copied ? "Kopyalandı! ✓" : "Kopyala"}
                  </button>
                </div>
              </div>
              <p className="text-xs opacity-50 leading-relaxed mt-auto">Değişiklikler anında üyelerin uygulamasına yansır.</p>
            </div>

          </div>
        </>)}

        {/* ════ ÜYELİK PAKETLERİ ════ */}
        {activeTab === 'packages' && (<>

          <header className="flex justify-between items-center mt-2">
            <div>
              <h1 className="text-3xl font-bold">Üyelik Paketleri</h1>
              <p className="text-black/60 mt-1 font-medium">
                {membershipTypesLoading ? 'Yükleniyor...' : `${membershipTypes.length} paket tanımlı`}
              </p>
            </div>
          </header>

          <div className="grid grid-cols-3 gap-6">

            {/* Sol: Yeni Paket Formu */}
            <div className={`col-span-1 p-6 flex flex-col gap-5 ${glassStyle}`}>
              <div>
                <h2 className="text-lg font-bold">Yeni Paket Ekle</h2>
                <p className="text-xs text-black/40 mt-1">Üye kayıt formlarında görünecek paket seçeneklerini yönetin.</p>
              </div>
              <form onSubmit={handleAddPackage} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-black/50">Paket Adı</label>
                  <input
                    type="text"
                    value={pkgForm.name}
                    onChange={e => setPkgForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Aylık Sınırsız"
                    className={inputClass}
                  />
                </div>
                <div className="flex items-center justify-between border border-black/5 bg-black/[0.02] rounded-2xl px-5 py-4">
                  <div>
                    <p className="text-sm font-semibold text-black/70">Sınırsız Paket</p>
                    <p className="text-xs text-black/40 mt-0.5">
                      {pkgForm.isUnlimited ? 'Sınırsız ders hakkı' : 'Belirli ders hakkı'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPkgForm(prev => ({ ...prev, isUnlimited: !prev.isUnlimited }))}
                    className="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-300 focus:outline-none"
                    style={{ backgroundColor: pkgForm.isUnlimited ? themeColor : 'rgba(0,0,0,0.15)' }}
                  >
                    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-300 ${pkgForm.isUnlimited ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>
                {!pkgForm.isUnlimited && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-black/50">Varsayılan Ders Hakkı</label>
                    <input
                      type="number"
                      value={pkgForm.defaultLessonCount}
                      onChange={e => setPkgForm(prev => ({ ...prev, defaultLessonCount: e.target.value }))}
                      min="1"
                      className={inputClass}
                    />
                    <p className="text-xs text-black/30">Paket seçildiğinde ders hakkı alanına otomatik yazılır.</p>
                  </div>
                )}
                {pkgError && <p className="text-sm text-red-500/80 font-medium">{pkgError}</p>}
                <button
                  type="submit"
                  disabled={isPkgSubmitting}
                  style={{ backgroundColor: themeColor }}
                  className="py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition flex items-center justify-center gap-2"
                >
                  {isPkgSubmitting ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Kaydediliyor...
                    </>
                  ) : (
                    <><span className="text-base leading-none">+</span> Paket Oluştur</>
                  )}
                </button>
              </form>
            </div>

            {/* Sağ: Paket Listesi */}
            <div className={`col-span-2 p-6 flex flex-col gap-5 ${glassStyle}`}>
              <h2 className="text-lg font-bold">Mevcut Paketler</h2>
              {membershipTypesLoading ? (
                <p className="text-black/40 font-medium text-center py-10">Yükleniyor...</p>
              ) : membershipTypes.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-14 text-center">
                  <div className="text-5xl opacity-20">📦</div>
                  <p className="text-black/50 font-semibold">Henüz paket oluşturulmamış</p>
                  <p className="text-black/30 text-sm max-w-xs leading-relaxed">
                    Soldaki formu kullanarak ilk paketinizi ekleyin. Paketler, üye kayıt ve düzenleme formlarında görünecek.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {membershipTypes.map(type => (
                    <div
                      key={type.id}
                      className="flex items-center justify-between bg-white/30 border border-white/50 rounded-2xl px-5 py-4 hover:bg-white/40 transition"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-black flex-shrink-0"
                          style={{ backgroundColor: themeColor }}
                        >
                          <span className={type.is_unlimited ? 'text-lg' : 'text-sm'}>
                            {type.is_unlimited ? '∞' : type.default_lesson_count}
                          </span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold">{type.name}</p>
                            {type.is_unlimited && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-400/20 text-violet-700">
                                Sınırsız
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-black/40 mt-0.5">
                            {type.is_unlimited ? 'Sınırsız ders hakkı' : `${type.default_lesson_count} ders hakkı`}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeletePackage(type.id, type.name)}
                        className="p-2 rounded-xl hover:bg-red-50 text-black/20 hover:text-red-400 transition"
                        title="Paketi Sil"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </>)}

        {/* ════ ÜYE YÖNETİMİ ════ */}
        {activeTab === 'members' && (<>

          <header className="flex justify-between items-center mt-2">
            <div>
              <h1 className="text-3xl font-bold">Üye Yönetimi</h1>
              <p className="text-black/60 mt-1 font-medium">
                {membersLoading ? 'Yükleniyor...' : `${members.length} üye kayıtlı`}
              </p>
            </div>
          </header>

          <div className={`p-6 flex flex-col gap-5 ${glassStyle}`}>
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-black/30 text-sm pointer-events-none">🔍</span>
                <input
                  type="text" placeholder="İsme göre ara..." value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  className="w-full bg-white/50 border border-black/10 rounded-xl pl-10 pr-4 py-3 text-sm font-medium placeholder:text-black/30 outline-none focus:border-black/30 focus:bg-white/70 transition"
                />
              </div>
              <button
                onClick={openAddMemberModal} style={{ backgroundColor: themeColor }}
                className="flex items-center gap-2 text-white px-5 py-3 rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity shadow-sm whitespace-nowrap"
              >
                <span className="text-base leading-none">+</span> Üye Ekle
              </button>
            </div>

            <table className="w-full">
              <thead>
                <tr>
                  {["ÜYE ADI","ÜYELİK TİPİ","SEVİYE","KALAN DERS HAKKI","SON GİRİŞ TARİHİ",""].map((col, idx) => (
                    <th key={idx} className="text-left text-sm uppercase opacity-50 font-semibold pb-3 tracking-wider">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {membersLoading ? (
                  <tr><td colSpan={6} className="py-8 text-center text-black/40 font-medium">Üyeler yükleniyor...</td></tr>
                ) : filteredMembers.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-black/40 font-medium">
                    {memberSearch ? 'Arama kriterine uyan üye bulunamadı.' : 'Henüz kayıtlı üye yok.'}
                  </td></tr>
                ) : (
                  filteredMembers.map((member, i) => {
                    const memberType = membershipTypes.find(t => t.id === member.membership_type_id);
                    return (
                      <tr key={member.id} className={i < filteredMembers.length - 1 ? "border-b border-white/20" : ""}>
                        <td className="py-4 font-semibold">{member.full_name}</td>
                        <td className="py-4">
                          {memberType ? (
                            <span className="px-3 py-1 rounded-full text-xs font-bold text-white" style={{ backgroundColor: themeColor }}>
                              {memberType.name}
                            </span>
                          ) : (
                            <span className="px-3 py-1 rounded-full text-xs font-bold bg-black/10 text-black/40">—</span>
                          )}
                        </td>
                        <td className="py-4">
                          {(() => {
                            const lvl = member.member_level ?? 1;
                            const info = levelInfo(lvl);
                            return (
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${info.bg} ${info.text}`}>
                                <span className="text-[10px]">★</span>
                                {lvl}<span className="opacity-50 font-normal">/10</span>
                              </span>
                            );
                          })()}
                        </td>
                        <td className="py-4">
                          {member.is_unlimited ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-violet-400/20 text-violet-700">
                              ∞ Sınırsız
                            </span>
                          ) : (
                            <>
                              <span className="font-bold">{member.remaining_lessons ?? 0}</span>
                              <span className="text-black/40 text-sm ml-1">ders</span>
                            </>
                          )}
                        </td>
                        <td className="py-4 text-black/60 font-medium">
                          {member.last_check_in ? formatDate(member.last_check_in) : '—'}
                        </td>
                        <td className="py-4 text-right">
                          <button
                            onClick={() => openEditModal(member)}
                            className="p-2 rounded-xl hover:bg-black/5 text-black/30 hover:text-black/60 transition"
                            title="Düzenle"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>)}

      </main>

      {/* ══════════ MODALLER ══════════ */}

      {/* YENİ DERS MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md" onClick={closeModal}>
          <div className="w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto bg-white/85 backdrop-blur-xl border border-white/60 rounded-3xl shadow-2xl p-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-7">
              <h3 className="text-xl font-bold">Yeni Ders Ekle</h3>
              <button onClick={closeModal} className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-black/50 font-bold transition">✕</button>
            </div>
            <form onSubmit={handleAddClass} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-black/50">Ders Adı</label>
                <input type="text" name="title" value={formData.title} onChange={handleFormChange} placeholder="Reformer Pilates" className={inputClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-black/50">Eğitmen Adı</label>
                <input type="text" name="instructorName" value={formData.instructorName} onChange={handleFormChange} placeholder="Selay Yılmaz" className={inputClass} />
              </div>
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-black/50">{formData.isRecurring ? 'Başlangıç & Saat' : 'Başlangıç Saati'}</label>
                    <input type="datetime-local" name="startTime" value={formData.startTime} onChange={handleFormChange} className={inputClass} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-black/50">Bitiş Saati</label>
                    <input type="datetime-local" name="endTime" value={formData.endTime} onChange={handleFormChange} className={inputClass} />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-black/50">Maks. Kapasite</label>
                  <input type="number" name="maxCapacity" value={formData.maxCapacity} onChange={handleFormChange} min="1" className={inputClass} />
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-black/5 pt-4">
                <div>
                  <p className="text-sm font-semibold text-black/70">Haftalık Tekrarla</p>
                  <p className="text-xs text-black/40 mt-0.5">Seçilen günlerde otomatik seans oluştur</p>
                </div>
                <button type="button" onClick={toggleRecurring} aria-pressed={formData.isRecurring}
                  className="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-300 focus:outline-none"
                  style={{ backgroundColor: formData.isRecurring ? themeColor : 'rgba(0,0,0,0.15)' }}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-300 ${formData.isRecurring ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
              <div className={`flex flex-col gap-4 overflow-hidden transition-all duration-300 ease-in-out ${formData.isRecurring ? 'max-h-72 opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-black/50">Hangi Günler?</label>
                  <div className="flex gap-1.5">
                    {WEEK_DAYS.map(day => {
                      const isSelected = formData.selectedDays.includes(day.value);
                      return (
                        <button key={day.value} type="button" onClick={() => toggleDay(day.value)}
                          style={isSelected ? { backgroundColor: themeColor } : {}}
                          className={`flex-1 h-9 rounded-full text-xs font-bold transition-all duration-200 ${isSelected ? 'text-white shadow-sm' : 'bg-black/5 text-black/50 hover:bg-black/10'}`}>
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-black/50">Bitiş Tarihi</label>
                  <input type="date" name="endDate" value={formData.endDate} onChange={handleFormChange} className={inputClass} />
                </div>
              </div>
              {formError && <p className="text-sm text-red-500/80 font-medium -mt-1">{formError}</p>}
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={closeModal} className="flex-1 py-3 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 font-semibold text-sm transition">İptal</button>
                <button type="submit" disabled={isSubmitting} style={{ backgroundColor: themeColor }} className="flex-1 py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition">
                  {isSubmitting ? 'Kaydediliyor...' : 'Ders Oluştur'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* YOKLAMA MODAL */}
      {attendanceClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md" onClick={closeAttendance}>
          <div className="w-full max-w-lg mx-4 max-h-[85vh] flex flex-col bg-white/85 backdrop-blur-xl border border-white/60 rounded-3xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between p-7 pb-5 border-b border-black/5">
              <div>
                <h3 className="text-xl font-bold">{attendanceClass.title} — Yoklama</h3>
                <p className="text-sm text-black/50 mt-1">{formatDate(attendanceClass.start_time)} · {formatTime(attendanceClass.start_time)}</p>
                {!registrationsLoading && (
                  <div className="flex items-center gap-3 mt-2 text-xs text-black/40 font-medium">
                    <span className="text-emerald-600 font-semibold">✓ {registrations.filter(r => r.status === 'attended').length} Geldi</span>
                    <span>·</span>
                    <span className="text-red-500/70 font-semibold">✗ {registrations.filter(r => r.status === 'absent').length} Gelmedi</span>
                    <span>·</span>
                    <span>{registrations.filter(r => r.status === 'enrolled').length} Bekliyor</span>
                  </div>
                )}
              </div>
              <button onClick={closeAttendance} className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-black/50 font-bold transition mt-1">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 px-7 py-5">
              {registrationsLoading ? (
                <p className="text-center text-black/40 font-medium py-8">Yükleniyor...</p>
              ) : registrations.length === 0 ? (
                <p className="text-center text-black/40 font-medium py-8">Bu derse kayıtlı üye bulunamadı.</p>
              ) : (
                <ul className="flex flex-col">
                  {registrations.map((reg, i) => {
                    const name     = reg.profiles?.full_name ?? 'Bilinmiyor';
                    const lessons  = reg.profiles?.remaining_lessons ?? 0;
                    const attended = reg.status === 'attended';
                    const absent   = reg.status === 'absent';
                    return (
                      <li key={reg.id} className={`flex items-center gap-3 py-3.5 ${i < registrations.length - 1 ? 'border-b border-black/5' : ''}`}>
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-sm font-bold"
                          style={{ backgroundColor: attended ? '#10b981' : absent ? '#ef4444' : themeColor, opacity: absent ? 0.6 : 1 }}
                        >
                          {name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm leading-tight">{name}</p>
                          <p className="text-xs text-black/40 mt-0.5">{lessons} ders hakkı kaldı</p>
                        </div>
                        {attended ? (
                          <span className="px-3 py-1 bg-emerald-400/20 text-emerald-700 rounded-full text-xs font-bold whitespace-nowrap">Geldi ✓</span>
                        ) : absent ? (
                          <span className="px-3 py-1 bg-red-400/20 text-red-600 rounded-full text-xs font-bold whitespace-nowrap">Gelmedi</span>
                        ) : (
                          <div className="flex gap-2">
                            <button onClick={() => handleAttendanceUpdate(reg.id, reg.profile_id, 'attended')}
                              style={{ backgroundColor: themeColor }}
                              className="px-3 py-1.5 rounded-xl text-white text-xs font-bold hover:opacity-80 transition whitespace-nowrap">Geldi</button>
                            <button onClick={() => handleAttendanceUpdate(reg.id, reg.profile_id, 'absent')}
                              className="px-3 py-1.5 rounded-xl bg-black/5 hover:bg-black/10 text-black/60 text-xs font-bold transition whitespace-nowrap">Gelmedi</button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ÜYE EKLE MODAL */}
      {isAddMemberModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md" onClick={closeAddMemberModal}>
          <div className="w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto bg-white/85 backdrop-blur-xl border border-white/60 rounded-3xl shadow-2xl p-8" onClick={e => e.stopPropagation()}>
            {newMemberCode ? (
              <div className="flex flex-col items-center text-center gap-6 py-4">
                <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl" style={{ backgroundColor: themeColor + '22' }}>🎉</div>
                <div className="flex flex-col gap-1">
                  <h3 className="text-2xl font-bold">Üye Başarıyla Oluşturuldu!</h3>
                  <p className="text-black/50 text-sm font-medium">Aşağıdaki aktivasyon kodunu üyeyle paylaşın.</p>
                </div>
                <div className="w-full flex flex-col items-center gap-3">
                  <div className="w-full rounded-2xl px-6 py-5 flex items-center justify-center border-2"
                    style={{ borderColor: themeColor + '55', backgroundColor: themeColor + '11' }}>
                    <span className="font-mono font-black tracking-[0.25em] text-4xl" style={{ color: themeColor }}>{newMemberCode}</span>
                  </div>
                  <button
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(newMemberCode); setMemberCodeCopied(true); setTimeout(() => setMemberCodeCopied(false), 2000); } catch {}
                    }}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold border transition-all duration-200 ${memberCodeCopied ? 'bg-emerald-400/20 text-emerald-700 border-emerald-300/50' : 'bg-white/60 hover:bg-white/80 border-black/10'}`}
                  >
                    {memberCodeCopied ? '✓ Kopyalandı!' : 'Kodu Kopyala'}
                  </button>
                </div>
                <p className="text-xs text-black/40 leading-relaxed max-w-xs">
                  Bu kodu üyeyle paylaşın. Üye, mobil uygulamaya bu kodla ilk girişini gerçekleştirecektir.
                </p>
                <button onClick={closeAddMemberModal} style={{ backgroundColor: themeColor }}
                  className="w-full py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition mt-2">
                  Kapat
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-7">
                  <div>
                    <h3 className="text-xl font-bold">Yeni Üye Ekle</h3>
                    <p className="text-sm text-black/40 mt-0.5">Üye bilgilerini eksiksiz doldurun</p>
                  </div>
                  <button onClick={closeAddMemberModal} className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-black/50 font-bold transition mt-1">✕</button>
                </div>
                <form onSubmit={handleAddMember} className="flex flex-col gap-5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-black/50">Ad Soyad</label>
                    <input type="text" name="fullName" value={memberForm.fullName} onChange={handleMemberFormChange} placeholder="Ahmet Yılmaz" className={inputClass} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-semibold text-black/50">E-posta Adresi</label>
                      <input type="email" name="email" value={memberForm.email} onChange={handleMemberFormChange} placeholder="ahmet@mail.com" className={inputClass} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-semibold text-black/50">Telefon Numarası</label>
                      <input type="tel" name="phone" value={memberForm.phone} onChange={handleMemberFormChange} placeholder="5551234567" className={inputClass} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-black/50">Üyelik Paketi</label>
                    <select
                      value={memberForm.membershipTypeId}
                      onChange={e => handleMemberTypeChange(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Paket seçin...</option>
                      {membershipTypes.map(t => (
                        <option key={t.id} value={t.id}>{t.name} ({t.default_lesson_count} ders)</option>
                      ))}
                    </select>
                    {membershipTypes.length === 0 && (
                      <p className="text-xs text-amber-600/70">
                        Önce{' '}
                        <button type="button" onClick={() => { closeAddMemberModal(); setActiveTab('packages'); }} className="underline font-semibold">
                          Üyelik Paketleri
                        </button>{' '}
                        sayfasından paket oluşturun.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-between border border-black/5 bg-black/[0.02] rounded-2xl px-5 py-4">
                    <div>
                      <p className="text-sm font-semibold text-black/70">Sınırsız Paket</p>
                      <p className="text-xs text-black/40 mt-0.5">
                        {memberForm.isUnlimited ? 'Ders hakkı sınırsız ∞' : 'Belirli ders hakkına sahip'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMemberForm(prev => ({ ...prev, isUnlimited: !prev.isUnlimited }))}
                      className="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-300 focus:outline-none"
                      style={{ backgroundColor: memberForm.isUnlimited ? themeColor : 'rgba(0,0,0,0.15)' }}
                    >
                      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-300 ${memberForm.isUnlimited ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>
                  {!memberForm.isUnlimited && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-semibold text-black/50">
                        Kalan Ders Hakkı
                        {memberForm.membershipTypeId && (
                          <span className="ml-2 text-black/30 font-normal">(manuel değiştirebilirsiniz)</span>
                        )}
                      </label>
                      <input type="number" name="packageLessons" value={memberForm.packageLessons} onChange={handleMemberFormChange} min="0" className={inputClass} />
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-semibold text-black/50">Üye Seviyesi</label>
                      <div className="flex items-center gap-2">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${levelInfo(memberForm.memberLevel).bg} ${levelInfo(memberForm.memberLevel).text}`}>
                          {levelInfo(memberForm.memberLevel).label}
                        </span>
                        <span className="font-bold text-sm">
                          {memberForm.memberLevel}<span className="text-black/30 font-normal">/10</span>
                        </span>
                      </div>
                    </div>
                    <input
                      type="range" min="1" max="10" step="1"
                      value={memberForm.memberLevel}
                      onChange={e => setMemberForm(prev => ({ ...prev, memberLevel: Number(e.target.value) }))}
                      className="w-full h-2 rounded-full outline-none cursor-pointer"
                      style={{ accentColor: themeColor }}
                    />
                    <div className="flex justify-between text-xs text-black/25 px-0.5 select-none">
                      <span>1</span><span>5</span><span>10</span>
                    </div>
                  </div>
                  {memberFormError && <p className="text-sm text-red-500/80 font-medium -mt-1">{memberFormError}</p>}
                  <div className="flex gap-3 mt-2">
                    <button type="button" onClick={closeAddMemberModal} className="flex-1 py-3 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 font-semibold text-sm transition">İptal</button>
                    <button type="submit" disabled={isMemberSubmitting} style={{ backgroundColor: themeColor }} className="flex-1 py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition">
                      {isMemberSubmitting ? 'Kaydediliyor...' : 'Üyeyi Kaydet'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* ÜYE DÜZENLE MODAL */}
      {isEditModalOpen && selectedMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md" onClick={closeEditModal}>
          <div className="w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto bg-white/85 backdrop-blur-xl border border-white/60 rounded-3xl shadow-2xl p-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-7">
              <div>
                <h3 className="text-xl font-bold">Üyeyi Düzenle</h3>
                <p className="text-sm text-black/40 mt-0.5">{selectedMember.full_name}</p>
              </div>
              <button onClick={closeEditModal} className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-black/50 font-bold transition">✕</button>
            </div>
            <form onSubmit={handleUpdateMember} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-black/50">Ad Soyad</label>
                <input type="text" name="fullName" value={editForm.fullName} onChange={handleEditFormChange} placeholder="Ahmet Yılmaz" className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-black/50">E-posta</label>
                  <input type="email" name="email" value={editForm.email} onChange={handleEditFormChange} placeholder="ahmet@mail.com" className={inputClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-black/50">Telefon</label>
                  <input type="tel" name="phone" value={editForm.phone} onChange={handleEditFormChange} placeholder="5551234567" className={inputClass} />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-black/50">Üyelik Paketi</label>
                <select
                  value={editForm.membershipTypeId}
                  onChange={e => handleEditTypeChange(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Paket seçin...</option>
                  {membershipTypes.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.default_lesson_count} ders)</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between border border-black/5 bg-black/[0.02] rounded-2xl px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-black/70">Sınırsız Paket</p>
                  <p className="text-xs text-black/40 mt-0.5">
                    {editForm.isUnlimited ? 'Ders hakkı sınırsız ∞' : 'Belirli ders hakkına sahip'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditForm(prev => ({ ...prev, isUnlimited: !prev.isUnlimited }))}
                  className="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-300 focus:outline-none"
                  style={{ backgroundColor: editForm.isUnlimited ? themeColor : 'rgba(0,0,0,0.15)' }}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-300 ${editForm.isUnlimited ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
              {!editForm.isUnlimited && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-black/50">
                    Kalan Ders Hakkı
                    <span className="ml-2 text-black/30 font-normal">(manuel değiştirebilirsiniz)</span>
                  </label>
                  <input type="number" name="remainingLessons" value={editForm.remainingLessons} onChange={handleEditFormChange} min="0" className={inputClass} />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-black/50">Üye Seviyesi</label>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${levelInfo(editForm.memberLevel ?? 1).bg} ${levelInfo(editForm.memberLevel ?? 1).text}`}>
                      {levelInfo(editForm.memberLevel ?? 1).label}
                    </span>
                    <span className="font-bold text-sm">
                      {editForm.memberLevel ?? 1}<span className="text-black/30 font-normal">/10</span>
                    </span>
                  </div>
                </div>
                <input
                  type="range" min="1" max="10" step="1"
                  value={editForm.memberLevel ?? 1}
                  onChange={e => setEditForm(prev => ({ ...prev, memberLevel: Number(e.target.value) }))}
                  className="w-full h-2 rounded-full outline-none cursor-pointer"
                  style={{ accentColor: themeColor }}
                />
                <div className="flex justify-between text-xs text-black/25 px-0.5 select-none">
                  <span>1</span><span>5</span><span>10</span>
                </div>
              </div>
              <div className="flex items-center justify-between border border-black/5 bg-black/[0.02] rounded-2xl px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-black/70">Üye Durumu</p>
                  <p className="text-xs text-black/40 mt-0.5">
                    {editForm.isActivated ? 'Aktif — Uygulamaya giriş yapabilir' : 'Pasif — Uygulamaya giriş yapamaz'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditForm(prev => ({ ...prev, isActivated: !prev.isActivated }))}
                  className="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-300 focus:outline-none"
                  style={{ backgroundColor: editForm.isActivated ? themeColor : 'rgba(0,0,0,0.15)' }}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-300 ${editForm.isActivated ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
              {editFormError && <p className="text-sm text-red-500/80 font-medium -mt-1">{editFormError}</p>}
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={closeEditModal} className="flex-1 py-3 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 font-semibold text-sm transition">İptal</button>
                <button
                  type="submit"
                  disabled={isEditSubmitting}
                  style={{ backgroundColor: themeColor }}
                  className="flex-1 py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition flex items-center justify-center gap-2"
                >
                  {isEditSubmitting ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Kaydediliyor...
                    </>
                  ) : 'Değişiklikleri Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CHECK-IN TOAST */}
      {checkInToast && (
        <div
          className="fixed top-6 right-6 z-[100] flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl text-white text-sm font-semibold backdrop-blur-xl transition-all duration-300 max-w-sm"
          style={{ backgroundColor: checkInToast.success ? '#10b981' : '#ef4444' }}
        >
          <span className="text-xl flex-shrink-0">{checkInToast.success ? '✅' : '❌'}</span>
          <span className="leading-snug">{checkInToast.message}</span>
        </div>
      )}

    </div>
  );
}
