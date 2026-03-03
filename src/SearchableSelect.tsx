import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SearchableSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "aria-label"?: string;
  id?: string;
  style?: React.CSSProperties;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  "aria-label": ariaLabel,
  id,
  style,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [dropUp, setDropUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? "",
    [options, value],
  );

  const filtered = useMemo(() => {
    if (!search) return options.filter((o) => !o.disabled);
    const lower = search.toLowerCase();
    return options.filter(
      (o) => !o.disabled && o.label.toLowerCase().includes(lower),
    );
  }, [options, search]);

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIdx(0);
  }, [filtered.length, search]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const item = listRef.current.children[highlightIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx, isOpen]);

  // Close on outside click / touch
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick);
    };
  }, [isOpen]);

  // Determine whether to drop up or down based on available space
  const measureDropDirection = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    // If less than 240px below and more room above, drop upward
    setDropUp(spaceBelow < 240 && spaceAbove > spaceBelow);
  }, []);

  function open() {
    measureDropDirection();
    setIsOpen(true);
    setSearch("");
    // Pre-highlight the currently selected item
    const enabledOptions = options.filter((o) => !o.disabled);
    const idx = enabledOptions.findIndex((o) => o.value === value);
    setHighlightIdx(idx >= 0 ? idx : 0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function select(val: string) {
    onChange(val);
    setIsOpen(false);
    setSearch("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        open();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[highlightIdx]) select(filtered[highlightIdx].value);
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setSearch("");
        break;
      case "Tab":
        setIsOpen(false);
        setSearch("");
        break;
    }
  }

  return (
    <div
      ref={containerRef}
      className="searchable-select"
      style={style}
      onKeyDown={handleKeyDown}
    >
      {isOpen ? (
        <input
          ref={inputRef}
          id={id}
          className="searchable-select-input"
          type="text"
          inputMode="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={selectedLabel || placeholder}
          aria-label={ariaLabel}
          aria-expanded="true"
          aria-haspopup="listbox"
          role="combobox"
          aria-autocomplete="list"
          autoComplete="off"
        />
      ) : (
        <button
          type="button"
          id={id}
          className={`searchable-select-trigger${value ? "" : " placeholder"}`}
          onClick={open}
          aria-label={ariaLabel}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded="false"
        >
          <span className="searchable-select-label">
            {selectedLabel || placeholder}
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      )}

      {isOpen && (
        <ul
          ref={listRef}
          className={`searchable-select-dropdown${dropUp ? " drop-up" : ""}`}
          role="listbox"
          aria-label={ariaLabel}
        >
          {filtered.length === 0 ? (
            <li className="searchable-select-empty">No matches</li>
          ) : (
            filtered.map((opt, i) => (
              <li
                key={opt.value}
                role="option"
                aria-selected={opt.value === value}
                className={`searchable-select-option${i === highlightIdx ? " highlighted" : ""}${opt.value === value ? " selected" : ""}`}
                onMouseEnter={() => setHighlightIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep input focused
                  select(opt.value);
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
}
