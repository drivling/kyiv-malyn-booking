import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrainTicketModal } from './TrainTicketModal';
import type { Schedule } from '@/types';

const schedule: Schedule = {
  id: 1,
  route: 'Korosten-Malyn',
  departureTime: '07:10',
  maxSeats: 0,
  supportPhone: null,
  vehicleType: 'elektrichka',
  tripNumber: '6102',
  ticketPurchaseUrl: 'https://tickets.example/buy',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('TrainTicketModal', () => {
  test('shows disclaimer and purchase link', () => {
    render(<TrainTicketModal schedule={schedule} onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Квиток на електричку' })).toBeInTheDocument();
    expect(screen.getByText(/не бронюємо/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Купити квиток' });
    expect(link).toHaveAttribute('href', 'https://tickets.example/buy');
  });
});
