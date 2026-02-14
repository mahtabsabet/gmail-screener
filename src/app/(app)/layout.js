import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session.js';
import { getUser } from '@/lib/db.js';
import AppShell from '@/components/AppShell';

export default async function AppLayout({ children }) {
  const userId = await getSession();
  if (!userId) redirect('/');

  const user = getUser(userId);
  if (!user) redirect('/');

  return <AppShell email={user.email}>{children}</AppShell>;
}
