import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Ontario + Federal Tax Refund Estimator (2025)',
  description: 'Estimator for 2025 personal taxes (Ontario resident). Not filing software.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <div className="mx-auto max-w-5xl p-6">
          <header className="mb-6">
            <h1 className="text-2xl font-semibold">2025 Tax Refund Estimator (Ontario)</h1>
            <p className="mt-2 text-sm text-gray-700">
              This is an <span className="font-medium">estimator</span>, not official filing software.
              Results can differ from CRA/ONT due to missing slips, special rules, credits not yet implemented, and rounding.
            </p>
          </header>
          {children}
          <footer className="mt-10 border-t pt-4 text-xs text-gray-600">
            Built for 2025 tax year. Federal/ON brackets and key amounts are sourced from CRA/Finance Canada; see repo config.
          </footer>
        </div>
      </body>
    </html>
  );
}
