import { Camera, ImageUp, Keyboard } from 'lucide-react';

export default function ReceiptInputActions({ onCamera, onUpload, onManual }) {
  return (
    <div className="pt-1">
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={onCamera}
          className="bg-yellow-400/10 hover:bg-yellow-400/15 py-2 rounded-2xl text-[13px] font-black text-yellow-300 transition-all flex items-center justify-center gap-1.5 active:scale-95 min-h-0 whitespace-nowrap border border-yellow-400/50 shadow-[0_0_0_1px_rgba(250,204,21,0.14)]"
        >
          <Camera size={15} />촬영
        </button>
        <button
          onClick={onUpload}
          className="bg-slate-700 hover:bg-slate-600 py-2 rounded-2xl text-[13px] font-black transition-all flex items-center justify-center gap-1.5 active:scale-95 min-h-0 whitespace-nowrap"
        >
          <ImageUp size={15} />업로드
        </button>
        <button
          onClick={onManual}
          className="bg-slate-700 hover:bg-slate-600 py-2 rounded-2xl text-[13px] font-black transition-all flex items-center justify-center gap-1.5 active:scale-95 min-h-0 whitespace-nowrap"
        >
          <Keyboard size={15} />직접입력
        </button>
      </div>
    </div>
  );
}
