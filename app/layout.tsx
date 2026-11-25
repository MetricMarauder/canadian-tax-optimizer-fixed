import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Canadian Tax Refund Estimator (2025–2026)',
  description: 'Estimator for 2025 and 2026 personal taxes in every province and territory. Not filing software.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <div className="mx-auto max-w-5xl p-6">
          <header className="mb-6">
            <h1 className="text-2xl font-semibold">Canadian Tax Refund Estimator</h1>
            <p className="mt-2 text-sm text-gray-700">
              This is an <span className="font-medium">estimator</span>, not official filing software.
              Results can differ from CRA/Revenu Québec due to missing slips, special rules, credits not yet implemented, and rounding.
            </p>
          </header>
          {children}
          <footer className="mt-10 border-t pt-4 text-xs text-gray-600">
            Supports the 2025 and 2026 tax years for all provinces and territories. Parameters come from CRA, provincial finance ministries and published tax tables; see scripts/generate-config.py. 2026 values marked as estimates will be updated when CRA publishes them.
          </footer>
        </div>
      </body>
    </html>
  );
}
