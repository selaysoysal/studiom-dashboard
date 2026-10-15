import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const inputClass = "w-full bg-white/50 border border-black/10 rounded-xl px-4 py-3 text-sm font-medium placeholder:text-black/30 outline-none focus:border-black/30 focus:bg-white/70 transition";

function getMemberStatus(member) {
  if (!member.is_activated) return 'inactive';
  if (!member.membership_end_date) return 'active';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(member.membership_end_date);
  const diff = Math.ceil((end - today) / 86400000);
  if (diff < 0) return 'expired';
  if (diff <= 7) return 'expiring';
  return 'active';
}

function StatusBadge({ status }) {
  const map = {
    active:   { label: 'Aktif',            cls: 'bg-emerald-400/20 text-emerald-700' },
    expiring: { label: 'Yakında Bitiyor',  cls: 'bg-amber-400/20 text-amber-700'    },
    expired:  { label: 'Süresi Doldu',     cls: 'bg-red-400/20 text-red-600'        },
    inactive: { label: 'Pasif',            cls: 'bg-black/10 text-black/40'         },
  };
  const { label, cls } = map[status] ?? map.active;
  return <span className={`px-3 py-1 rounded-full text-xs font-bold ${cls}`}>{label}</span>;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function SectionTitle({ children }) {
  return <p className="text-xs font-bold text-black/40 uppercase tracking-wider mb-2">{children}</p>;
}

export default function MemberDetailDrawer({
  member, membershipTypes, studioId, themeColor, onClose, onEdit, showToast,
}) {
  const [payments, setPayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: '', currency: 'TRY', payment_method: 'Nakit',
    payment_date: new Date().toISOString().split('T')[0], notes: '',
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchPayments();
  }, [member.id]);

  async function fetchPayments() {
    setPaymentsLoading(true);
    const { data } = await supabase
      .from('membership_payments')
      .select('id, payment_date, amount, currency, payment_method, notes')
      .eq('profile_id', member.id)
      .order('payment_date', { ascending: false });
    setPayments(data ?? []);
    setPaymentsLoading(false);
  }

  async function handleAddPayment(e) {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.from('membership_payments').insert({
      studio_id: studioId,
      profile_id: member.id,
      membership_type_id: member.membership_type_id || null,
      amount: paymentForm.amount ? Number(paymentForm.amount) : null,
      currency: paymentForm.currency,
      payment_method: paymentForm.payment_method,
      payment_date: paymentForm.payment_date,
      notes: paymentForm.notes || null,
    });
    if (!error) {
      await supabase.from('profiles').update({ last_payment_date: paymentForm.payment_date }).eq('id', member.id);
      fetchPayments();
      setShowPaymentForm(false);
      setPaymentForm({ amount: '', currency: 'TRY', payment_method: 'Nakit', payment_date: new Date().toISOString().split('T')[0], notes: '' });
      showToast(true, 'Ödeme kaydedildi.');
    } else {
      showToast(false, 'Ödeme kaydedilemedi.');
    }
    setSubmitting(false);
  }

  const memberType = membershipTypes.find(t => t.id === member.membership_type_id);
  const status = getMemberStatus(member);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[480px] bg-white/90 backdrop-blur-xl border-l border-white/50 shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-black/5 flex-shrink-0">
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
              style={{ backgroundColor: themeColor }}
            >
              {member.full_name?.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-bold">{member.full_name}</h2>
              <StatusBadge status={status} />
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-black/50 font-bold transition">✕</button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">

          {/* Personal Info */}
          <div>
            <SectionTitle>Kişisel Bilgiler</SectionTitle>
            <div className="bg-white/50 border border-black/5 rounded-2xl p-4 flex flex-col gap-3">
              {[
                { label: 'E-posta', value: member.email },
                { label: 'Telefon', value: member.phone },
                { label: 'Üye Kodu', value: member.member_code },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center">
                  <span className="text-sm text-black/40 font-medium">{label}</span>
                  <span className="text-sm font-semibold text-right">{value || '—'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Membership */}
          <div>
            <SectionTitle>Üyelik</SectionTitle>
            <div className="bg-white/50 border border-black/5 rounded-2xl p-4 flex flex-col gap-3">
              {[
                { label: 'Paket', value: memberType?.name || '—' },
                { label: 'Başlangıç', value: formatDate(member.membership_start_date) },
                { label: 'Bitiş', value: formatDate(member.membership_end_date) },
                {
                  label: 'Kalan Ders',
                  value: member.is_unlimited
                    ? <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-violet-400/20 text-violet-700">∞ Sınırsız</span>
                    : `${member.remaining_lessons ?? 0} ders`,
                },
                { label: 'Son Giriş', value: formatDate(member.last_check_in) },
                { label: 'Son Ödeme', value: formatDate(member.last_payment_date) },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center">
                  <span className="text-sm text-black/40 font-medium">{label}</span>
                  <span className="text-sm font-semibold">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Payments */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <SectionTitle>Ödemeler</SectionTitle>
              <button
                onClick={() => setShowPaymentForm(v => !v)}
                style={{ color: themeColor }}
                className="text-xs font-bold hover:opacity-70 transition"
              >
                {showPaymentForm ? 'İptal' : '+ Ödeme Ekle'}
              </button>
            </div>

            {showPaymentForm && (
              <form onSubmit={handleAddPayment} className="bg-white/60 border border-black/5 rounded-2xl p-4 mb-3 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-black/40">Tutar</label>
                    <input
                      type="number" min="0" step="0.01"
                      value={paymentForm.amount}
                      onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))}
                      placeholder="0.00"
                      className={inputClass}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-black/40">Para Birimi</label>
                    <select value={paymentForm.currency} onChange={e => setPaymentForm(f => ({ ...f, currency: e.target.value }))} className={inputClass}>
                      <option>TRY</option><option>USD</option><option>EUR</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-black/40">Yöntem</label>
                    <select value={paymentForm.payment_method} onChange={e => setPaymentForm(f => ({ ...f, payment_method: e.target.value }))} className={inputClass}>
                      <option>Nakit</option><option>Kart</option><option>Havale</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-black/40">Tarih</label>
                    <input type="date" value={paymentForm.payment_date} onChange={e => setPaymentForm(f => ({ ...f, payment_date: e.target.value }))} className={inputClass} />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-black/40">Not (opsiyonel)</label>
                  <input type="text" value={paymentForm.notes} onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notlar..." className={inputClass} />
                </div>
                <button type="submit" disabled={submitting} style={{ backgroundColor: themeColor }} className="py-2.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition">
                  {submitting ? 'Kaydediliyor...' : 'Ödemeyi Kaydet'}
                </button>
              </form>
            )}

            {paymentsLoading ? (
              <p className="text-sm text-black/40 text-center py-4">Yükleniyor...</p>
            ) : payments.length === 0 ? (
              <p className="text-sm text-black/30 text-center py-4">Henüz ödeme kaydı yok.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {payments.map(p => (
                  <div key={p.id} className="bg-white/50 border border-black/5 rounded-2xl px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{formatDate(p.payment_date)}</p>
                      <p className="text-xs text-black/40">{p.payment_method}{p.notes ? ` · ${p.notes}` : ''}</p>
                    </div>
                    {p.amount != null && (
                      <span className="font-bold text-sm" style={{ color: themeColor }}>
                        {Number(p.amount).toLocaleString('tr-TR')} {p.currency}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="p-6 border-t border-black/5 flex-shrink-0">
          <button
            onClick={() => { onClose(); onEdit(member); }}
            style={{ backgroundColor: themeColor }}
            className="w-full py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition"
          >
            Üyeyi Düzenle
          </button>
        </div>
      </div>
    </>
  );
}
