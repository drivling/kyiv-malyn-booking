import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Combobox } from './Combobox';

const options = [
  { value: '', label: '— Зупинка —' },
  { value: 'st_a', label: 'Базар' },
  { value: 'st_b', label: 'Вокзал' },
];

beforeAll(() => {
  // jsdom не має scrollIntoView, а Combobox прокручує підсвічену опцію.
  Element.prototype.scrollIntoView = vi.fn();
});

describe('Combobox', () => {
  it('зовнішній label htmlFor + id пов’язують лейбл з інпутом', () => {
    render(
      <>
        <label htmlFor="cb-from">З</label>
        <Combobox id="cb-from" label="" options={options} value="" onChange={() => {}} />
      </>
    );
    expect(screen.getByLabelText('З')).toHaveAttribute('role', 'combobox');
    expect(screen.getByRole('combobox', { name: 'З' })).toHaveAttribute('id', 'cb-from');
  });

  it('aria-label дає доступну назву без видимого лейбла', () => {
    render(<Combobox label="" aria-label="Зупинка" options={options} value="" onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Зупинка' })).toBeInTheDocument();
  });

  it('набір тексту віддає сирий текст в onChange і не викликає onClear', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<Combobox label="" options={options} value="" onChange={onChange} onClear={onClear} clearable />);
    await user.type(screen.getByRole('combobox'), 'Ба');
    expect(onChange).toHaveBeenCalledWith('Б');
    expect(onChange).toHaveBeenLastCalledWith('Ба');
    expect(onClear).not.toHaveBeenCalled();
  });

  it('стирання клавіатурою → onChange(""), але не onClear', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<Combobox label="" options={options} value="st_a" onChange={onChange} onClear={onClear} clearable />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveValue('Базар');
    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(onClear).not.toHaveBeenCalled();
  });

  it('кнопка «×» викликає і onChange(""), і onClear', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<Combobox label="" options={options} value="st_a" onChange={onChange} onClear={onClear} clearable />);
    await user.click(screen.getByRole('button', { name: 'Очистити' }));
    expect(onChange).toHaveBeenCalledWith('');
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('вибір опції зі списку → onChange(value) і onSelectOption', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSelectOption = vi.fn();
    render(<Combobox label="" options={options} value="" onChange={onChange} onSelectOption={onSelectOption} />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Вокзал' }));
    expect(onChange).toHaveBeenLastCalledWith('st_b');
    expect(onSelectOption).toHaveBeenCalledWith('st_b');
  });
});
