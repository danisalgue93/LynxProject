type OtpEntry = {
  hash: string;
  expiresAt: number;
  attempts: number;
};

// NOTE: In-memory storage - will not work correctly with multiple instances.
// In-memory OTP store — REQUIRES this admin panel to run as a single
// process/instance (as documented in the project README: local dev or one
// instance behind a VPN/localhost tunnel, never scaled to multiple replicas).
// A restart between request-otp and verify-otp also invalidates any pending
// OTP; this is acceptable for a single-instance, low-traffic emergency tool,
// but if that ever changes, back this with a shared store (Redis/Postgres).
const store = new Map<string, OtpEntry>();

// Purge expired OTPs periodically to prevent unbounded memory growth.
// The admin panel has very low traffic; a simple interval is sufficient.
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt < now) store.delete(key);
    }
  }, 60_000);
}

export function setOtp(key: string, entry: OtpEntry) {
  store.set(key, entry);
}

export function getOtp(key: string) {
  return store.get(key);
}

export function deleteOtp(key: string) {
  store.delete(key);
}
