import { Legendum, useUser } from "pues/base/auth";
import { Pues } from "pues/base/core";

export default function App() {
  const { user, loading } = useUser();

  return (
    <Pues user={loading ? undefined : user}>
      <main className="app-shell">
        <h1>Loggers</h1>
        {loading ? (
          <p>Loading...</p>
        ) : !user ? (
          <div className="login-block">
            <p>Sign in to manage logger streams.</p>
            <Legendum className="btn" />
          </div>
        ) : (
          <p>Auth wiring is ready. Logger APIs are next in the plan.</p>
        )}
      </main>
    </Pues>
  );
}
