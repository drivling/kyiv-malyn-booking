import { useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import type { TelegramScenariosResponse } from '@/types';
import { TELEGRAM_BOT_USERNAME } from '@/legal/sitePublic';

export const DEFAULT_TELEGRAM_SCENARIOS: TelegramScenariosResponse = {
  enabled: true,
  scenarios: {
    driver: {
      title: 'Запит на поїздку як водій',
      command: '/adddriverride',
      deepLink: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=driver`,
    },
    passenger: {
      title: 'Запит на поїздку як пасажир',
      command: '/addpassengerride',
      deepLink: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=passenger`,
    },
    view: {
      title: 'Вільний перегляд поїздок',
      command: '/poputky',
      deepLink: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=view`,
      // відносне посилання — працює на будь-якому домені сервісу
      webLink: '/mizhgorodski',
    },
  },
};

export function useTelegramScenarios() {
  const [scenarios, setScenarios] = useState<TelegramScenariosResponse>(DEFAULT_TELEGRAM_SCENARIOS);

  useEffect(() => {
    apiClient
      .getTelegramScenarios()
      .then((data) => {
        if (data?.scenarios?.driver?.deepLink && data?.scenarios?.passenger?.deepLink) {
          setScenarios(data);
        }
      })
      .catch(() => {});
  }, []);

  return scenarios;
}

export { TELEGRAM_BOT_USERNAME };
