"use client";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  description,
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold">{title}</h2>

        <p className="mt-2 text-sm text-slate-600">{description}</p>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-2xl border px-4 py-2 text-sm"
          >
            Cancel
          </button>

          <button
            onClick={onConfirm}
            className={`rounded-2xl px-4 py-2 text-sm text-white ${
              danger ? "bg-red-600" : "bg-slate-900"
            }`}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}