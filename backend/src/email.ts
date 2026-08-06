/**
 * Email service powered by Resend (https://resend.com).
 *
 * Usage:
 *   import { sendVerificationEmail, sendPasswordResetEmail } from './email.js';
 *
 * Required env vars:
 *   RESEND_API_KEY   — Resend API key (re_...)
 *   EMAIL_FROM       — Sender address (e.g. noreply@lynxmarket.io)
 *   APP_URL          — Production URL for building links (e.g. https://lynxmarket.io)
 */

import { Resend } from 'resend';

/** Escape HTML special characters to prevent injection in email templates */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

let resend: Resend | undefined;

/**
 * Lazily instantiate the Resend client on first use, so that importing this
 * module (e.g. at server startup) never throws when RESEND_API_KEY is unset.
 * Callers are expected to guard with isEmailConfigured() before sending.
 */
function getResendClient(): Resend {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

const FROM = process.env.EMAIL_FROM || 'Lynx Market <noreply@lynxmarket.io>';
const APP_URL = (process.env.APP_URL || 'https://lynxmarket.io').replace(/\/$/, '');

// ── HTML template helpers ──────────────────────────────────────────────────────

function baseTemplate(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
  body{margin:0;padding:0;background:#0A0A0B;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#E4E4E7;}
  .wrap{max-width:520px;margin:40px auto;padding:0 16px;}
  .card{background:#0D0D0E;border:1px solid #27272A;border-radius:16px;padding:40px;}
  .logo{font-size:22px;font-weight:900;letter-spacing:0.15em;color:#00FFD1;margin-bottom:32px;}
  h1{font-size:20px;font-weight:700;color:#fff;margin:0 0 12px;}
  p{font-size:14px;color:#A1A1AA;line-height:1.6;margin:0 0 16px;}
  .btn{display:inline-block;background:#00FFD1;color:#000;font-weight:700;font-size:13px;
       letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;
       padding:12px 28px;border-radius:6px;margin:8px 0 24px;}
  .token{background:#18181B;border:1px solid #27272A;border-radius:6px;padding:12px 16px;
         font-family:monospace;font-size:14px;color:#00FFD1;letter-spacing:0.05em;
         word-break:break-all;margin:8px 0 24px;}
  .footer{font-size:11px;color:#52525B;text-align:center;margin-top:32px;line-height:1.5;}
  .warning{font-size:12px;color:#71717A;border-top:1px solid #27272A;margin-top:24px;padding-top:16px;}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="logo">LYNX MARKET</div>
    ${bodyHtml}
    <div class="warning">
      If you did not request this, please ignore this email. Your account remains secure.
    </div>
  </div>
  <div class="footer">
    &copy; ${new Date().getFullYear()} Lynx Market · DEX Protocol DAO<br/>
    This is an automated message — please do not reply.
  </div>
</div>
</body>
</html>`;
}

// ── Email sending with retry ───────────────────────────────────────────────────

async function sendWithRetry(
  to: string,
  subject: string,
  html: string,
  attempts = 3
): Promise<void> {
  // Dev fallback: with no RESEND_API_KEY there is no way to actually deliver
  // mail. Rather than fail silently — the callers swallow the rejection, so the
  // UI still says "check your email" and nothing ever arrives — log the action
  // link to the server console so local development can complete verification /
  // password-reset flows without any email infrastructure. Production requires
  // RESEND_API_KEY at startup (docker-compose `:?`), so this branch is dev-only.
  if (!process.env.RESEND_API_KEY) {
    const link = (html.match(/href="([^"]+)"/)?.[1] ?? '').replace(/&amp;/g, '&');
    console.warn(JSON.stringify({
      level: 'warn',
      module: 'email',
      msg: 'RESEND_API_KEY not set — email NOT sent. Open this link manually (local dev only):',
      to,
      subject,
      link: link || '(no link found in this email)',
    }));
    return;
  }

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await getResendClient().emails.send({ from: FROM, to, subject, html });
      if (result.error) {
        throw new Error(`Resend error: ${result.error.message}`);
      }
      return;
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1))); // 1s, 2s
      }
    }
  }
  // Rethrow after exhausting retries. Email delivery must never block an auth
  // operation, so CALLERS invoke these helpers fire-and-forget with .catch()
  // (see the register / request-password-reset routes) — the rejection is
  // logged there, not turned into a failed HTTP response.
  throw lastError;
}

// ── Verification email ─────────────────────────────────────────────────────────

export async function sendVerificationEmail(params: {
  to: string;
  token: string;
  displayName?: string;
}): Promise<void> {
  const { to, token, displayName = 'there' } = params;

  // Escape all user-controlled values before inserting into HTML
  const safeDisplayName = escapeHtml(displayName);
  const safeToken = escapeHtml(token);
  const verifyUrl = `${APP_URL}/?verify=${encodeURIComponent(token)}`;
  const safeVerifyUrl = escapeHtml(verifyUrl);

  const html = baseTemplate('Verify your Lynx Market email', `
    <h1>Confirm your email address</h1>
    <p>Hi ${safeDisplayName},</p>
    <p>Thanks for signing up to Lynx Market. Click the button below to verify your email and activate your account.</p>
    <a href="${safeVerifyUrl}" class="btn">Verify Email</a>
    <p>Or enter this code manually in the app:</p>
    <div class="token">${safeToken}</div>
    <p>This link expires in <strong>24 hours</strong>.</p>
  `);

  await sendWithRetry(to, 'Verify your Lynx Market email', html);
}

// ── Password reset email ───────────────────────────────────────────────────────

export async function sendPasswordResetEmail(params: {
  to: string;
  token: string;
}): Promise<void> {
  const { to, token } = params;
  const safeToken = escapeHtml(token);
  const resetUrl = `${APP_URL}/?reset=${encodeURIComponent(token)}`;
  const safeResetUrl = escapeHtml(resetUrl);

  const html = baseTemplate('Reset your Lynx Market password', `
    <h1>Reset your password</h1>
    <p>We received a request to reset the password for your Lynx Market account.</p>
    <a href="${safeResetUrl}" class="btn">Reset Password</a>
    <p>Or enter this code manually in the app:</p>
    <div class="token">${safeToken}</div>
    <p>This link expires in <strong>30 minutes</strong>. If you did not request a password reset, no action is needed.</p>
  `);

  await sendWithRetry(to, 'Reset your Lynx Market password', html);
}

// ── Config check ──────────────────────────────────────────────────────────────

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}
