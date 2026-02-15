import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeCode } from '@/lib/gmail.js';
import { upsertUser } from '@/lib/db.js';
import { setSession } from '@/lib/session.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');

  if (error) {
    return NextResponse.redirect(new URL('/?error=auth_denied', request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/?error=no_code', request.url));
  }

  // Verify OAuth state parameter to prevent CSRF
  const cookieStore = await cookies();
  const storedState = cookieStore.get('gk_oauth_state')?.value;
  cookieStore.delete('gk_oauth_state');

  if (!state || !storedState || state !== storedState) {
    return NextResponse.redirect(new URL('/?error=invalid_state', request.url));
  }

  try {
    const { userId, email, accessToken, refreshToken, tokenExpiry } = await exchangeCode(code);

    upsertUser({ userId, email, accessToken, refreshToken, tokenExpiry });
    await setSession(userId);

    return NextResponse.redirect(new URL('/imbox', request.url));
  } catch (err) {
    console.error('OAuth callback error:', err);
    return NextResponse.redirect(new URL('/?error=auth_failed', request.url));
  }
}
