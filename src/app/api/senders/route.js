import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session.js';
import { setSenderStatus, removeSender, listSenders } from '@/lib/db.js';

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const senders = await listSenders(userId);
  return NextResponse.json({ senders });
}

export async function POST(request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { email, status } = await request.json();
  if (!email || !['APPROVED', 'DENIED'].includes(status)) {
    return NextResponse.json({ error: 'Invalid email or status' }, { status: 400 });
  }

  await setSenderStatus(userId, email, status);
  return NextResponse.json({ success: true, email, status });
}

export async function DELETE(request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { email } = await request.json();
  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  await removeSender(userId, email);
  return NextResponse.json({ success: true });
}
