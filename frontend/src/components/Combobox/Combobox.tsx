import React, { useState, useRef, useEffect, useCallback } from 'react';
import './Combobox.css';

export interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxProps {
  label?: string;
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  filterFn?: (option: ComboboxOption, query: string) => boolean;
}

const defaultFilter = (opt: ComboboxOption, query: string) =>
  opt.label.toLowerCase().includes(query.toLowerCase());

export const Combobox: React.FC<ComboboxProps> = ({
  label,
  options,
  value,
  onChange,
  placeholder = 'Введіть для пошуку...',
  emptyMessage = 'Нічого не знайдено',
  filterFn = defaultFilter,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [inputValue, setInputValue] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = options.filter((opt) => filterFn(opt, inputValue));
  const selectedOption = options.find((o) => o.value === value);

  useEffect(() => {
    const opt = options.find((o) => o.value === value);
    setInputValue(value === '' ? '' : (opt?.label ?? value));
  }, [value, options]);

  const close = useCallback((updateInput = true) => {
    setIsOpen(false);
    setHighlightIndex(0);
    if (updateInput) {
      setInputValue(value === '' ? '' : (selectedOption?.label ?? value));
    }
  }, [value, selectedOption?.label]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        close();
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [close]);

  const scrollToHighlight = () => {
    const list = listRef.current;
    const item = list?.children[highlightIndex];
    if (item) item.scrollIntoView({ block: 'nearest' });
  };

  useEffect(() => {
    if (isOpen) scrollToHighlight();
  }, [highlightIndex, isOpen]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInputValue(v);
    setIsOpen(true);
    setHighlightIndex(0);
    onChange(v);
  };

  const handleInputFocus = () => {
    setIsOpen(true);
    setHighlightIndex(0);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Alt+ArrowDown') setIsOpen(true);
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIndex((i) => (i < filtered.length - 1 ? i + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex((i) => (i > 0 ? i - 1 : filtered.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[highlightIndex]) {
          const opt = filtered[highlightIndex];
          onChange(opt.value);
          setInputValue(opt.value === '' ? '' : opt.label);
          close();
        }
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
      default:
        break;
    }
  };

  const handleSelect = (opt: ComboboxOption) => {
    onChange(opt.value);
    setInputValue(opt.value === '' ? '' : opt.label);
    close(false);
  };

  const listId = `combobox-list-${Math.random().toString(36).slice(2)}`;
  const inputId = `combobox-input-${Math.random().toString(36).slice(2)}`;

  return (
    <div ref={containerRef} className="combobox">
      {label && (
        <label htmlFor={inputId} className="combobox-label">
          {label}
        </label>
      )}
      <div className="combobox-input-wrap">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-activedescendant={
            isOpen && filtered[highlightIndex]
              ? `${listId}-option-${highlightIndex}`
              : undefined
          }
          className="combobox-input"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          autoComplete="off"
        />
        <button
          type="button"
          className="combobox-toggle"
          onClick={() => setIsOpen((o) => !o)}
          tabIndex={-1}
          aria-label="Відкрити список"
          aria-expanded={isOpen}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path
              d={isOpen ? 'M3 7l3-3 3 3' : 'M3 5l3 3 3-3'}
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
      {isOpen && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          className="combobox-list"
          aria-label={label ?? 'Варіанти'}
        >
          {filtered.length === 0 ? (
            <li className="combobox-empty" role="status">
              {emptyMessage}
            </li>
          ) : (
            filtered.map((opt, i) => (
              <li
                key={opt.value}
                id={`${listId}-option-${i}`}
                role="option"
                aria-selected={opt.value === value}
                className={`combobox-option ${i === highlightIndex ? 'combobox-option--highlight' : ''}`}
                onMouseEnter={() => setHighlightIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(opt);
                }}
              >
                {opt.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};
