import { useRef } from 'react';

interface CachedIcon {
  dataUrl: string;
  timestamp: number;
}

/**
 * Shared icon cache hook for BLP files.
 * Stores parsed icons as data URLs to avoid re-parsing the same file.
 */
export const useIconCache = () => {
  const cacheRef = useRef<Map<string, CachedIcon>>(new Map());

  const getCachedIcon = (iconName: string): string | null => {
    const cached = cacheRef.current.get(iconName);
    if (cached) {
      return cached.dataUrl;
    }
    return null;
  };

  const setCachedIcon = (iconName: string, dataUrl: string): void => {
    cacheRef.current.set(iconName, {
      dataUrl,
      timestamp: Date.now(),
    });
  };

  const clearCache = (): void => {
    cacheRef.current.clear();
  };

  const getCacheSize = (): number => {
    return cacheRef.current.size;
  };

  return {
    getCachedIcon,
    setCachedIcon,
    clearCache,
    getCacheSize,
    cache: cacheRef.current,
  };
};

// Global cache instance shared across components
let globalIconCache: Map<string, CachedIcon> = new Map();

export const useGlobalIconCache = () => {
  const getCachedIcon = (iconName: string): string | null => {
    const cached = globalIconCache.get(iconName);
    if (cached) {
      return cached.dataUrl;
    }
    return null;
  };

  const setCachedIcon = (iconName: string, dataUrl: string): void => {
    globalIconCache.set(iconName, {
      dataUrl,
      timestamp: Date.now(),
    });
  };

  const clearCache = (): void => {
    globalIconCache.clear();
  };

  const getCacheSize = (): number => {
    return globalIconCache.size;
  };

  return {
    getCachedIcon,
    setCachedIcon,
    clearCache,
    getCacheSize,
    cache: globalIconCache,
  };
};
