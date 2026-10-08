import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/api/client';
import { Button } from '@/components/Button';
import { wallUrl } from '@/pages/StickerWallPage/stickerWall';
import { qrPath } from './stickerSvg';

/**
 * «Віджет на стіну»: посилання з ключем лише на читання сьогоднішніх відкриттів — QR для телефона
 * (відсканувати й відкрити), «Відкрити тут» і «Скопіювати». Телефону не потрібна адмін-сесія.
 */
export function WallLinkDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getStickerWallKey()
      .then(({ key }) => !cancelled && setUrl(wallUrl(window.location.origin, key)))
      .catch((e: Error) => !cancelled && setError(e.message || 'Не вдалося отримати посилання'));
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const qr = url ? qrPath(url, 4, 4, 92) : null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="wall-link-overlay" role="presentation" onClick={onClose}>
      <div
        className="wall-link-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wall-link-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="wall-link-title">Віджет на стіну</h3>
        <p className="sticker-tab-muted">
          Відскануйте телефоном, поверніть його горизонтально й торкніться «Почати». Екран не гаситиметься, а кожне
          нове відкриття з QR віджет покаже з мелодією. Посилання дає лише перегляд цих лічильників — без входу в
          адмінку.
        </p>
        {error && <p className="sticker-tab-status--error">{error}</p>}
        {qr && (
          <svg className="wall-link-qr" viewBox="0 0 100 100" role="img" aria-label="QR-код посилання на віджет">
            <rect width="100" height="100" fill="#fff" />
            <path d={qr.d} fill="#1b1f2a" />
          </svg>
        )}
        <div className="sticker-tab-actions">
          {url && (
            <a className="wall-link-open" href={url} target="_blank" rel="noopener noreferrer">
              Відкрити тут
            </a>
          )}
          {url && (
            <Button type="button" variant="secondary" onClick={copy}>
              {copied ? 'Скопійовано' : 'Скопіювати посилання'}
            </Button>
          )}
          {/* Button не передає ref — фокус при відкритті ставимо на звичайну кнопку з тими ж класами */}
          <button ref={closeRef} type="button" className="btn btn-secondary" onClick={onClose}>
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
}
