import { useEffect, useRef } from 'react';
import type { TelegramUser } from '@/types';
import './TelegramLoginButton.css';

interface TelegramLoginButtonProps {
  botUsername: string;
  onAuth: (user: TelegramUser) => void;
  buttonSize?: 'large' | 'medium' | 'small';
  cornerRadius?: number;
  requestAccess?: boolean;
  usePic?: boolean;
  dataAuthUrl?: string;
}

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramUser) => void;
  }
}

export const TelegramLoginButton: React.FC<TelegramLoginButtonProps> = ({
  botUsername,
  onAuth,
  buttonSize = 'large',
  cornerRadius,
  requestAccess = true,
  usePic = false,
  dataAuthUrl,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<boolean>(false);

  useEffect(() => {
    if (instanceRef.current) return; // Запобігаємо повторній ініціалізації

    // Створюємо глобальну функцію для Telegram widget (як в офіційному прикладі)
    window.onTelegramAuth = (user: TelegramUser) => {
      console.log('Telegram auth callback:', user);
      onAuth(user);
    };

    // Створюємо script для Telegram widget
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', buttonSize);
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    
    if (cornerRadius !== undefined) {
      script.setAttribute('data-radius', cornerRadius.toString());
    }
    
    if (requestAccess) {
      script.setAttribute('data-request-access', 'write');
    }
    
    if (usePic) {
      script.setAttribute('data-userpic', 'true');
    }

    if (dataAuthUrl) {
      script.setAttribute('data-auth-url', dataAuthUrl);
    }

    if (containerRef.current) {
      containerRef.current.appendChild(script);
      instanceRef.current = true;
    }

    // Cleanup
    return () => {
      if (containerRef.current && script.parentNode) {
        containerRef.current.removeChild(script);
      }
      // Видаляємо глобальну функцію
      delete window.onTelegramAuth;
    };
  }, [botUsername, buttonSize, cornerRadius, requestAccess, usePic, dataAuthUrl, onAuth]);

  return <div ref={containerRef} className="telegram-login-button"></div>;
};
