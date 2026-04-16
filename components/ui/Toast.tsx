"use client";

import { useEffect, useState } from "react";

type ToastProps = {
  message: string;
  tone?: "default" | "success" | "error";
};

export default function Toast({ message, tone = "default" }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    const timeout = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timeout);
  }, [message]);

  if (!visible) return null;

  const toneStyles = {
    default: "bg-slate-900 text-white",
    success: "bg-emerald-600 text-white",
    error: "bg-red-600 text-white",
  };

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 rounded-2xl px-4 py-3 shadow-lg ${toneStyles[tone]}`}
    >
      <div className="text-sm font-medium">{message}</div>
    </div>
  );
}