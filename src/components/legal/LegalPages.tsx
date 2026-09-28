import React from 'react';

const LAST_UPDATED = 'September 28, 2026';
const CONTACT_EMAIL = 'shansen@denetllc.com';

function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-2xl px-4 py-12 space-y-6 text-sm leading-relaxed">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-muted-foreground">Denet Dashboard · Last updated {LAST_UPDATED}</p>
        </header>
        {children}
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Contact</h2>
          <p>
            Questions about this document can be sent to{' '}
            <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </section>
      </main>
    </div>
  );
}

export function Eula() {
  return (
    <LegalPage title="End User License Agreement">
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Who may use the Denet Dashboard</h2>
        <p>
          The Denet Dashboard is an internal tool of Dynamic Network Exchange, LLC. Only
          authorized Dynamic Network Exchange, LLC staff may use it. It is not offered to
          the public or to other companies.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold">What it does</h2>
        <p>
          The dashboard connects to the company's own QuickBooks Online file so that staff
          can post journal entries to it. It does not connect to any other company's
          QuickBooks data.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold">How it may be used</h2>
        <p>
          Staff may use the dashboard only for Dynamic Network Exchange, LLC business and
          must keep their login details to themselves. The company may change or withdraw
          access to the dashboard at any time.
        </p>
      </section>
    </LegalPage>
  );
}

export function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Scope</h2>
        <p>
          The Denet Dashboard is an internal tool used only by Dynamic Network Exchange, LLC
          staff. This policy explains how it handles data from the company's own QuickBooks
          Online file.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold">How QuickBooks data is used</h2>
        <p>
          The dashboard reads from and writes to the company's QuickBooks Online file only to
          post journal entries. QuickBooks data is not used for any other purpose, and it is
          never sold or shared with anyone.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Where data is stored</h2>
        <p>
          QuickBooks data used by the dashboard is stored in the company's Supabase database.
          The OAuth tokens that connect the dashboard to QuickBooks are held on the server and
          are never sent to the browser.
        </p>
      </section>
    </LegalPage>
  );
}
