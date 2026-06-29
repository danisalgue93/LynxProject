type OtpEntry = {
  hash: string;
  expiresAt: number;
  attempts: number;
};

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
