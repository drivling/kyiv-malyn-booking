import { type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type Options = Omit<RenderOptions, 'wrapper'> & {
  initialEntries?: string[];
};

function Providers({
  children,
  initialEntries = ['/'],
}: {
  children: ReactNode;
  initialEntries?: string[];
}) {
  return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>;
}

export function renderWithProviders(ui: ReactElement, options: Options = {}) {
  const { initialEntries, ...renderOptions } = options;
  return render(ui, {
    wrapper: ({ children }) => (
      <Providers initialEntries={initialEntries}>{children}</Providers>
    ),
    ...renderOptions,
  });
}

export * from '@testing-library/react';
