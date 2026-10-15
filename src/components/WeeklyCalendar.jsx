import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const glassStyle = "bg-white/25 backdrop-blur-xl border border-white/40 shadow-sm rounded-3xl";

function getWeekRange(offset) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function getWeekDays(offset) {
  const { start } = getWeekRange(offset);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function formatHHMM(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function formatWeekLabel(offset) {
  const { start, end } = getWeekRange(offset);
  const opts = { day: 'numeric', month: 'long', year: 'numeric' };
  const s = start.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  const e = end.toLocaleDateString('tr-TR', opts);
  return `${s} – ${e}`;
}

const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

export default function WeeklyCalendar({ studioId, themeColor, onAddClass, onAttendance }) {
  const [offset, setOffset] = useState(0);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!studioId) return;
    fetchWeekClasses();
  }, [studioId, offset]);

  async function fetchWeekClasses() {
    setLoading(true);
    const { start, end } = getWeekRange(offset);
    const { data } = await supabase
      .from('classes')
      .select('id, title, instructor_name, start_time, end_time, max_capacity, current_capacity')
      .eq('studio_id', studioId)
      .gte('start_time', start.toISOString())
      .lte('start_time', end.toISOString())
      .order('start_time', { ascending: true });
    setClasses(data ?? []);
    setLoading(false);
  }

  const days = getWeekDays(offset);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function classesForDay(date) {
    const dateStr = date.toISOString().split('T')[0];
    return classes.filter(c => c.start_time.startsWith(dateStr));
  }

  function isToday(date) {
    return date.toDateString() === today.toDateString();
  }

  function isPast(cls) {
    return new Date(cls.start_time) < new Date();
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between mt-2">
        <div>
          <h1 className="text-3xl font-bold">Ders Programı</h1>
          <p className="text-black/60 mt-1 font-medium">{formatWeekLabel(offset)}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-white/40 border border-white/50 rounded-xl p-1">
            <button
              onClick={() => setOffset(o => o - 1)}
              className="px-3 py-2 rounded-lg text-sm font-semibold hover:bg-white/60 transition"
            >‹ Önceki</button>
            <button
              onClick={() => setOffset(0)}
              className="px-3 py-2 rounded-lg text-sm font-medium text-black/50 hover:bg-white/60 transition"
            >Bugün</button>
            <button
              onClick={() => setOffset(o => o + 1)}
              className="px-3 py-2 rounded-lg text-sm font-semibold hover:bg-white/60 transition"
            >Sonraki ›</button>
          </div>
          <button
            onClick={onAddClass}
            style={{ backgroundColor: themeColor }}
            className="flex items-center gap-2 text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity shadow-sm"
          >
            <span className="text-lg leading-none">+</span> Yeni Ders
          </button>
        </div>
      </header>

      <div className={`${glassStyle} p-5 overflow-x-auto`}>
        {loading ? (
          <div className="py-16 text-center text-black/40 font-medium">Yükleniyor...</div>
        ) : (
          <div className="grid grid-cols-7 gap-3 min-w-[700px]">
            {days.map((day, idx) => {
              const dayClasses = classesForDay(day);
              const today_ = isToday(day);
              return (
                <div key={idx} className="flex flex-col gap-2 min-h-[200px]">
                  <div
                    className="text-center py-2 rounded-xl"
                    style={today_ ? { backgroundColor: themeColor + '22' } : {}}
                  >
                    <p className="text-xs font-semibold text-black/50 uppercase">{DAY_LABELS[idx]}</p>
                    <p
                      className="text-lg font-bold mt-0.5"
                      style={today_ ? { color: themeColor } : {}}
                    >
                      {day.getDate()}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {dayClasses.length === 0 ? (
                      <p className="text-center text-black/20 text-xs pt-4">—</p>
                    ) : (
                      dayClasses.map(cls => {
                        const full = cls.current_capacity >= cls.max_capacity;
                        const past = isPast(cls);
                        return (
                          <div
                            key={cls.id}
                            className="bg-white/60 border border-white/70 rounded-2xl p-3 flex flex-col gap-1.5"
                            style={{ opacity: past ? 0.55 : 1 }}
                          >
                            <p className="text-[11px] font-bold text-black/50">
                              {formatHHMM(cls.start_time)}
                              {cls.end_time && ` – ${formatHHMM(cls.end_time)}`}
                            </p>
                            <p className="text-xs font-bold leading-tight">{cls.title}</p>
                            <p className="text-[11px] text-black/50 leading-tight">{cls.instructor_name}</p>
                            <div className="flex items-center justify-between mt-0.5">
                              <span
                                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                style={full
                                  ? { backgroundColor: '#fef3c7', color: '#92400e' }
                                  : { backgroundColor: themeColor + '22', color: themeColor }
                                }
                              >
                                {cls.current_capacity}/{cls.max_capacity}
                              </span>
                            </div>
                            <div className="flex gap-1 mt-0.5">
                              <button
                                onClick={() => onAttendance(cls)}
                                style={{ backgroundColor: themeColor }}
                                className="flex-1 text-white text-[10px] font-bold py-1 rounded-lg hover:opacity-80 transition"
                              >
                                Yoklama
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
