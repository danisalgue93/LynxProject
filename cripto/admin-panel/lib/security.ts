import crypto from 'crypto';
import { NextRequest } from 'next/server';

export function clientKey(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}

export function hashSecret(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function timingSafeEqualText(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function assertEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function isDevMode() {
  return process.env.ADMIN_DEV_MODE === 'true';
}

export async function sendTelegram(text: string) {
  if (isDevMode()) {
    console.log(`[DEV TELEGRAM] ${text}`);
    return;
  }

  const token = assertEnv('TELEGRAM_BOT_TOKEN');
  const chatId = assertEnv('TELEGRAM_CHAT_ID');

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    throw new Error('Telegram notification failed');
  }
}
