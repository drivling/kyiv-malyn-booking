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
    TelegramLoginWidget?: {
      dataOnauth: (user: TelegramUser) => void;
    };
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

    // Зберігаємо callback в window для Telegram widget
    if (!window.TelegramLoginWidget) {
      window.TelegramLoginWidget = {
        dataOnauth: onAuth,
      };
    } else {
      window.TelegramLoginWidget.dataOnauth = onAuth;
    }

    // Створюємо script для Telegram widget
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', buttonSize);
    
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
    } else {
      script.setAttribute('data-onauth', 'TelegramLoginWidget.dataOnauth(user)');
    }

    script.async = true;

    if (containerRef.current) {
      containerRef.current.appendChild(script);
      instanceRef.current = true;
    }

    // Cleanup
    return () => {
      if (containerRef.current && script.parentNode) {
        containerRef.current.removeChild(script);
      }
    };
  }, [botUsername, buttonSize, cornerRadius, requestAccess, usePic, dataAuthUrl, onAuth]);

  return <div ref={containerRef} className="telegram-login-button"></div>;
};
