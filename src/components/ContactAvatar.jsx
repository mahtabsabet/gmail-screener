'use client';

import { useState } from 'react';

/**
 * Avatar that tries to load a photo URL, falls back to initial letter on error (e.g. Gravatar 404).
 */
export default function ContactAvatar({ photoUrl, name, size = 'w-9 h-9', textSize = 'text-sm' }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initial = (name || '?')[0].toUpperCase();

  if (photoUrl && !imgFailed) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className={`${size} rounded-full flex-shrink-0 object-cover`}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <div className={`${size} rounded-full bg-blue-100 text-blue-700 flex items-center justify-center ${textSize} font-semibold flex-shrink-0`}>
      {initial}
    </div>
  );
}
