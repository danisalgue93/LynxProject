type OtpEntry = {
  hash: string;
  expiresAt: number;
  attempts: number;
};

const store = new Map<string, OtpEntry>();

export function setOtp(key: string, entry: OtpEntry) {
  store.set(key, entry);
}

export function getOtp(key: string) {
  return store.get(key);
}

export function deleteOtp(key: string) {
  store.delete(key);
}
