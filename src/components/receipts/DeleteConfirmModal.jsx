import Modal from '../layout/Modal';

export default function DeleteConfirmModal({ show, onCancel, onConfirm }) {
  if (!show) return null;

  return (
    <Modal title="삭제?" onClose={onCancel}>
      <div className="p-2 flex gap-4">
        <button onClick={onCancel} className="flex-1 bg-slate-700 py-5 rounded-2xl font-black text-lg">취소</button>
        <button onClick={onConfirm} className="flex-1 bg-red-600 py-5 rounded-2xl font-black text-lg">삭제</button>
      </div>
    </Modal>
  );
}
