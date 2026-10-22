import React, { useState, useEffect, useRef } from 'react';

function InstrAvatar({ instr, themeColor, size = 28 }) {
  if (instr.profile_image_url) {
    return (
      <img src={instr.profile_image_url} alt=""
        style={{ width: size, height: size }}
        className="rounded-full object-cover flex-shrink-0" />
    );
  }
  const initials = instr.full_name
    .split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div
      style={{ width: size, height: size, backgroundColor: themeColor + '28', color: themeColor }}
      className="rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 select-none">
      {initials}
    </div>
  );
}

export default function InstructorSelect({ instructors = [], value, onChange, themeColor, onAddInstructor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const selected = instructors.find(i => i.id === value) ?? null;

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full bg-white/50 border border-black/10 rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-3 hover:bg-white/70 transition text-left outline-none focus:border-black/30"
      >
        {selected ? (
          <>
            <InstrAvatar instr={selected} themeColor={themeColor} />
            <span className="flex-1 font-semibold text-black/80">{selected.full_name}</span>
          </>
        ) : (
          <span className="flex-1 text-black/30">Eğitmen seçin</span>
        )}
        {/* Chevron */}
        <svg
          width="16" height="16" viewBox="0 0 16 16" fill="none"
          className={`flex-shrink-0 text-black/30 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-white/96 backdrop-blur-xl border border-white/60 rounded-2xl shadow-2xl overflow-hidden">
          {instructors.length === 0 ? (
            /* Empty state */
            <div className="px-4 py-6 flex flex-col items-center gap-3 text-center">
              <p className="text-sm font-medium text-black/40">Henüz eğitmen eklenmemiş.</p>
              <button
                type="button"
                onClick={() => { setOpen(false); onAddInstructor?.(); }}
                style={{ color: themeColor }}
                className="text-sm font-semibold hover:opacity-70 transition"
              >
                + Eğitmen Ekle
              </button>
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto py-1">
              {instructors.map(instr => {
                const isSelected = instr.id === value;
                return (
                  <button
                    key={instr.id}
                    type="button"
                    onClick={() => { onChange(instr.id); setOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-black/5 transition text-left"
                    style={isSelected ? { backgroundColor: themeColor + '14' } : {}}
                  >
                    <InstrAvatar instr={instr} themeColor={themeColor} />
                    <span className={`text-sm flex-1 ${isSelected ? 'font-bold' : 'font-semibold'}`}>
                      {instr.full_name}
                    </span>
                    {isSelected && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
                        <path d="M2 7l3.5 3.5L12 3" stroke={themeColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
