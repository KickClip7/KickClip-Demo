import { useEffect, useRef, useState } from "react";

export default function UserMenu({ user, onOpenProjects, onLogout }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function closeMenu(event) {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    }

    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  return (
    <div className="user-menu" ref={menuRef}>
      <button className="user-chip" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <svg className="profile-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M0 0h24v24H0z" fill="none" />
          <path
            fill="currentColor"
            fillRule="evenodd"
            d="M12 4a8 8 0 0 0-6.96 11.947A4.99 4.99 0 0 1 9 14h6a4.99 4.99 0 0 1 3.96 1.947A8 8 0 0 0 12 4m7.943 14.076q.188-.245.36-.502A9.96 9.96 0 0 0 22 12c0-5.523-4.477-10-10-10S2 6.477 2 12a9.96 9.96 0 0 0 2.057 6.076l-.005.018l.355.413A9.98 9.98 0 0 0 12 22q.324 0 .644-.02a9.95 9.95 0 0 0 5.031-1.745a10 10 0 0 0 1.918-1.728l.355-.413zM12 6a3 3 0 1 0 0 6a3 3 0 0 0 0-6"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div className="user-dropdown" role="menu">
          <div className="user-dropdown-head">
            <strong>{user?.name || "KickClip User"}</strong>
            <span>{user?.email}</span>
          </div>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onOpenProjects(); }}>내 작업</button>
          <button className="danger" type="button" role="menuitem" onClick={() => { setOpen(false); onLogout(); }}>로그아웃</button>
        </div>
      )}
    </div>
  );
}
