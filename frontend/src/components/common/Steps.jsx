export default function Steps({ screen, hasProject, onUpload, onProjects, onEdit, onExport }) {
  const steps = [
    { id: "upload", label: "업로드", action: onUpload, enabled: true },
    { id: "match-projects", label: "하이라이트 선택", action: onProjects, enabled: true },
    { id: "edit", label: "편집", action: onEdit, enabled: hasProject },
    { id: "preview", label: "렌더·다운로드", action: onExport, enabled: hasProject },
  ];

  return (
    <nav className="steps" aria-label="작업 단계">
      {steps.map(({ id, label, action, enabled }, index) => (
        <button className={`step ${screen === id ? "active" : ""}`} type="button" onClick={action} disabled={!enabled} key={id}>
          <span className="num">{index + 1}</span>
          {label}
        </button>
      ))}
    </nav>
  );
}
