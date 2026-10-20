/**
 * Тариф міського транспорту в довідці — з датасету (`meta.fare`, те саме джерело, що чип «проїзд» на /transport,
 * табло й наклейки), а не з тексту статті: цифру змінює власник одним записом датасету, і довідка підтягує її сама.
 * Поки даних нема (перший рендер, мережа) — чип без числа не малюємо, лише речення про джерело.
 */
import { useTransportDataset } from '@/pages/LocalTransportPage/dataset/useTransportDataset';

export function CityFareChip() {
  const { dataset } = useTransportDataset();
  const fare = (dataset?.meta?.fare ?? null) as { amount?: unknown; note?: unknown } | null;
  const amount = typeof fare?.amount === 'number' ? fare.amount : null;
  const note = typeof fare?.note === 'string' && fare.note.trim() ? fare.note : null;
  if (amount == null) {
    return <p className="support-fare-chip__pending">Тариф у сервісі — на сторінці маршруту й табло, з даних міста.</p>;
  }
  return (
    <>
      <div className="support-fare-chip" aria-label={`Тариф ${amount} гривень`}>
        <span className="support-fare-chip__label">Тариф у сервісі</span>
        <span className="support-fare-chip__amount">
          {amount}
          <span aria-hidden>₴</span>
        </span>
        <span className="support-fare-chip__meta">за поїздку · біля № лінії</span>
      </div>
      {note && <p className="support-fare-chip__note">{note}</p>}
    </>
  );
}
