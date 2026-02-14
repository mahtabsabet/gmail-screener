import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session.js';
import { getUser } from '@/lib/db.js';

export async function GET() {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ authenticated: false });
  }

  const user = getUser(userId);
  if (!user) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({
    authenticated: true,
    email: user.email,
  });
}
