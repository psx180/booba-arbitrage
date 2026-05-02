'use client';

import { useState } from 'react';

export interface MethodologyPopupProps {
  whatItMeans: string;
  howComputed: string;
  source: string;
  sourceUrl?: string;
}

export function MethodologyPopup({
  whatItMeans,
  howComputed,
  source,
  sourceUrl,
}: MethodologyPopupProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs text-[#8b949e] hover:text-[#58a6ff] transition-colors"
        aria-expanded={open}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm0 14.5a6.5 6.5 0 110-13 6.5 6.5 0 010 13zM7.25 4.5a.75.75 0 111.5 0 .75.75 0 01-1.5 0zm.75 2.5a.75.75 0 01.75.75v4a.75.75 0 01-1.5 0v-4A.75.75 0 018 7z" />
        </svg>
        {open ? 'Hide methodology' : 'How is this computed?'}
      </button>
      {open && (
        <div className="mt-2 pl-3 border-l-2 border-[#58a6ff] text-xs text-[#c9d1d9] space-y-2">
          <div>
            <div className="text-[#8b949e] uppercase tracking-wide text-[10px] mb-0.5">
              What it means
            </div>
            <div className="leading-relaxed">{whatItMeans}</div>
          </div>
          <div>
            <div className="text-[#8b949e] uppercase tracking-wide text-[10px] mb-0.5">
              How we computed it
            </div>
            <div className="leading-relaxed">{howComputed}</div>
          </div>
          <div>
            <div className="text-[#8b949e] uppercase tracking-wide text-[10px] mb-0.5">
              Source
            </div>
            <div className="leading-relaxed italic">
              {sourceUrl ? (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#58a6ff] hover:underline"
                >
                  {source}
                </a>
              ) : (
                source
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
