import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey() {
  const secret = process.env.PRAKTIKA_TEMP_CREDENTIAL_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "Missing PRAKTIKA_TEMP_CREDENTIAL_SECRET. Add a long random secret to .env.local.",
    );
  }

  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptTemporaryCredential(value: string) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getKey();

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptTemporaryCredential(value: string | null | undefined) {
  if (!value) return "";

  if (!value.startsWith("v1:")) {
    return value;
  }

  const [, ivBase64, authTagBase64, encryptedBase64] = value.split(":");

  if (!ivBase64 || !authTagBase64 || !encryptedBase64) {
    throw new Error("Invalid encrypted temporary credential format.");
  }

  const key = getKey();
  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");
  const encrypted = Buffer.from(encryptedBase64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
}