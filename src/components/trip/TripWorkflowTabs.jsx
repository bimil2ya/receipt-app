export default function TripWorkflowTabs({ activePanel, onBudget, onInput, onManagement }) {
  const buttonClass = (active) => `rounded-2xl px-2 py-2 text-[13px] font-black transition-all active:scale-95 min-h-11 flex items-center justify-center gap-1.5 whitespace-nowrap ${
    active
      ? 'bg-blue-600 text-white shadow-md ring-2 ring-cyan-300/50'
      : 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700'
  }`;

  const stepClass = (active) => `inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black transition-all ${
    active
      ? 'bg-cyan-300 text-slate-950 shadow-[0_0_0_4px_rgba(34,211,238,0.14),0_0_16px_rgba(34,211,238,0.35)] scale-110'
      : 'bg-slate-700 text-slate-100'
  }`;

  return (
    <div className="grid grid-cols-3 gap-2">
      <button
        onClick={onBudget}
        className="rounded-2xl px-2 py-2 text-[13px] font-black transition-all active:scale-95 min-h-11 bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 flex items-center justify-center gap-1.5 whitespace-nowrap"
      >
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-[10px] font-black text-slate-100">1</span>
        <span>예산</span>
      </button>
      <button aria-pressed={activePanel === 'input'} onClick={onInput} className={buttonClass(activePanel === 'input')}>
        <span className={stepClass(activePanel === 'input')}>2</span>
        <span>입력</span>
      </button>
      <button aria-pressed={activePanel === 'management'} onClick={onManagement} className={buttonClass(activePanel === 'management')}>
        <span className={stepClass(activePanel === 'management')}>3</span>
        <span>마감</span>
      </button>
    </div>
  );
}
