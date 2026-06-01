export function normalizePhone(value: string | null | undefined) {
  if (!value) return "";

  const digits = value.replace(/\D/g, "");

  if (digits.startsWith("61")) {
    return `+${digits}`;
  }

  if (digits.startsWith("0")) {
    return `+61${digits.slice(1)}`;
  }

  if (digits.startsWith("+")) {
    return digits;
  }

  return digits ? `+${digits}` : "";
}

export function displayPhone(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/^\+61/, "0");
}

export function isStopMessage(body: string) {
  return ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(
    body.trim().toUpperCase()
  );
}

export function isStartMessage(body: string) {
  return ["START", "UNSTOP"].includes(body.trim().toUpperCase());
}

export function isYesConfirmation(body: string) {
  return ["Y", "YES", "CONFIRM", "CONFIRMED"].includes(
    body.trim().toUpperCase()
  );
}