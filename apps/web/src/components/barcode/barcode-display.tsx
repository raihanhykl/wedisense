"use client";

interface BarcodeDisplayProps {
  value: string;
  type: "CODE128" | "QR";
}

export default function BarcodeDisplay({ value, type }: BarcodeDisplayProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border bg-white p-4">
      <div className="flex h-24 w-48 items-center justify-center rounded bg-gray-50">
        {type === "QR" ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-16 w-16 text-gray-700"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75H16.5v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75H16.5v-.75z"
            />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-16 w-full text-gray-700"
            viewBox="0 0 200 60"
          >
            {/* Simple barcode visual representation */}
            {Array.from({ length: 40 }).map((_, i) => {
              const width = i % 3 === 0 ? 3 : i % 2 === 0 ? 2 : 1;
              const x = i * 5;
              return (
                <rect
                  key={i}
                  x={x}
                  y={0}
                  width={width}
                  height={50}
                  fill="currentColor"
                />
              );
            })}
          </svg>
        )}
      </div>
      <p className="font-mono text-xs text-muted-foreground">{value}</p>
    </div>
  );
}
