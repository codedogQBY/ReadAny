/**
 * Throttled Value Hook
 * Inspired by OpenCode's createThrottledValue
 * 
 * Prevents excessive re-renders during streaming by throttling value updates.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_THROTTLE_MS = 100;

export function useThrottledValue<T>(value: T, throttleMs: number = DEFAULT_THROTTLE_MS): T {
  const [throttledValue, setThrottledValue] = useState(value);
  const lastUpdateRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateRef.current;
    const remaining = throttleMs - timeSinceLastUpdate;

    if (remaining <= 0) {
      lastUpdateRef.current = now;
      setThrottledValue(value);
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      lastUpdateRef.current = Date.now();
      setThrottledValue(value);
    }, remaining);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, throttleMs]);

  return throttledValue;
}

export function useThrottledCallback<T extends unknown[]>(
  callback: (...args: T) => void,
  throttleMs: number = DEFAULT_THROTTLE_MS
): (...args: T) => void {
  const lastCallRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingArgsRef = useRef<T | null>(null);

  const flush = useCallback(() => {
    if (pendingArgsRef.current) {
      callback(...pendingArgsRef.current);
      pendingArgsRef.current = null;
    }
  }, [callback]);

  const throttledCallback = useCallback(
    (...args: T) => {
      const now = Date.now();
      const timeSinceLastCall = now - lastCallRef.current;
      const remaining = throttleMs - timeSinceLastCall;

      pendingArgsRef.current = args;

      if (remaining <= 0) {
        lastCallRef.current = now;
        flush();
        return;
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        lastCallRef.current = Date.now();
        flush();
      }, remaining);
    },
    [callback, throttleMs, flush]
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return throttledCallback;
}

export function useStreamingText(initialText: string = "") {
  const [text, setText] = useState(initialText);
  const [isStreaming, setIsStreaming] = useState(false);
  const throttledText = useThrottledValue(text);

  const appendText = useCallback((delta: string) => {
    setText((prev) => prev + delta);
  }, []);

  const startStreaming = useCallback(() => {
    setIsStreaming(true);
    setText("");
  }, []);

  const stopStreaming = useCallback(() => {
    setIsStreaming(false);
  }, []);

  const resetText = useCallback(() => {
    setText("");
    setIsStreaming(false);
  }, []);

  return {
    text: throttledText,
    rawText: text,
    isStreaming,
    appendText,
    startStreaming,
    stopStreaming,
    resetText,
    setText,
  };
}
