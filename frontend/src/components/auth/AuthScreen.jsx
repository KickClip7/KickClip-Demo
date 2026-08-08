import { useState } from "react";
import authBackgroundUrl from "../../assets/auth-gradient.svg";
import emailIconUrl from "../../assets/auth-email-icon.svg";
import lockIconUrl from "../../assets/auth-lock-icon.svg";
import kickclipLogoUrl from "../../assets/kickclip-login-logo.svg";

export default function AuthScreen({ mode, setMode, onLogin, onSignup }) {
  const isLogin = mode === "login";
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await (isLogin ? onLogin(form) : onSignup(form));
      if (!result?.ok) setError(result?.message || "요청을 완료하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode() {
    setError("");
    setMode(isLogin ? "signup" : "login");
  }

  return (
    <main
      className="auth-page"
      style={{ "--auth-background": `url("${authBackgroundUrl}")` }}
      data-node-id="97:25"
      data-mode={mode}
    >
      <div className="auth-brand" aria-label="KickClip">
        <img className="auth-logo" src={kickclipLogoUrl} alt="" />
        <h1>KICKCLIP</h1>
      </div>

      <section className="auth-panel" aria-labelledby="auth-title">
        <h2 className="sr-only" id="auth-title">
          {isLogin ? "KickClip 로그인" : "KickClip 계정 만들기"}
        </h2>
        <form className="auth-form" onSubmit={handleSubmit}>
          {!isLogin && (
            <label className="auth-field">
              <span className="auth-field-icon auth-name-icon" aria-hidden="true" />
              <span className="sr-only">Name</span>
              <input
                type="text"
                autoComplete="name"
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                placeholder="Name"
              />
            </label>
          )}

          <label className="auth-field">
            <img className="auth-field-icon" src={emailIconUrl} alt="" />
            <span className="sr-only">Email ID</span>
            <input
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) => updateField("email", event.target.value)}
              placeholder="Email ID"
              required
            />
          </label>

          <label className="auth-field">
            <img className="auth-field-icon" src={lockIconUrl} alt="" />
            <span className="sr-only">Password</span>
            <input
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              value={form.password}
              onChange={(event) => updateField("password", event.target.value)}
              placeholder="Password"
              required
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? "PLEASE WAIT" : isLogin ? "LOGIN" : "SIGN UP"}
          </button>
        </form>

        <button className="auth-switch" type="button" disabled={submitting} onClick={switchMode}>
          {isLogin ? "creat account" : "LOGIN"}
        </button>
      </section>
    </main>
  );
}
