export function SkeletonBlock({ height = 16, width = '100%' }: { height?: number; width?: string | number }) {
  return <div className="skeleton" style={{ height, width }} />;
}

export function SkeletonCard() {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SkeletonBlock height={12} width="40%" />
      <SkeletonBlock height={22} width="60%" />
      <SkeletonBlock height={10} width="80%" />
    </div>
  );
}
