// Rendered instead of the app when .env has no Supabase keys (fresh clone or
// a Netlify deploy without env vars). A visible checklist beats a cryptic
// runtime crash — the app "fails informatively".
export function SetupPage() {
  return (
    <div className="page setup">
      <h1 className="login__wordmark">SPLITLY</h1>
      <p className="muted setup__intro">
        Almost there — the app just needs a Supabase project behind it. One-time
        setup, about five minutes:
      </p>

      <ol className="card setup__steps">
        <li>
          Create a free project at <strong>supabase.com</strong> (any name/region).
        </li>
        <li>
          In the dashboard, open <strong>SQL Editor</strong>, paste the contents of{' '}
          <code>supabase/schema.sql</code> from this repo, and click <strong>Run</strong>.
        </li>
        <li>
          Go to <strong>Authentication → Sign In / Providers → Email</strong> and turn{' '}
          <strong>off</strong> “Confirm email”. (Logins here use usernames mapped to
          synthetic addresses, so confirmation mail can never arrive.)
        </li>
        <li>
          Open <strong>Project Settings → API</strong>, copy the <strong>Project URL</strong>{' '}
          and the <strong>anon public</strong> key.
        </li>
        <li>
          In this repo: copy <code>.env.example</code> to <code>.env</code>, paste both
          values in, and restart <code>npm run dev</code>. For Netlify, add the same two
          variables under <strong>Site settings → Environment variables</strong> and
          redeploy.
        </li>
      </ol>
    </div>
  );
}
