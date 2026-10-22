import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from './supabaseClient';
import WeeklyCalendar from './components/WeeklyCalendar';
import StudioSettings from './components/StudioSettings';
import MemberDetailDrawer from './components/MemberDetailDrawer';
import BulkImportModal from './components/BulkImportModal';
import InstructorsTab from './components/InstructorsTab';
import InstructorSelect from './components/InstructorSelect';

const glassStyle = "bg-white/25 backdrop-blur-xl border border-white/40 shadow-sm rounded-3xl";
const QR_PREFIX  = 'STUDIOM-';

const WEEK_DAYS = [
  { label: 'Pzt', value: 1 }, { label: 'Sal', value: 2 },
  { label: 'Çar', value: 3 }, { label: 'Per', value: 4 },
  { label: 'Cum', value: 5 }, { label: 'Cmt', value: 6 },
  { label: 'Paz', value: 0 },
];

const EMPTY_FORM = {
  title: '', instructorName: '', instructorId: '', startTime: '', endTime: '',
  maxCapacity: 15, isRecurring: false, selectedDays: [], endDate: '',
};
const EMPTY_MEMBER_FORM = {
  fullName: '', email: '', phone: '',
  membershipTypeId: '', packageLessons: 0, memberLevel: 1, isUnlimited: false,
  membershipStartDate: '', membershipEndDate: '',
};
const EMPTY_AUTH_FORM = { email: '', password: '' };

const inputClass =
  "w-full bg-white/50 border border-black/10 rounded-xl px-4 py-3 text-sm font-medium " +
  "placeholder:text-black/30 outline-none focus:border-black/30 focus:bg-white/70 transition";

function formatTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso) {
  if (!iso) return '-';
  const date = new Date(iso);
  const dayMonth = date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  const weekday  = date.toLocaleDateString('tr-TR', { weekday: 'short' });
  return `${dayMonth}, ${weekday}`;
}

function formatDateShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function generateMemberCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return `STM-${s}`;
}

function buildRecurringSessions(formData, studioId) {
  const startDT    = new Date(formData.startTime);
  const hours      = startDT.getHours(), minutes = startDT.getMinutes();
  const durationMs = formData.endTime
    ? new Date(formData.endTime).getTime() - startDT.getTime()
    : 3600000;
  const cursor = new Date(startDT.getFullYear(), startDT.getMonth(), startDT.getDate());
  const [ey, em, ed] = formData.endDate.split('-').map(Number);
  const endDT  = new Date(ey, em - 1, ed, 23, 59, 59, 999);
  const sessions = [];
  while (cursor <= endDT) {
    if (formData.selectedDays.includes(cursor.getDay())) {
      const s = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), hours, minutes);
      sessions.push({
        studio_id: studioId, title: formData.title.trim(),
        instructor_name: formData.instructorName.trim() || null,
        instructor_id:   formData.instructorId || null,
        start_time: s.toISOString(),
        end_time: new Date(s.getTime() + durationMs).toISOString(),
        max_capacity: Number(formData.maxCapacity), current_capacity: 0,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return sessions;
}

function getMemberStatus(member) {
  if (!member.is_activated) return 'inactive';
  if (!member.membership_end_date) return 'active';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end   = new Date(member.membership_end_date);
  const diff  = Math.ceil((end - today) / 86400000);
  if (diff < 0) return 'expired';
  if (diff <= 7) return 'expiring';
  return 'active';
}

function StatusBadge({ status }) {
  const map = {
    active:   { label: 'Aktif',           cls: 'bg-emerald-400/20 text-emerald-700' },
    expiring: { label: 'Yakında Bitiyor', cls: 'bg-amber-400/20 text-amber-700'    },
    expired:  { label: 'Süresi Doldu',    cls: 'bg-red-400/20 text-red-600'        },
    inactive: { label: 'Pasif',           cls: 'bg-black/10 text-black/40'         },
  };
  const { label, cls } = map[status] ?? map.active;
  return <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${cls}`}>{label}</span>;
}

export default function App() {
  // Auth
  const [user,        setUser]        = useState(null);
  const [authForm,    setAuthForm]    = useState(EMPTY_AUTH_FORM);
  const [authError,   setAuthError]   = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Navigation
  const [activeTab, setActiveTab] = useState('overview');

  // Classes
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Members
  const [totalMembers,        setTotalMembers]        = useState(0);
  const [totalMembersLoading, setTotalMembersLoading] = useState(false);
  const [members,             setMembers]             = useState([]);
  const [membersLoading,      setMembersLoading]      = useState(false);
  const [memberSearch,        setMemberSearch]        = useState('');

  // Expiring / check-ins
  const [expiringMembers, setExpiringMembers] = useState([]);
  const [todayCheckIns,   setTodayCheckIns]   = useState(0);

  // Membership packages
  const [membershipTypes,        setMembershipTypes]        = useState([]);
  const [membershipTypesLoading, setMembershipTypesLoading] = useState(false);
  const [pkgForm,                setPkgForm]                = useState({ name: '', defaultLessonCount: 10, isUnlimited: false });
  const [isPkgSubmitting,        setIsPkgSubmitting]        = useState(false);
  const [pkgError,               setPkgError]              = useState('');

  // Edit member modal
  const [isEditModalOpen,  setIsEditModalOpen]  = useState(false);
  const [selectedMember,   setSelectedMember]   = useState(null);
  const [editForm,         setEditForm]         = useState({});
  const [editFormError,    setEditFormError]    = useState('');
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);

  // Instructors
  const [instructors,       setInstructors]       = useState([]);
  const [classImageFile,    setClassImageFile]    = useState(null);
  const [classImagePreview, setClassImagePreview] = useState(null);

  // Bulk import
  const [showBulkImport, setShowBulkImport] = useState(false);

  // Add member modal
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [memberForm,           setMemberForm]           = useState(EMPTY_MEMBER_FORM);
  const [memberFormError,      setMemberFormError]      = useState('');
  const [isMemberSubmitting,   setIsMemberSubmitting]   = useState(false);
  const [newMemberCode,        setNewMemberCode]        = useState(null);
  const [memberCodeCopied,     setMemberCodeCopied]     = useState(false);

  // Attendance modal
  const [attendanceClass,      setAttendanceClass]      = useState(null);
  const [registrations,        setRegistrations]        = useState([]);
  const [registrationsLoading, setRegistrationsLoading] = useState(false);

  // QR
  const [qrInput,      setQrInput]      = useState('');
  const [checkInToast, setCheckInToast] = useState(null);

  // Studio settings
  const [studioId,       setStudioId]       = useState(null);
  const [themeColor,     setThemeColor]     = useState('#D4447A');
  const [secondaryColor, setSecondaryColor] = useState('#F3B6CC');
  const [studioCode,     setStudioCode]     = useState('');
  const [logoUrl,        setLogoUrl]        = useState(null);

  // New class modal
  const [isModalOpen,  setIsModalOpen]  = useState(false);
  const [formData,     setFormData]     = useState(EMPTY_FORM);
  const [formError,    setFormError]    = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit class modal
  const [editingClass,          setEditingClass]          = useState(null);
  const [classEditForm,         setClassEditForm]         = useState({});
  const [classEditError,        setClassEditError]        = useState('');
  const [classEditSubmitting,   setClassEditSubmitting]   = useState(false);
  const [classEditImageFile,    setClassEditImageFile]    = useState(null);
  const [classEditImagePreview, setClassEditImagePreview] = useState(null);

  // Member detail drawer
  const [memberDetail, setMemberDetail] = useState(null);

  // ── Auth Session ────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) { setUser(session.user); fetchStudioSettings(session.user.id); }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) { setUser(null); setStudioId(null); }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (studioId) {
      fetchClasses();
      fetchTotalMembers();
      fetchMembershipTypes();
      fetchExpiringMembers();
      fetchTodayCheckIns();
      fetchInstructors();
    }
  }, [studioId]);

  useEffect(() => { if (activeTab === 'members' && studioId) fetchMembers(); }, [activeTab, studioId]);

  // ── Data Fetching ───────────────────────────────────────
  async function fetchInstructors() {
    const { data } = await supabase
      .from('instructors').select('id, full_name, profile_image_url, is_active')
      .eq('studio_id', studioId).eq('is_active', true).order('full_name');
    setInstructors(data ?? []);
  }

  async function fetchClasses() {
    setLoading(true); setError(null);
    const { data, error } = await supabase
      .from('classes')
      .select('id, start_time, end_time, title, instructor_name, instructor_id, image_url, current_capacity, max_capacity, instructors(full_name, profile_image_url)')
      .eq('studio_id', studioId)
      .order('start_time', { ascending: true });
    if (error) setError(error.message); else setClasses(data ?? []);
    setLoading(false);
  }

  async function fetchMembers() {
    setMembersLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, membership_type_id, remaining_lessons, last_check_in, is_activated, member_level, is_unlimited, member_code, membership_start_date, membership_end_date, last_payment_date')
      .eq('studio_id', studioId)
      .order('full_name', { ascending: true });
    if (data) setMembers(data);
    setMembersLoading(false);
  }

  async function fetchTotalMembers() {
    setTotalMembersLoading(true);
    const { count } = await supabase
      .from('profiles').select('*', { count: 'exact', head: true }).eq('studio_id', studioId);
    if (count !== null) setTotalMembers(count);
    setTotalMembersLoading(false);
  }

  async function fetchExpiringMembers() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const in14  = new Date(today); in14.setDate(today.getDate() + 14);
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, membership_end_date')
      .eq('studio_id', studioId)
      .gte('membership_end_date', today.toISOString().split('T')[0])
      .lte('membership_end_date', in14.toISOString().split('T')[0])
      .order('membership_end_date', { ascending: true });
    setExpiringMembers(data ?? []);
  }

  async function fetchTodayCheckIns() {
    const d = new Date().toISOString().split('T')[0];
    const { count } = await supabase
      .from('profiles').select('*', { count: 'exact', head: true })
      .eq('studio_id', studioId)
      .gte('last_check_in', `${d}T00:00:00`)
      .lte('last_check_in', `${d}T23:59:59`);
    setTodayCheckIns(count ?? 0);
  }

  async function fetchStudioSettings(userId) {
    const { data, error } = await supabase
      .from('studios')
      .select('id, theme_color, secondary_color, studio_code, logo_url')
      .eq('owner_id', userId)
      .single();
    if (!error && data) {
      setStudioId(data.id);
      setThemeColor(data.theme_color ?? '#D4447A');
      setSecondaryColor(data.secondary_color ?? '#F3B6CC');
      setStudioCode(data.studio_code ?? '');
      setLogoUrl(data.logo_url ?? null);
    }
  }

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

  // ── Auth ────────────────────────────────────────────────
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

  // ── Attendance ──────────────────────────────────────────
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
        if (!profile.is_unlimited && profile.remaining_lessons > 0)
          updates.remaining_lessons = profile.remaining_lessons - 1;
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
    fetchTodayCheckIns();
  }

  // ── QR Check-in ─────────────────────────────────────────
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
    if (profileError || !profile) { showToast(false, 'Üye bulunamadı.'); return; }
    if (!profile.is_unlimited && (profile.remaining_lessons ?? 0) <= 0) {
      showToast(false, `${profile.full_name} — Kalan ders hakkı yok.`); return;
    }
    const now = new Date();
    const ws  = new Date(now.getTime() - 7200000).toISOString();
    const we  = new Date(now.getTime() + 7200000).toISOString();
    const { data: nearbyClasses } = await supabase
      .from('classes').select('id').eq('studio_id', studioId).gte('start_time', ws).lte('start_time', we);
    const ids = (nearbyClasses ?? []).map(c => c.id);
    if (!ids.length) { showToast(false, `${profile.full_name} — Bu saatte aktif ders yok.`); return; }
    const { data: reg } = await supabase
      .from('class_registrations').select('id')
      .eq('profile_id', profileId).in('class_id', ids).eq('status', 'enrolled').maybeSingle();
    if (!reg) { showToast(false, `${profile.full_name} — Kayıtlı ders bulunamadı.`); return; }
    await supabase.from('class_registrations').update({ status: 'attended' }).eq('id', reg.id);
    if (profile.is_unlimited) {
      await supabase.from('profiles').update({ last_check_in: now.toISOString() }).eq('id', profileId);
      showToast(true, `Giriş: ${profile.full_name} — Sınırsız ∞`);
    } else {
      const nl = Math.max(0, profile.remaining_lessons - 1);
      await supabase.from('profiles').update({ remaining_lessons: nl, last_check_in: now.toISOString() }).eq('id', profileId);
      showToast(true, `Giriş: ${profile.full_name} — Kalan: ${nl}`);
    }
    fetchTodayCheckIns();
  }

  // ── Class Modal ─────────────────────────────────────────
  function openModal()  { setIsModalOpen(true); }
  function closeModal() {
    setIsModalOpen(false); setFormData(EMPTY_FORM); setFormError('');
    setClassImageFile(null); setClassImagePreview(null);
  }

  function handleFormChange(e) {
    const { name, value } = e.target;
    setFormData(prev => {
      const u = { ...prev, [name]: value };
      if (name === 'startTime' && value) {
        const s = new Date(value);
        const ae = new Date(s.getTime() + 3600000);
        const p  = n => String(n).padStart(2, '0');
        u.endTime = `${ae.getFullYear()}-${p(ae.getMonth()+1)}-${p(ae.getDate())}T${p(ae.getHours())}:${p(ae.getMinutes())}`;
      }
      return u;
    });
  }

  function toggleRecurring() { setFormData(prev => ({ ...prev, isRecurring: !prev.isRecurring, selectedDays: [], endDate: '' })); }
  function toggleDay(v) {
    setFormData(prev => ({
      ...prev,
      selectedDays: prev.selectedDays.includes(v) ? prev.selectedDays.filter(d => d !== v) : [...prev.selectedDays, v],
    }));
  }

  async function handleClassImageSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
      setFormError('Yalnızca JPG, PNG veya WEBP desteklenir.'); return;
    }
    if (file.size > 5 * 1024 * 1024) { setFormError('Görsel 5 MB limitini aşıyor.'); return; }
    setFormError('');
    setClassImageFile(file);
    setClassImagePreview(URL.createObjectURL(file));
    e.target.value = '';
  }

  async function uploadClassImage(classId) {
    if (!classImageFile) return null;
    const ext  = classImageFile.name.split('.').pop().toLowerCase();
    const path = `classes/${studioId}/${classId}/cover_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('studio-assets').upload(path, classImageFile, { upsert: true });
    if (error) return null;
    const { data: { publicUrl } } = supabase.storage.from('studio-assets').getPublicUrl(path);
    return publicUrl;
  }

  async function handleAddClass(e) {
    e.preventDefault();
    if (!formData.title.trim() || !formData.startTime || !formData.endTime) {
      setFormError('Lütfen zorunlu alanları doldurun.'); return;
    }
    if (new Date(formData.endTime) <= new Date(formData.startTime)) {
      setFormError('Bitiş saati başlangıçtan sonra olmalı.'); return;
    }
    if (instructors.length > 0 && !formData.instructorId) {
      setFormError('Lütfen bir eğitmen seçin.'); return;
    }
    if (formData.isRecurring) {
      if (!formData.selectedDays.length) { setFormError('En az bir gün seçin.'); return; }
      if (!formData.endDate) { setFormError('Bitiş tarihini girin.'); return; }
    }
    setIsSubmitting(true); setFormError('');

    if (formData.isRecurring) {
      const sessions = buildRecurringSessions(formData, studioId);
      if (!sessions.length) { setFormError('Seçilen aralıkta uygun gün yok.'); setIsSubmitting(false); return; }
      const { data: inserted, error } = await supabase.from('classes').insert(sessions).select('id');
      if (error) { setFormError(error.message); setIsSubmitting(false); return; }
      if (classImageFile && inserted?.length) {
        const imageUrl = await uploadClassImage(inserted[0].id);
        if (imageUrl) {
          const ids = inserted.map(r => r.id);
          await supabase.from('classes').update({ image_url: imageUrl }).in('id', ids);
        }
      }
    } else {
      const { data: inserted, error } = await supabase.from('classes').insert({
        studio_id:        studioId,
        title:            formData.title.trim(),
        instructor_id:    formData.instructorId || null,
        start_time:       formData.startTime,
        end_time:         formData.endTime,
        max_capacity:     Number(formData.maxCapacity),
        current_capacity: 0,
      }).select('id').single();
      if (error) { setFormError(error.message); setIsSubmitting(false); return; }
      if (classImageFile && inserted?.id) {
        const imageUrl = await uploadClassImage(inserted.id);
        if (imageUrl) await supabase.from('classes').update({ image_url: imageUrl }).eq('id', inserted.id);
      }
    }
    setIsSubmitting(false);
    closeModal(); fetchClasses();
  }

  // ── Edit Class ───────────────────────────────────────────
  function openEditClass(cls) {
    setEditingClass(cls);
    setClassEditForm({
      title:        cls.title,
      instructorId: cls.instructor_id || '',
      startTime:    cls.start_time ? cls.start_time.slice(0, 16) : '',
      endTime:      cls.end_time   ? cls.end_time.slice(0, 16)   : '',
      maxCapacity:  cls.max_capacity,
    });
    setClassEditError('');
    setClassEditImageFile(null);
    setClassEditImagePreview(cls.image_url || null);
  }

  function closeEditClass() {
    setEditingClass(null);
    setClassEditImageFile(null);
    setClassEditImagePreview(null);
    setClassEditError('');
  }

  async function handleClassEditImageSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
      setClassEditError('Yalnızca JPG, PNG veya WEBP desteklenir.'); return;
    }
    if (file.size > 5 * 1024 * 1024) { setClassEditError('Görsel 5 MB limitini aşıyor.'); return; }
    setClassEditError('');
    setClassEditImageFile(file);
    setClassEditImagePreview(URL.createObjectURL(file));
    e.target.value = '';
  }

  async function handleUpdateClass(e) {
    e.preventDefault();
    if (!classEditForm.title.trim() || !classEditForm.startTime || !classEditForm.endTime) {
      setClassEditError('Lütfen zorunlu alanları doldurun.'); return;
    }
    if (new Date(classEditForm.endTime) <= new Date(classEditForm.startTime)) {
      setClassEditError('Bitiş saati başlangıçtan sonra olmalı.'); return;
    }
    if (instructors.length > 0 && !classEditForm.instructorId) {
      setClassEditError('Lütfen bir eğitmen seçin.'); return;
    }
    setClassEditSubmitting(true); setClassEditError('');

    let imageUrl = editingClass.image_url || null;
    if (classEditImageFile) {
      const ext  = classEditImageFile.name.split('.').pop().toLowerCase();
      const path = `classes/${studioId}/${editingClass.id}/cover_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('studio-assets').upload(path, classEditImageFile, { upsert: true });
      if (!upErr) {
        const { data: { publicUrl } } = supabase.storage.from('studio-assets').getPublicUrl(path);
        imageUrl = publicUrl;
      }
    }

    const { error } = await supabase.from('classes').update({
      title:        classEditForm.title.trim(),
      instructor_id: classEditForm.instructorId || null,
      start_time:   classEditForm.startTime,
      end_time:     classEditForm.endTime,
      max_capacity: Number(classEditForm.maxCapacity),
      image_url:    imageUrl,
    }).eq('id', editingClass.id);

    setClassEditSubmitting(false);
    if (error) { setClassEditError(error.message); return; }
    closeEditClass(); fetchClasses();
    showToast(true, 'Ders güncellendi.');
  }

  // ── Packages ────────────────────────────────────────────
  async function handleAddPackage(e) {
    e.preventDefault();
    if (!pkgForm.name.trim()) { setPkgError('Paket adı zorunludur.'); return; }
    if (!pkgForm.isUnlimited && Number(pkgForm.defaultLessonCount) < 1) { setPkgError('Ders hakkı en az 1.'); return; }
    setIsPkgSubmitting(true); setPkgError('');
    const { error } = await supabase.from('membership_types').insert({
      studio_id: studioId, name: pkgForm.name.trim(),
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
    if (error) { showToast(false, 'Paket silinemedi.'); return; }
    setMembershipTypes(prev => prev.filter(t => t.id !== id));
    showToast(true, `"${name}" silindi.`);
  }

  // ── Add Member ──────────────────────────────────────────
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
      ...prev, membershipTypeId: typeId,
      packageLessons: type ? type.default_lesson_count : prev.packageLessons,
      isUnlimited:    type ? type.is_unlimited : prev.isUnlimited,
    }));
  }

  async function handleAddMember(e) {
    e.preventDefault();
    if (!studioId) { setMemberFormError('Stüdyo yükleniyor...'); return; }
    if (!memberForm.fullName.trim() || !memberForm.email.trim() || !memberForm.phone.trim()) {
      setMemberFormError('Ad, e-posta ve telefon zorunludur.'); return;
    }
    setIsMemberSubmitting(true); setMemberFormError('');
    const memberCode = generateMemberCode();
    const { error } = await supabase.from('profiles').insert({
      id: crypto.randomUUID(), studio_id: studioId,
      full_name: memberForm.fullName.trim(), email: memberForm.email.trim(),
      phone: memberForm.phone.trim(),
      membership_type_id:    memberForm.membershipTypeId || null,
      remaining_lessons:     memberForm.isUnlimited ? 0 : Number(memberForm.packageLessons),
      is_unlimited:          memberForm.isUnlimited,
      last_check_in:         null, member_code: memberCode, is_activated: false,
      member_level:          Number(memberForm.memberLevel),
      membership_start_date: memberForm.membershipStartDate || null,
      membership_end_date:   memberForm.membershipEndDate   || null,
    });
    setIsMemberSubmitting(false);
    if (error) { setMemberFormError(error.message); return; }
    setNewMemberCode(memberCode); fetchMembers(); fetchTotalMembers(); fetchExpiringMembers();
  }

  // ── Edit Member ─────────────────────────────────────────
  function openEditModal(member) {
    setSelectedMember(member);
    setEditForm({
      fullName:            member.full_name            ?? '',
      email:               member.email                ?? '',
      phone:               member.phone                ?? '',
      remainingLessons:    member.remaining_lessons    ?? 0,
      membershipTypeId:    member.membership_type_id   ?? '',
      isActivated:         member.is_activated         ?? false,
      memberLevel:         member.member_level          ?? 1,
      isUnlimited:         member.is_unlimited          ?? false,
      membershipStartDate: member.membership_start_date ?? '',
      membershipEndDate:   member.membership_end_date   ?? '',
    });
    setEditFormError('');
    setIsEditModalOpen(true);
  }
  function closeEditModal() { setIsEditModalOpen(false); setSelectedMember(null); setEditFormError(''); }
  function handleEditFormChange(e) {
    const { name, value } = e.target;
    setEditForm(prev => ({ ...prev, [name]: value }));
  }
  function handleEditTypeChange(typeId) {
    const type = membershipTypes.find(t => t.id === typeId);
    setEditForm(prev => ({
      ...prev, membershipTypeId: typeId,
      ...(type ? { remainingLessons: type.default_lesson_count, isUnlimited: type.is_unlimited } : {}),
    }));
  }

  async function handleUpdateMember(e) {
    e.preventDefault();
    if (!editForm.fullName.trim()) { setEditFormError('Ad Soyad zorunludur.'); return; }
    setIsEditSubmitting(true); setEditFormError('');
    const { error } = await supabase.from('profiles').update({
      full_name:             editForm.fullName.trim(),
      email:                 editForm.email.trim(),
      phone:                 editForm.phone.trim(),
      remaining_lessons:     editForm.isUnlimited ? 0 : Number(editForm.remainingLessons),
      membership_type_id:    editForm.membershipTypeId || null,
      is_activated:          editForm.isActivated,
      member_level:          Number(editForm.memberLevel),
      is_unlimited:          editForm.isUnlimited,
      membership_start_date: editForm.membershipStartDate || null,
      membership_end_date:   editForm.membershipEndDate   || null,
    }).eq('id', selectedMember.id);
    setIsEditSubmitting(false);
    if (error) { setEditFormError(error.message); showToast(false, 'Güncelleme hatası.'); return; }
    fetchMembers(); fetchExpiringMembers();
    closeEditModal();
    showToast(true, `${editForm.fullName.trim()} güncellendi.`);
  }

  // ── Helpers ─────────────────────────────────────────────
  function levelInfo(level) {
    if (level <= 3) return { label: 'Başlangıç', bg: 'bg-emerald-400/20', text: 'text-emerald-700' };
    if (level <= 7) return { label: 'Orta',      bg: 'bg-amber-400/20',   text: 'text-amber-700'   };
    return              { label: 'İleri',      bg: 'bg-purple-400/20',  text: 'text-purple-700'  };
  }

  const todayClasses = useMemo(() => {
    const todayStr = new Date().toDateString();
    return classes.filter(c => new Date(c.start_time).toDateString() === todayStr);
  }, [classes]);

  const occupancyRate = useMemo(() => {
    if (!classes.length) return 0;
    const tc = classes.reduce((s, c) => s + (c.current_capacity ?? 0), 0);
    const tm = classes.reduce((s, c) => s + (c.max_capacity ?? 0), 0);
    return tm ? Math.round((tc / tm) * 100) : 0;
  }, [classes]);

  const filteredMembers = members.filter(m =>
    (m.full_name ?? '').toLowerCase().includes(memberSearch.toLowerCase())
  );

  function navStyle(tab) { return tab === activeTab ? { backgroundColor: themeColor } : {}; }
  function navClass(tab) {
    return `w-full text-left px-4 py-3 rounded-xl font-semibold transition text-sm ${
      tab === activeTab ? 'text-white' : 'text-black/70 font-medium hover:bg-white/30'
    }`;
  }

  // ── AUTH SCREEN ─────────────────────────────────────────
  if (!user) return (
    <div className="min-h-screen bg-gradient-to-br from-[#FDF1E7] to-[#D3ECEB] flex items-center justify-center p-6 font-sans text-[#1A1A1A]">
      <div className={`w-full max-w-sm p-8 ${glassStyle}`}>
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-white/60 rounded-full flex items-center justify-center mb-4">
            <span style={{ color: themeColor }} className="font-black text-xl tracking-tight">S</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Studiom</h1>
          <p className="text-black/40 text-sm mt-1 font-semibold tracking-wider uppercase">Yönetim Paneli</p>
        </div>
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-black/50">E-posta</label>
            <input type="email" name="email" value={authForm.email} onChange={handleAuthFormChange} placeholder="studio@mail.com" className={inputClass} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-black/50">Şifre</label>
            <input type="password" name="password" value={authForm.password} onChange={handleAuthFormChange} placeholder="••••••••" className={inputClass} />
          </div>
          {authError && (
            <div className="flex items-start gap-2.5 bg-red-50/70 border border-red-200/60 rounded-xl px-4 py-3">
              <span className="text-red-400 mt-0.5">⚠</span>
              <p className="text-sm text-red-600/90 font-medium">{authError}</p>
            </div>
          )}
          <button type="submit" disabled={authLoading} style={{ backgroundColor: themeColor }} className="py-3.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition mt-1">
            {authLoading ? 'Giriş Yapılıyor...' : 'Giriş Yap'}
          </button>
        </form>
        <p className="text-center text-xs text-black/30 mt-8 font-medium">Sadece yetkili stüdyo yöneticileri giriş yapabilir.</p>
      </div>
    </div>
  );

  // ── DASHBOARD ───────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FDF1E7] to-[#D3ECEB] flex p-6 gap-6 font-sans text-[#1A1A1A]">

      {/* SIDEBAR */}
      <aside className={`w-60 flex flex-col p-6 ${glassStyle} flex-shrink-0`}>
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-white/60 rounded-full mb-3 overflow-hidden flex items-center justify-center">
            {logoUrl
              ? <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
              : <span style={{ color: themeColor }} className="font-bold text-xl">S</span>
            }
          </div>
          <span className="text-xs font-semibold text-black/50 tracking-wider">YÖNETİM PANELİ</span>
        </div>
        <nav className="flex flex-col gap-1.5 flex-1">
          {[
            { key: 'overview',     label: 'Genel Bakış'      },
            { key: 'schedule',     label: 'Ders Programı'    },
            { key: 'members',      label: 'Üye Yönetimi'     },
            { key: 'instructors',  label: 'Eğitmenler'       },
            { key: 'packages',     label: 'Üyelik Paketleri' },
            { key: 'messages',     label: 'Mesajlar'         },
            { key: 'settings',     label: 'Stüdyo Ayarları'  },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setActiveTab(key)} style={navStyle(key)} className={navClass(key)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="border-t border-white/30 pt-4 mt-4">
          <p className="text-xs text-black/40 font-medium px-1 mb-2 truncate">{user.email}</p>
          <button onClick={handleSignOut} className="w-full text-left px-4 py-2.5 rounded-xl text-sm text-black/60 hover:bg-black/5 hover:text-black/80 transition font-medium">
            Çıkış Yap
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 flex flex-col gap-6 overflow-auto min-w-0">

        {/* ══ GENEL BAKIŞ ══ */}
        {activeTab === 'overview' && (<>
          <header className="flex justify-between items-center mt-2">
            <div>
              <h1 className="text-3xl font-bold">Bugün stüdyoda neler oluyor?</h1>
              <p className="text-black/60 mt-1 font-medium">
                {new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })}
              </p>
            </div>
            <button onClick={openModal} style={{ backgroundColor: themeColor }} className="flex items-center gap-2 text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:opacity-90 transition shadow-sm">
              <span className="text-lg leading-none">+</span> Yeni Ders Ekle
            </button>
          </header>

          {/* Stats */}
          <div className="grid grid-cols-5 gap-4">
            {[
              { emoji: '👤', value: totalMembersLoading ? '—' : totalMembers, label: 'Aktif Üyeler' },
              { emoji: '🏋️', value: loading ? '—' : todayClasses.length,      label: 'Bugünkü Dersler' },
              { emoji: '📊', value: loading ? '—' : `%${occupancyRate}`,      label: 'Ort. Doluluk', bar: true },
              { emoji: '⏰', value: expiringMembers.length,                    label: 'Yakında Bitiyor', accent: expiringMembers.length > 0 },
              { emoji: '✅', value: todayCheckIns,                             label: 'Bugün Giriş' },
            ].map(({ emoji, value, label, bar, accent }) => (
              <div key={label} className={`p-5 flex flex-col gap-2 ${glassStyle}`}>
                <span className="text-xl">{emoji}</span>
                <p className="text-2xl font-bold" style={accent ? { color: themeColor } : {}}>{value}</p>
                <p className="text-sm text-black/50 font-medium">{label}</p>
                {bar && (
                  <div className="w-full bg-black/10 rounded-full h-1.5 mt-1">
                    <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${occupancyRate}%`, backgroundColor: themeColor }} />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-6">
            {/* Classes Table */}
            <div className={`col-span-2 p-6 flex flex-col gap-5 ${glassStyle}`}>
              <h2 className="text-2xl font-bold">Yaklaşan Dersler</h2>
              <table className="w-full">
                <thead>
                  <tr>
                    {['TARİH', 'SAAT', 'DERS ADI', 'EĞİTMEN', 'KAPASİTE', 'YOKLAMA'].map(col => (
                      <th key={col} className="text-left text-xs uppercase opacity-50 font-semibold pb-3 tracking-wider">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="py-8 text-center text-black/40">Yükleniyor...</td></tr>
                  ) : error ? (
                    <tr><td colSpan={6} className="py-8 text-center text-red-500/70">Hata: {error}</td></tr>
                  ) : classes.length === 0 ? (
                    <tr><td colSpan={6} className="py-8 text-center text-black/40">Planlanmış ders yok.</td></tr>
                  ) : (
                    classes.slice(0, 10).map((cls, i) => {
                      const isFull = cls.current_capacity >= cls.max_capacity;
                      return (
                        <tr key={cls.id} className={i < Math.min(classes.length, 10) - 1 ? 'border-b border-white/20' : ''}>
                          <td className="py-3.5 text-black/70 font-medium text-sm">{formatDate(cls.start_time)}</td>
                          <td className="py-3.5 font-bold text-sm" style={{ color: themeColor }}>
                            {formatTime(cls.start_time)}{cls.end_time ? ` – ${formatTime(cls.end_time)}` : ''}
                          </td>
                          <td className="py-3.5 font-semibold text-sm">{cls.title}</td>
                          <td className="py-3.5 text-black/70 text-sm">
                            <div className="flex items-center gap-2">
                              {cls.instructors?.profile_image_url
                                ? <img src={cls.instructors.profile_image_url} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                                : cls.image_url
                                  ? <img src={cls.image_url} alt="" className="w-6 h-6 rounded-lg object-cover flex-shrink-0 opacity-60" />
                                  : null
                              }
                              {cls.instructors?.full_name || cls.instructor_name || '—'}
                            </div>
                          </td>
                          <td className="py-3.5">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${isFull ? 'bg-amber-400/25 text-amber-700' : 'bg-emerald-400/25 text-emerald-700'}`}>
                              {cls.current_capacity}/{cls.max_capacity}
                            </span>
                          </td>
                          <td className="py-3.5">
                            <div className="flex gap-1.5">
                              <button onClick={() => openAttendance(cls)} style={{ backgroundColor: themeColor }} className="px-3 py-1.5 rounded-xl text-white text-xs font-semibold hover:opacity-80 transition">
                                Yoklama
                              </button>
                              <button onClick={() => openEditClass(cls)} className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/60 border border-black/10 hover:bg-white/80 transition">
                                Düzenle
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Expiring Members */}
            <div className={`col-span-1 p-6 flex flex-col gap-4 ${glassStyle}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">Üyeliği Yakında Bitecekler</h2>
                <span className="text-2xl font-bold" style={{ color: themeColor }}>{expiringMembers.length}</span>
              </div>
              {expiringMembers.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 py-8">
                  <span className="text-4xl opacity-20">✅</span>
                  <p className="text-black/40 text-sm font-medium text-center">14 gün içinde biten üyelik yok.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2 flex-1">
                  {expiringMembers.slice(0, 5).map(m => (
                    <div key={m.id} className="flex items-center justify-between bg-white/30 rounded-xl px-3 py-2.5">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: themeColor }}>
                        {m.full_name?.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 px-3 min-w-0">
                        <p className="text-sm font-semibold truncate">{m.full_name}</p>
                      </div>
                      <span className="text-xs font-semibold text-amber-700 bg-amber-400/20 px-2 py-0.5 rounded-full whitespace-nowrap">
                        {formatDateShort(m.membership_end_date)}
                      </span>
                    </div>
                  ))}
                  {expiringMembers.length > 5 && (
                    <p className="text-xs text-black/40 text-center">+{expiringMembers.length - 5} kişi daha</p>
                  )}
                </div>
              )}
              <button
                onClick={() => setActiveTab('members')}
                className="text-sm font-semibold hover:opacity-70 transition text-center mt-auto"
                style={{ color: themeColor }}
              >
                Tümünü Gör →
              </button>

              {/* QR Check-in */}
              <div className="border-t border-white/30 pt-4 mt-2">
                <p className="text-xs font-semibold text-black/40 uppercase tracking-wider mb-2">Hızlı QR Giriş</p>
                <div className="flex gap-2">
                  <input
                    type="text" value={qrInput} onChange={e => setQrInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleQRCheckIn()}
                    placeholder="Üye ID / QR..."
                    className="flex-1 bg-white/50 border border-black/10 rounded-xl px-3 py-2 text-sm font-medium placeholder:text-black/30 outline-none focus:border-black/30 transition"
                  />
                  <button onClick={handleQRCheckIn} style={{ backgroundColor: themeColor }} className="px-3 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition">
                    Giriş
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>)}

        {/* ══ DERS PROGRAMI ══ */}
        {activeTab === 'schedule' && (
          <WeeklyCalendar
            studioId={studioId}
            themeColor={themeColor}
            onAddClass={openModal}
            onAttendance={openAttendance}
            onEditClass={openEditClass}
          />
        )}

        {/* ══ EĞİTMENLER ══ */}
        {activeTab === 'instructors' && (
          <InstructorsTab studioId={studioId} themeColor={themeColor} showToast={showToast} />
        )}

        {/* ══ MESAJLAR ══ */}
        {activeTab === 'messages' && (
          <div className="flex flex-col gap-5">
            <header className="mt-2">
              <h1 className="text-3xl font-bold">Mesajlar</h1>
              <p className="text-black/60 mt-1 font-medium">Üyelerinizle iletişim kurun.</p>
            </header>
            <div className={`${glassStyle} p-16 flex flex-col items-center gap-4`}>
              <span className="text-5xl opacity-20">💬</span>
              <p className="font-semibold text-black/40">Mesajlaşma özelliği çok yakında geliyor.</p>
            </div>
          </div>
        )}

        {/* ══ ÜYE YÖNETİMİ ══ */}
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
                  className="w-full bg-white/50 border border-black/10 rounded-xl pl-10 pr-4 py-3 text-sm font-medium placeholder:text-black/30 outline-none focus:border-black/30 transition"
                />
              </div>
              <button onClick={() => setShowBulkImport(true)} className="flex items-center gap-2 text-black/60 px-5 py-3 rounded-xl font-semibold text-sm bg-white/40 border border-black/10 hover:bg-white/60 transition whitespace-nowrap">
                ⬆ Toplu İçe Aktar
              </button>
              <button onClick={openAddMemberModal} style={{ backgroundColor: themeColor }} className="flex items-center gap-2 text-white px-5 py-3 rounded-xl font-semibold text-sm hover:opacity-90 transition shadow-sm whitespace-nowrap">
                <span>+</span> Üye Ekle
              </button>
            </div>

            <table className="w-full">
              <thead>
                <tr>
                  {['ÜYE ADI', 'PAKETİ', 'KALAN DERS', 'ÜYELİK BİTİŞ', 'DURUM', ''].map((col, i) => (
                    <th key={i} className="text-left text-xs uppercase opacity-50 font-semibold pb-3 tracking-wider">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {membersLoading ? (
                  <tr><td colSpan={6} className="py-8 text-center text-black/40">Yükleniyor...</td></tr>
                ) : filteredMembers.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-black/40">
                    {memberSearch ? 'Sonuç bulunamadı.' : 'Henüz kayıtlı üye yok.'}
                  </td></tr>
                ) : (
                  filteredMembers.map((member, i) => {
                    const memberType = membershipTypes.find(t => t.id === member.membership_type_id);
                    const status     = getMemberStatus(member);
                    return (
                      <tr
                        key={member.id}
                        className={`cursor-pointer hover:bg-white/20 transition ${i < filteredMembers.length - 1 ? 'border-b border-white/20' : ''}`}
                        onClick={() => setMemberDetail(member)}
                      >
                        <td className="py-3.5 font-semibold text-sm">{member.full_name}</td>
                        <td className="py-3.5">
                          {memberType
                            ? <span className="px-2.5 py-1 rounded-full text-xs font-bold text-white" style={{ backgroundColor: themeColor }}>{memberType.name}</span>
                            : <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-black/10 text-black/40">—</span>
                          }
                        </td>
                        <td className="py-3.5 text-sm">
                          {member.is_unlimited
                            ? <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-violet-400/20 text-violet-700">∞</span>
                            : <span className="font-bold">{member.remaining_lessons ?? 0}</span>
                          }
                        </td>
                        <td className="py-3.5 text-sm text-black/60 font-medium">
                          {formatDateShort(member.membership_end_date)}
                        </td>
                        <td className="py-3.5"><StatusBadge status={status} /></td>
                        <td className="py-3.5 text-right" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => openEditModal(member)}
                            className="p-2 rounded-xl hover:bg-black/5 text-black/30 hover:text-black/60 transition"
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

        {/* ══ ÜYELİK PAKETLERİ ══ */}
        {activeTab === 'packages' && (<>
          <header className="mt-2">
            <h1 className="text-3xl font-bold">Üyelik Paketleri</h1>
            <p className="text-black/60 mt-1 font-medium">
              {membershipTypesLoading ? 'Yükleniyor...' : `${membershipTypes.length} paket tanımlı`}
            </p>
          </header>
          <div className="grid grid-cols-3 gap-6">
            <div className={`col-span-1 p-6 flex flex-col gap-5 ${glassStyle}`}>
              <div>
                <h2 className="text-lg font-bold">Yeni Paket Ekle</h2>
                <p className="text-xs text-black/40 mt-1">Üye kayıt formlarında görünecek paket seçeneklerini yönetin.</p>
              </div>
              <form onSubmit={handleAddPackage} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-black/50">Paket Adı</label>
                  <input type="text" value={pkgForm.name} onChange={e => setPkgForm(p => ({ ...p, name: e.target.value }))} placeholder="Aylık Sınırsız" className={inputClass} />
                </div>
                <div className="flex items-center justify-between border border-black/5 bg-black/[0.02] rounded-2xl px-5 py-4">
                  <div>
                    <p className="text-sm font-semibold text-black/70">Sınırsız Paket</p>
                    <p className="text-xs text-black/40 mt-0.5">{pkgForm.isUnlimited ? 'Sınırsız ders hakkı' : 'Belirli ders hakkı'}</p>
                  </div>
                  <button type="button" onClick={() => setPkgForm(p => ({ ...p, isUnlimited: !p.isUnlimited }))}
                    className="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-300"
                    style={{ backgroundColor: pkgForm.isUnlimited ? themeColor : 'rgba(0,0,0,0.15)' }}>
                    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-300 ${pkgForm.isUnlimited ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>
                {!pkgForm.isUnlimited && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-black/50">Varsayılan Ders Hakkı</label>
                    <input type="number" value={pkgForm.defaultLessonCount} onChange={e => setPkgForm(p => ({ ...p, defaultLessonCount: e.target.value }))} min="1" className={inputClass} />
                  </div>
                )}
                {pkgError && <p className="text-sm text-red-500/80 font-medium">{pkgError}</p>}
                <button type="submit" disabled={isPkgSubmitting} style={{ backgroundColor: themeColor }} className="py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition flex items-center justify-center gap-2">
                  {isPkgSubmitting ? 'Kaydediliyor...' : <><span>+</span> Paket Oluştur</>}
                </button>
              </form>
            </div>
            <div className={`col-span-2 p-6 flex flex-col gap-5 ${glassStyle}`}>
              <h2 className="text-lg font-bold">Mevcut Paketler</h2>
              {membershipTypesLoading ? (
                <p className="text-center text-black/40 py-10">Yükleniyor...</p>
              ) : membershipTypes.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-14 text-center">
                  <span className="text-5xl opacity-20">📦</span>
                  <p className="text-black/50 font-semibold">Henüz paket oluşturulmamış</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {membershipTypes.map(type => (
                    <div key={type.id} className="flex items-center justify-between bg-white/30 border border-white/50 rounded-2xl px-5 py-4 hover:bg-white/40 transition">
                      <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-black flex-shrink-0" style={{ backgroundColor: themeColor }}>
                          <span className={type.is_unlimited ? 'text-lg' : 'text-sm'}>{type.is_unlimited ? '∞' : type.default_lesson_count}</span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold">{type.name}</p>
                            {type.is_unlimited && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-400/20 text-violet-700">Sınırsız</span>}
                          </div>
                          <p className="text-xs text-black/40 mt-0.5">{type.is_unlimited ? 'Sınırsız ders hakkı' : `${type.default_lesson_count} ders hakkı`}</p>
                        </div>
                      </div>
                      <button onClick={() => handleDeletePackage(type.id, type.name)} className="p-2 rounded-xl hover:bg-red-50 text-black/20 hover:text-red-400 transition">
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

        {/* ══ STÜDYO AYARLARI ══ */}
        {activeTab === 'settings' && (
          <StudioSettings
            studioId={studioId}
            themeColor={themeColor}
            setThemeColor={c => { setThemeColor(c); supabase.from('studios').update({ theme_color: c }).eq('id', studioId); }}
            secondaryColor={secondaryColor}
            setSecondaryColor={setSecondaryColor}
            logoUrl={logoUrl}
            setLogoUrl={setLogoUrl}
            studioCode={studioCode}
            showToast={showToast}
          />
        )}

      </main>

      {/* ══ MODALS ══ */}

      {/* YENİ DERS */}
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
                <label className="text-sm font-semibold text-black/50">
                  Eğitmen{instructors.length > 0 ? ' *' : ''}
                </label>
                <InstructorSelect
                  instructors={instructors}
                  value={formData.instructorId}
                  onChange={id => setFormData(f => ({ ...f, instructorId: id }))}
                  themeColor={themeColor}
                  onAddInstructor={() => { closeModal(); setActiveTab('instructors'); }}
                />
              </div>

              {/* Ders Görseli */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-black/50">Ders Görseli</label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-10 rounded-xl bg-white/40 border-2 border-dashed border-black/15 overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {classImagePreview
                      ? <img src={classImagePreview} alt="" className="w-full h-full object-cover" />
                      : <span className="text-lg opacity-25">🖼</span>
                    }
                  </div>
                  <div>
                    <label className="cursor-pointer text-sm font-semibold" style={{ color: themeColor }}>
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handleClassImageSelect} />
                      {classImagePreview ? 'Görseli Değiştir' : 'Görsel Yükle'}
                    </label>
                    <p className="text-xs text-black/30 mt-0.5">PNG, JPG veya WEBP · 5 MB · Önerilen: 16:9</p>
                  </div>
                </div>
              </div>
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
              <div className="flex items-center justify-between border-t border-black/5 pt-4">
                <div>
                  <p className="text-sm font-semibold text-black/70">Haftalık Tekrarla</p>
                  <p className="text-xs text-black/40 mt-0.5">Seçilen günlerde otomatik seans oluştur</p>
                </div>
                <button type="button" onClick={toggleRecurring}
                  className="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-300"
                  style={{ backgroundColor: formData.isRecurring ? themeColor : 'rgba(0,0,0,0.15)' }}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-300 ${formData.isRecurring ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
              {formData.isRecurring && (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-black/50">Hangi Günler?</label>
                    <div className="flex gap-1.5">
                      {WEEK_DAYS.map(day => {
                        const sel = formData.selectedDays.includes(day.value);
                        return (
                          <button key={day.value} type="button" onClick={() => toggleDay(day.value)}
                            style={sel ? { backgroundColor: themeColor } : {}}
                            className={`flex-1 h-9 rounded-full text-xs font-bold transition-all duration-200 ${sel ? 'text-white' : 'bg-black/5 text-black/50 hover:bg-black/10'}`}>
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
              )}
              {formError && <p className="text-sm text-red-500/80 font-medium">{formError}</p>}
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

      {/* DERS DÜZENLE */}
      {editingClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4" onClick={closeEditClass}>
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white/85 backdrop-blur-xl border border-white/60 rounded-3xl shadow-2xl p-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-7">
              <h3 className="text-xl font-bold">Ders Düzenle</h3>
              <button onClick={closeEditClass} className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-black/50 font-bold transition">✕</button>
            </div>
            <form onSubmit={handleUpdateClass} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-black/50">Ders Adı *</label>
                <input type="text" value={classEditForm.title ?? ''}
                  onChange={e => setClassEditForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Reformer Pilates" className={inputClass} />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-black/50">
                  Eğitmen{instructors.length > 0 ? ' *' : ''}
                </label>
                <InstructorSelect
                  instructors={instructors}
                  value={classEditForm.instructorId ?? ''}
                  onChange={id => setClassEditForm(f => ({ ...f, instructorId: id }))}
                  themeColor={themeColor}
                  onAddInstructor={() => { closeEditClass(); setActiveTab('instructors'); }}
                />
                {/* Legacy fallback: show old instructor_name if no instructor_id was set */}
                {!classEditForm.instructorId && editingClass.instructor_name && (
                  <p className="text-xs text-black/40">Mevcut kayıt: {editingClass.instructor_name}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-black/50">Başlangıç Saati *</label>
                  <input type="datetime-local" value={classEditForm.startTime ?? ''}
                    onChange={e => setClassEditForm(f => ({ ...f, startTime: e.target.value }))}
                    className={inputClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-black/50">Bitiş Saati *</label>
                  <input type="datetime-local" value={classEditForm.endTime ?? ''}
                    onChange={e => setClassEditForm(f => ({ ...f, endTime: e.target.value }))}
                    className={inputClass} />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-black/50">Maks. Kapasite</label>
                <input type="number" value={classEditForm.maxCapacity ?? 15} min="1"
                  onChange={e => setClassEditForm(f => ({ ...f, maxCapacity: e.target.value }))}
                  className={inputClass} />
              </div>

              {/* Ders Görseli */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-black/50">Ders Görseli</label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-10 rounded-xl bg-white/40 border-2 border-dashed border-black/15 overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {classEditImagePreview
                      ? <img src={classEditImagePreview} alt="" className="w-full h-full object-cover" />
                      : <span className="text-lg opacity-25">🖼</span>
                    }
                  </div>
                  <div>
                    <label className="cursor-pointer text-sm font-semibold" style={{ color: themeColor }}>
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handleClassEditImageSelect} />
                      {classEditImagePreview ? 'Görseli Değiştir' : 'Görsel Yükle'}
                    </label>
                    <p className="text-xs text-black/30 mt-0.5">PNG, JPG veya WEBP · 5 MB · Önerilen: 16:9</p>
                  </div>
                </div>
              </div>

              {classEditError && <p className="text-sm text-red-500/80 font-medium">{classEditError}</p>}

              <div className="flex gap-3 mt-2">
                <button type="button" onClick={closeEditClass}
                  className="flex-1 py-3 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 font-semibold text-sm transition">
                  İptal
                </button>
                <button type="submit" disabled={classEditSubmitting} style={{ backgroundColor: themeColor }}
                  className="flex-1 py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition">
                  {classEditSubmitting ? 'Kaydediliyor...' : 'Güncelle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* YOKLAMA */}
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
                <p className="text-center text-black/40 py-8">Yükleniyor...</p>
              ) : registrations.length === 0 ? (
                <p className="text-center text-black/40 py-8">Bu derse kayıtlı üye yok.</p>
              ) : (
                <ul className="flex flex-col">
                  {registrations.map((reg, i) => {
                    const name     = reg.profiles?.full_name ?? 'Bilinmiyor';
                    const lessons  = reg.profiles?.remaining_lessons ?? 0;
                    const attended = reg.status === 'attended';
                    const absent   = reg.status === 'absent';
                    return (
                      <li key={reg.id} className={`flex items-center gap-3 py-3.5 ${i < registrations.length - 1 ? 'border-b border-black/5' : ''}`}>
                        <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-sm font-bold"
                          style={{ backgroundColor: attended ? '#10b981' : absent ? '#ef4444' : themeColor, opacity: absent ? 0.6 : 1 }}>
                          {name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm">{name}</p>
                          <p className="text-xs text-black/40">{lessons} ders hakkı</p>
                        </div>
                        {attended ? (
                          <span className="px-3 py-1 bg-emerald-400/20 text-emerald-700 rounded-full text-xs font-bold">Geldi ✓</span>
                        ) : absent ? (
                          <span className="px-3 py-1 bg-red-400/20 text-red-600 rounded-full text-xs font-bold">Gelmedi</span>
                        ) : (
                          <div className="flex gap-2">
                            <button onClick={() => handleAttendanceUpdate(reg.id, reg.profile_id, 'attended')} style={{ backgroundColor: themeColor }} className="px-3 py-1.5 rounded-xl text-white text-xs font-bold hover:opacity-80 transition">Geldi</button>
                            <button onClick={() => handleAttendanceUpdate(reg.id, reg.profile_id, 'absent')} className="px-3 py-1.5 rounded-xl bg-black/5 hover:bg-black/10 text-black/60 text-xs font-bold transition">Gelmedi</button>
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

      {/* ÜYE EKLE */}
      {isAddMemberModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md" onClick={closeAddMemberModal}>
          <div className="w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto bg-white/85 backdrop-blur-xl border border-white/60 rounded-3xl shadow-2xl p-8" onClick={e => e.stopPropagation()}>
            {newMemberCode ? (
              <div className="flex flex-col items-center text-center gap-6 py-4">
                <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl" style={{ backgroundColor: themeColor + '22' }}>🎉</div>
                <div>
                  <h3 className="text-2xl font-bold">Üye Oluşturuldu!</h3>
                  <p className="text-black/50 text-sm font-medium mt-1">Aktivasyon kodunu üyeyle paylaşın.</p>
                </div>
                <div className="w-full rounded-2xl px-6 py-5 flex items-center justify-center border-2" style={{ borderColor: themeColor + '55', backgroundColor: themeColor + '11' }}>
                  <span className="font-mono font-black tracking-[0.25em] text-4xl" style={{ color: themeColor }}>{newMemberCode}</span>
                </div>
                <button
                  onClick={async () => { try { await navigator.clipboard.writeText(newMemberCode); setMemberCodeCopied(true); setTimeout(() => setMemberCodeCopied(false), 2000); } catch {} }}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold border transition-all ${memberCodeCopied ? 'bg-emerald-400/20 text-emerald-700 border-emerald-300/50' : 'bg-white/60 hover:bg-white/80 border-black/10'}`}
                >
                  {memberCodeCopied ? '✓ Kopyalandı!' : 'Kodu Kopyala'}
                </button>
                <button onClick={closeAddMemberModal} style={{ backgroundColor: themeColor }} className="w-full py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition mt-2">Kapat</button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-7">
                  <div>
                    <h3 className="text-xl font-bold">Yeni Üye Ekle</h3>
                    <p className="text-sm text-black/40 mt-0.5">Üye bilgilerini eksiksiz doldurun</p>
                  </div>
                  <button onClick={closeAddMemberModal} className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-black/50 font-bold transition">✕</button>
                </div>
                <form onSubmit={handleAddMember} className="flex flex-col gap-5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-black/50">Ad Soyad</label>
                    <input type="text" name="fullName" value={memberForm.fullName} onChange={handleMemberFormChange} placeholder="Ahmet Yılmaz" className={inputClass} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-semibold text-black/50">E-posta</label>
                      <input type="email" name="email" value={memberForm.email} onChange={handleMemberFormChange} placeholder="ahmet@mail.com" className={inputClass} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-semibold text-black/50">Telefon</label>
                      <input type="tel" name="phone" value={memberForm.phone} onChange={handleMemberFormChange} placeholder="5551234567" className={inputClass} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-black/50">Üyelik Paketi</label>
                    <select value={memberForm.membershipTypeId} onChange={e => handleMemberTypeChange(e.target.value)} className={inputClass}>
                      <option value="">Paket seçin...</option>
                      {membershipTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-semibold text-black/50">Üyelik Başlangıç</label>
                      <input type="date" name="membershipStartDate" value={memberForm.membershipStartDate} onChange={handleMemberFormChange} className={inputClass} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-semibold text-black/50">Üyelik Bitiş</label>
                      <input type="date" name="membershipEndDate" value={memberForm.membershipEndDate} onChange={handleMemberFormChange} className={inputClass} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between border border-black/5 bg-black/[0.02] rounded-2xl px-5 py-4">
                    <div>
                      <p className="text-sm font-semibold text-black/70">Sınırsız Paket</p>
                      <p className="text-xs text-black/40 mt-0.5">{memberForm.isUnlimited ? 'Sınırsız ∞' : 'Belirli ders hakkı'}</p>
                    </div>
                    <button type="button" onClick={() => setMemberForm(p => ({ ...p, isUnlimited: !p.isUnlimited }))}
                      className="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-300"
                      style={{ backgroundColor: memberForm.isUnlimited ? themeColor : 'rgba(0,0,0,0.15)' }}>
                      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-300 ${memberForm.isUnlimited ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>
                  {!memberForm.isUnlimited && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-semibold text-black/50">Kalan Ders Hakkı</label>
                      <input type="number" name="packageLessons" value={memberForm.packageLessons} onChange={handleMemberFormChange} min="0" className={inputClass} />
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-semibold text-black/50">Üye Seviyesi</label>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${levelInfo(memberForm.memberLevel).bg} ${levelInfo(memberForm.memberLevel).text}`}>
                        {levelInfo(memberForm.memberLevel).label} — {memberForm.memberLevel}/10
                      </span>
                    </div>
                    <input type="range" min="1" max="10" step="1" value={memberForm.memberLevel}
                      onChange={e => setMemberForm(p => ({ ...p, memberLevel: Number(e.target.value) }))}
                      className="w-full h-2 rounded-full outline-none cursor-pointer" style={{ accentColor: themeColor }} />
                  </div>
                  {memberFormError && <p className="text-sm text-red-500/80 font-medium">{memberFormError}</p>}
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

      {/* ÜYE DÜZENLE */}
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
                <input type="text" name="fullName" value={editForm.fullName} onChange={handleEditFormChange} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-black/50">E-posta</label>
                  <input type="email" name="email" value={editForm.email} onChange={handleEditFormChange} className={inputClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-black/50">Telefon</label>
                  <input type="tel" name="phone" value={editForm.phone} onChange={handleEditFormChange} className={inputClass} />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-black/50">Üyelik Paketi</label>
                <select value={editForm.membershipTypeId} onChange={e => handleEditTypeChange(e.target.value)} className={inputClass}>
                  <option value="">Paket seçin...</option>
                  {membershipTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-black/50">Üyelik Başlangıç</label>
                  <input type="date" name="membershipStartDate" value={editForm.membershipStartDate} onChange={handleEditFormChange} className={inputClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-black/50">Üyelik Bitiş</label>
                  <input type="date" name="membershipEndDate" value={editForm.membershipEndDate} onChange={handleEditFormChange} className={inputClass} />
                </div>
              </div>
              <div className="flex items-center justify-between border border-black/5 bg-black/[0.02] rounded-2xl px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-black/70">Sınırsız Paket</p>
                  <p className="text-xs text-black/40 mt-0.5">{editForm.isUnlimited ? 'Sınırsız ∞' : 'Belirli ders hakkı'}</p>
                </div>
                <button type="button" onClick={() => setEditForm(p => ({ ...p, isUnlimited: !p.isUnlimited }))}
                  className="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-300"
                  style={{ backgroundColor: editForm.isUnlimited ? themeColor : 'rgba(0,0,0,0.15)' }}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-300 ${editForm.isUnlimited ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
              {!editForm.isUnlimited && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-black/50">Kalan Ders Hakkı</label>
                  <input type="number" name="remainingLessons" value={editForm.remainingLessons} onChange={handleEditFormChange} min="0" className={inputClass} />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-black/50">Üye Seviyesi</label>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${levelInfo(editForm.memberLevel ?? 1).bg} ${levelInfo(editForm.memberLevel ?? 1).text}`}>
                    {levelInfo(editForm.memberLevel ?? 1).label} — {editForm.memberLevel ?? 1}/10
                  </span>
                </div>
                <input type="range" min="1" max="10" step="1" value={editForm.memberLevel ?? 1}
                  onChange={e => setEditForm(p => ({ ...p, memberLevel: Number(e.target.value) }))}
                  className="w-full h-2 rounded-full outline-none cursor-pointer" style={{ accentColor: themeColor }} />
              </div>
              <div className="flex items-center justify-between border border-black/5 bg-black/[0.02] rounded-2xl px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-black/70">Üye Durumu</p>
                  <p className="text-xs text-black/40 mt-0.5">{editForm.isActivated ? 'Aktif — Uygulamaya giriş yapabilir' : 'Pasif'}</p>
                </div>
                <button type="button" onClick={() => setEditForm(p => ({ ...p, isActivated: !p.isActivated }))}
                  className="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-300"
                  style={{ backgroundColor: editForm.isActivated ? themeColor : 'rgba(0,0,0,0.15)' }}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-300 ${editForm.isActivated ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
              {editFormError && <p className="text-sm text-red-500/80 font-medium">{editFormError}</p>}
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={closeEditModal} className="flex-1 py-3 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 font-semibold text-sm transition">İptal</button>
                <button type="submit" disabled={isEditSubmitting} style={{ backgroundColor: themeColor }} className="flex-1 py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition">
                  {isEditSubmitting ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ÜYE DETAY DRAWER */}
      {memberDetail && (
        <MemberDetailDrawer
          member={memberDetail}
          membershipTypes={membershipTypes}
          studioId={studioId}
          themeColor={themeColor}
          onClose={() => setMemberDetail(null)}
          onEdit={(m) => { setMemberDetail(null); openEditModal(m); }}
          showToast={showToast}
        />
      )}

      {showBulkImport && (
        <BulkImportModal
          studioId={studioId}
          membershipTypes={membershipTypes}
          themeColor={themeColor}
          onClose={() => setShowBulkImport(false)}
          onImportComplete={() => { fetchMembers(); fetchTotalMembers(); fetchExpiringMembers(); }}
        />
      )}

      {/* TOAST */}
      {checkInToast && (
        <div
          className="fixed top-6 right-6 z-[100] flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl text-white text-sm font-semibold backdrop-blur-xl max-w-sm"
          style={{ backgroundColor: checkInToast.success ? '#10b981' : '#ef4444' }}
        >
          <span className="text-xl flex-shrink-0">{checkInToast.success ? '✅' : '❌'}</span>
          <span className="leading-snug">{checkInToast.message}</span>
        </div>
      )}
    </div>
  );
}
