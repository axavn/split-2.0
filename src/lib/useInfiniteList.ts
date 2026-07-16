import { useEffect, useRef, useState } from 'react';

// Infinite scroll (spec §5/§6) without a scroll listener: render only the
// first `pageSize` items plus an invisible sentinel div after them. An
// IntersectionObserver fires when the sentinel scrolls into view, and we
// reveal the next page. The browser does the hard part; no scroll math.
export function useInfiniteList<T>(items: T[], pageSize = 20) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount((count) => Math.min(count + pageSize, items.length));
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [items.length, pageSize, visibleCount]);

  return {
    visible: items.slice(0, visibleCount),
    hasMore: visibleCount < items.length,
    sentinelRef,
  };
}
