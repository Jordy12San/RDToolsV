import React from 'react';

export const metadata = {
  title: "Renovatie Direct • Visualisatietool",
  description: "Toon de nieuwe kozijnen, deuren en gevelbekleding direct op een foto van de woning."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang=\"nl\">
      <body>{children}</body>
    </html>
  );
}
