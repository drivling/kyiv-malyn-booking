import React, { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { apiClient } from '@/api/client';
import { datasetSaveErrorMessage, type TransportDataset } from '@/api/transportDataset';
import { importConfirmText, parseImportedDataset } from './datasetImport';
import { broadcastTransportDatasetInvalidate } from '../LocalTransportPage/dataset/useTransportDataset';
import { isDefaultTransportCity, transportCityOptions } from '@/site/transportCity';

/**
 * «Імпорт датасету з файлу» в редакторі карти — для міста, яке ще наповнюємо (фаза 8 плану Коростеня,
 * Docs/korosten-transport-data-2026-11.md): JSON у форматі PUT /transport/dataset (наприклад,
 * data/korosten-transport/dataset/korosten-dataset.json) повністю замінює датасет обраного міста.
 * Для Малина кнопки нема: там датасет правлять редактори, а не файл.
 */

export const DatasetImportButton: React.FC<{
  city: string;
  current: TransportDataset | null;
  disabled?: boolean;
  onImported: (message: string) => void;
  onError: (message: string) => void;
}> = ({ city, current, disabled, onImported, onError }) => {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (isDefaultTransportCity(city)) return null;
  const cityName = transportCityOptions().find((o) => o.cityCode === city)?.name ?? city;

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (input.current) input.current.value = '';
    if (!file) return;
    let next: TransportDataset;
    try {
      next = parseImportedDataset(await file.text());
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Не вдалося прочитати файл');
      return;
    }
    if (!window.confirm(importConfirmText(cityName, current, next))) return;
    setBusy(true);
    try {
      // meta з бази (редиректи зупинок тощо) лишається, поверх — meta з файлу
      const meta = { ...(current?.meta ?? {}), ...next.meta };
      const result = await apiClient.putTransportDataset({ ...next, meta }, current?.revision ?? null, city);
      broadcastTransportDatasetInvalidate();
      onImported(`Імпортовано: ${result.counts.stops} зупинок, ${result.counts.routes} маршрутів, ${result.counts.trips} рейсів`);
    } catch (err) {
      onError(datasetSaveErrorMessage(err, 'Не вдалося імпортувати датасет'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        data-testid="dataset-import-file"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="secondary"
        onClick={() => input.current?.click()}
        disabled={disabled || busy}
        title={`Замінити датасет міста ${cityName} файлом JSON (формат PUT /transport/dataset)`}
      >
        {busy ? 'Імпорт…' : 'Імпорт датасету з файлу…'}
      </Button>
    </>
  );
};
