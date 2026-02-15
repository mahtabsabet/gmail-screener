import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session.js';
import { getUser } from '@/lib/db.js';

export default async function Home() {
  const userId = await getSession();
  if (userId) {
    const user = await getUser(userId);
    if (user) redirect('/imbox');
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <h1 className="text-4xl font-bold mb-2">Gatekeeper</h1>
        <p className="text-gray-500 mb-8">
          HEY-style email screening for your Gmail.
          Take control of who gets into your inbox.
        </p>
        <a
          href="/api/auth"
          className="inline-flex items-center gap-3 px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z" />
          </svg>
          Sign in with Google
        </a>
      </div>
    </div>
  );
}
