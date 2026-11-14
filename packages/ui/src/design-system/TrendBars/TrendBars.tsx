import classes from './TrendBars.module.css';

type TrendBarValue = {
  /** Names the interval, for example a date range. */
  label: string;
  /** Null marks an interval without a measurement, drawn as a baseline tick. */
  value: number | null;
  /** The value as text, shown in the bar's tooltip. */
  display: string;
};

/**
 * A compact single-series column chart for a trend over equal intervals. It is a
 * summary only: pair it with a table or text that states the same values.
 */
export function TrendBars({
  values,
  label,
}: {
  values: TrendBarValue[];
  /** Accessible summary of what the bars show. */
  label: string;
}) {
  const width = 120;
  const height = 32;
  const gap = 2;
  const max = Math.max(0, ...values.map((entry) => entry.value ?? 0));
  const barWidth = values.length
    ? (width - gap * (values.length - 1)) / values.length
    : 0;
  return (
    <svg
      className={classes.chart}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <line
        className={classes.baseline}
        x1={0}
        x2={width}
        y1={height - 0.5}
        y2={height - 0.5}
      />
      {values.map((entry, index) => {
        const barHeight =
          entry.value && max > 0
            ? Math.max(2, (entry.value / max) * (height - 2))
            : 0;
        return (
          <g key={index}>
            <title>{`${entry.label}: ${entry.display}`}</title>
            {/* A full-height target keeps the tooltip reachable on short bars. */}
            <rect
              className={classes.target}
              x={index * (barWidth + gap)}
              y={0}
              width={barWidth}
              height={height}
            />
            {barHeight > 0 && (
              <rect
                className={classes.bar}
                x={index * (barWidth + gap)}
                y={height - barHeight}
                width={barWidth}
                height={barHeight}
                rx={Math.min(2, barWidth / 2)}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
