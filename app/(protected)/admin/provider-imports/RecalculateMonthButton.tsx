"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { recalculateOnlyAction } from "./recalculate-actions";

type ActionState = {
  success: boolean;
  message: string;
} | null;

const initialState: ActionState = null;

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Recalculating..." : "Recalculate only"}
    </button>
  );
}

export default function RecalculateMonthButton({
  monthKey,
  disabled = false,
  disabledReason,
}: {
  monthKey: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [state, formAction] = useActionState(
    recalculateOnlyAction,
    initialState
  );

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction}>
        <input type="hidden" name="monthKey" value={monthKey} />
        <SubmitButton disabled={disabled} />
      </form>

      {disabled && disabledReason ? (
        <p className="text-xs text-amber-700">{disabledReason}</p>
      ) : null}

      {state?.message ? (
        <p
          className={`text-xs ${
            state.success ? "text-green-600" : "text-red-600"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}