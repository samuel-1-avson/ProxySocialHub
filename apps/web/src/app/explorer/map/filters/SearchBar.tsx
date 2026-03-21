"use client";

/**
 * Search Bar Component
 * Animated search with suggestions and filters
 */

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "../components/GlassPanel";

interface SearchResult {
  id: string;
  type: "node" | "city" | "country" | "region";
  name: string;
  subtitle?: string;
  icon?: string;
}

interface SearchBarProps {
  onSearch?: (query: string) => void;
  onResultSelect?: (result: SearchResult) => void;
  results?: SearchResult[];
  placeholder?: string;
  className?: string;
}

export function SearchBar({
  onSearch,
  onResultSelect,
  results = [],
  placeholder = "Search nodes, cities, countries...",
  className = "",
}: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (query) {
        onSearch?.(query);
        setShowResults(true);
      } else {
        setShowResults(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [query, onSearch]);

  const handleClear = () => {
    setQuery("");
    setShowResults(false);
    inputRef.current?.focus();
  };

  const getResultIcon = (type: SearchResult["type"]) => {
    switch (type) {
      case "node":
        return "📍";
      case "city":
        return "🏙️";
      case "country":
        return "🌍";
      case "region":
        return "🗺️";
      default:
        return "🔍";
    }
  };

  return (
    <div className={`relative ${className}`}>
      <GlassPanel
        intensity={isFocused ? "medium" : "light"}
        className="relative"
      >
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Search Icon */}
          <motion.span
            animate={{ 
              scale: isFocused ? 1.1 : 1,
              color: isFocused ? "#00F5FF" : "rgba(255,255,255,0.4)"
            }}
            className="text-xl"
          >
            🔍
          </motion.span>

          {/* Input */}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            placeholder={placeholder}
            className="flex-1 bg-transparent border-none outline-none text-white placeholder-white/40"
          />

          {/* Clear Button */}
          <AnimatePresence>
            {query && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={handleClear}
                className="text-white/40 hover:text-white transition-colors"
              >
                ✕
              </motion.button>
            )}
          </AnimatePresence>

          {/* Shortcut Hint */}
          {!query && !isFocused && (
            <span className="text-white/20 text-xs px-2 py-1 rounded bg-white/5">
              Ctrl+K
            </span>
          )}
        </div>
      </GlassPanel>

      {/* Results Dropdown */}
      <AnimatePresence>
        {showResults && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-full left-0 right-0 mt-2 z-50"
          >
            <GlassPanel intensity="heavy" className="max-h-80 overflow-y-auto">
              {results.map((result, index) => (
                <motion.button
                  key={result.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => {
                    onResultSelect?.(result);
                    setQuery(result.name);
                    setShowResults(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
                >
                  <span className="text-xl">{getResultIcon(result.type)}</span>
                  <div className="flex-1">
                    <div className="text-white font-medium">{result.name}</div>
                    {result.subtitle && (
                      <div className="text-white/40 text-xs">{result.subtitle}</div>
                    )}
                  </div>
                  <span className="text-xs text-white/30 uppercase">{result.type}</span>
                </motion.button>
              ))}
            </GlassPanel>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default SearchBar;
