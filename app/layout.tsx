import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Macro Oracle Radar',
  description: 'Non-interactive radar for allocation + momentum across risk bands.'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">{children}</div>
      </body>
    </html>
  );
}
