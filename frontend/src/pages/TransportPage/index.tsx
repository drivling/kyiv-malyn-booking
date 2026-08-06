import React from 'react';
import { useTransportDataset } from './useTransportDataset';
import { TransportPlanner } from './TransportPlanner';
import { TransportRoutes, TransportRouteDetail, TransportStopBoard } from './TransportViews';
import './TransportPage.css';

function Gate({ children }: { children: (dataset: NonNullable<ReturnType<typeof useTransportDataset>['dataset']>) => React.ReactNode }) {
  const { dataset, loading, error } = useTransportDataset();
  if (loading) return <div className="tp-loading">Завантаження транспорту…</div>;
  if (error || !dataset) return <div className="tp-error">{error || 'Немає даних'}</div>;
  return <>{children(dataset)}</>;
}

export const TransportPlannerPage: React.FC = () => (
  <Gate>{(d) => <TransportPlanner dataset={d} />}</Gate>
);

export const TransportRoutesPage: React.FC = () => (
  <Gate>{(d) => <TransportRoutes dataset={d} />}</Gate>
);

export const TransportRoutePage: React.FC = () => (
  <Gate>{(d) => <TransportRouteDetail dataset={d} />}</Gate>
);

export const TransportStopPage: React.FC = () => (
  <Gate>{(d) => <TransportStopBoard dataset={d} />}</Gate>
);

export { TransportPlannerPage as TransportPage };
