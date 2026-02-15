import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAuthUrl, generateOAuthState } from '@/lib/gmail.js';

export async function GET() {
  const state = generateOAuthState();

  // Store state in a short-lived cookie for verification in the callback
  const cookieStore = await cookies();
  cookieStore.set('gk_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  });

  const url = getAuthUrl(state);
  return NextResponse.redirect(url);
}
