import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Portable G and Claw of Shiva',
  description: 'First-principles tools for understanding capital, risk, and reality — by Portable G and Shiva.'
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
