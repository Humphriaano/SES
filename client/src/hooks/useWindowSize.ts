import { useState, useEffect } from 'react';

export function useWindowSize() {
  const [width, setWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    let raf: number;
    const handler = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setWidth(window.innerWidth));
    };
    window.addEventListener('resize', handler, { passive: true });
    return () => {
      window.removeEventListener('resize', handler);
      cancelAnimationFrame(raf);
    };
  }, []);

  return {
    width,
    isMobile: width < 768,
    isTablet: width < 1024,
  };
}
