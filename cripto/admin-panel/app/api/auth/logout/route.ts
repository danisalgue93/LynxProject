import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export async function POST() {
  const session = await getSession();
  // destroy() clears session data; save() persists the empty cookie so the browser deletes it
  session.destroy();
  await session.save();
  return NextResponse.json({ ok: true });
}
