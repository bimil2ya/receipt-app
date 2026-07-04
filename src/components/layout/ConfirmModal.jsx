import Modal from './Modal';

export default function ConfirmModal({
  show,
  title = '확인',
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  variant = 'danger',
  onConfirm,
  onCancel,
}) {
  if (!show) return null;

  const confirmClass = variant === 'danger'
    ? 'flex-1 bg-red-600 py-5 rounded-2xl font-black text-lg'
    : 'flex-1 bg-blue-600 py-5 rounded-2xl font-black text-lg';

  return (
    <Modal title={title} onClose={onCancel}>
      {message && (
        <p className="px-2 pb-4 text-[1rem] leading-7 text-slate-200 whitespace-pre-line">
          {message}
        </p>
      )}
      <div className="p-2 flex gap-4">
        <button onClick={onCancel} className="flex-1 bg-slate-700 py-5 rounded-2xl font-black text-lg">
          {cancelLabel}
        </button>
        <button onClick={onConfirm} className={confirmClass}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
