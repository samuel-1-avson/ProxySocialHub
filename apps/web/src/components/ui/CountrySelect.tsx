"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import {
  listCountries,
  matchCountry,
  searchCountries,
  type CountryOption,
} from "@/lib/countries";

/**
 * Pick a country from a list or type to search it. The value is the
 * two-letter ISO code ("GH"); an empty string means no country.
 */
export function CountrySelect({
  value,
  onChange,
  label = "Country",
  placeholder = "Search countries",
  options,
  allowEmpty = true,
  disabled = false,
  required = false,
  describedBy,
}: {
  value: string;
  onChange: (code: string) => void;
  label?: string;
  placeholder?: string;
  /** Limit the list (for example to countries that have listings). */
  options?: readonly CountryOption[];
  allowEmpty?: boolean;
  disabled?: boolean;
  required?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const all = useMemo(() => options ?? listCountries(), [options]);
  const selected = all.find((c) => c.code === value.toUpperCase());
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => searchCountries(query, all), [query, all]);
  const text = open ? query : (selected?.name ?? "");

  function choose(code: string) {
    onChange(code);
    setOpen(false);
    setQuery("");
  }
  function openList() {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    setActive(Math.max(0, all.findIndex((c) => c.code === selected?.code)));
  }
  function scrollTo(index: number) {
    const el = listRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }
  function move(delta: number) {
    if (!open) return openList();
    if (!shown.length) return;
    const next = (active + delta + shown.length) % shown.length;
    setActive(next);
    scrollTo(next);
  }

  return (
    <div className="ui-combobox">
      <input
        className="ui-input ui-combobox-input"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-describedby={describedBy}
        aria-activedescendant={
          open && shown[active] ? `${id}-${shown[active].code}` : undefined
        }
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        value={text}
        onFocus={openList}
        onClick={() => !open && openList()}
        onChange={(e) => {
          setOpen(true);
          setQuery(e.target.value);
          setActive(0);
        }}
        onBlur={() => {
          // Typing a full name or code and tabbing away still picks it.
          if (open && query) {
            const typed = matchCountry(query, all);
            if (typed) onChange(typed.code);
          }
          setOpen(false);
          setQuery("");
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            move(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          } else if (e.key === "Enter" && open) {
            // Enter picks the highlighted country, it does not submit the form.
            e.preventDefault();
            if (shown[active]) choose(shown[active].code);
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            setOpen(false);
            setQuery("");
          }
        }}
      />
      {allowEmpty && selected && !disabled ? (
        <button
          type="button"
          className="ui-combobox-clear"
          aria-label={`Clear ${label.toLowerCase()}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => choose("")}
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : (
        <ChevronDown
          size={16}
          className="ui-combobox-chevron"
          aria-hidden="true"
        />
      )}
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className="ui-combobox-list"
        >
          {shown.length ? (
            shown.map((country, index) => (
              <li
                key={country.code}
                id={`${id}-${country.code}`}
                role="option"
                aria-selected={country.code === selected?.code}
                className={
                  "ui-combobox-option" + (index === active ? " active" : "")
                }
                // mousedown runs before the input's blur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(country.code);
                }}
                onMouseMove={() => setActive(index)}
              >
                <span>{country.name}</span>
                <span className="ui-combobox-code">{country.code}</span>
                {country.code === selected?.code && (
                  <Check size={14} aria-hidden="true" />
                )}
              </li>
            ))
          ) : (
            <li className="ui-combobox-empty" role="presentation">
              No country matches &ldquo;{query}&rdquo;.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
