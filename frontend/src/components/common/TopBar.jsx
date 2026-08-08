import logoLightUrl from "../../assets/logo-light.svg";
import logoDarkUrl from "../../assets/logo-dark.svg";
import projectsLogoUrl from "../../assets/kickclip-projects-logo.svg";
import UserMenu from "./UserMenu.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

export default function TopBar({ user, onHome, onOpenProjects, onLogout, theme, setTheme, variant = "default" }) {
  const isProjects = variant === "projects";

  return (
    <header className={`topbar ${isProjects ? "projects-topbar" : ""}`}>
      <button className="brand-lockup" type="button" aria-label="초기 화면으로 이동" onClick={onHome}>
        {isProjects ? (
          <>
            <img className="projects-brand-logo" src={projectsLogoUrl} alt="KickClip" />
            <span className="sr-only">KickClip</span>
          </>
        ) : (
          <>
            <img className="brand-logo logo-light" src={logoLightUrl} alt="KickClip" />
            <img className="brand-logo logo-dark" src={logoDarkUrl} alt="KickClip" />
            <span>KickClip</span>
          </>
        )}
      </button>
      <div className="topbar-actions">
        {!isProjects ? <ThemeToggle theme={theme} setTheme={setTheme} /> : null}
        <UserMenu user={user} onOpenProjects={onOpenProjects} onLogout={onLogout} />
      </div>
    </header>
  );
}
