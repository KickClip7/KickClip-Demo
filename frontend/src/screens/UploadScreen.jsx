import { useRef, useState } from "react";

const ACCEPTED_EXTENSIONS = /\.(mp4|mov|webm|m4v)$/i;
const ACCEPTED_MIME_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]);

function initialMatchForm() {
  return {
    home_team: "",
    away_team: "",
    home_score: "",
    away_score: "",
    match_date: "",
    competition: "",
    season: "",
  };
}

function previewStatusCopy(result) {
  if (result.preview_status === "PREVIEW_READY") return "브라우저용 preview가 준비되었습니다.";
  if (result.preview_status === "PREVIEW_FAILED_RAW_ONLY") return "preview 생성에 실패해 원본 영상만 사용합니다.";
  return result.is_browser_playable
    ? "원본 영상을 브라우저에서 바로 재생할 수 있습니다."
    : result.browser_playability_reason || "브라우저 호환 영상을 준비 중입니다.";
}

function probeDuration(file, source) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const finish = (value) => {
      video.removeAttribute("src");
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), 5000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    video.src = source;
  });
}

export default function UploadScreen({ active, onUpload }) {
  const [form, setForm] = useState(initialMatchForm);
  const [file, setFile] = useState(null);
  const [source, setSource] = useState("");
  const [durationSec, setDurationSec] = useState(null);
  const [metadataWarning, setMetadataWarning] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState(null);
  const fileInputRef = useRef(null);

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function chooseFile(nextFile) {
    if (!nextFile) return;
    setUploadError("");
    setUploadResult(null);
    if (!nextFile.name?.trim()) {
      setUploadError("파일 이름이 없는 영상은 업로드할 수 없습니다.");
      return;
    }
    if (!ACCEPTED_MIME_TYPES.has(nextFile.type) && !ACCEPTED_EXTENSIONS.test(nextFile.name)) {
      setUploadError("MP4, MOV, WebM 형식의 영상 파일을 선택해주세요.");
      return;
    }
    if (nextFile.size <= 0) {
      setUploadError("비어 있는 영상 파일은 업로드할 수 없습니다.");
      return;
    }

    if (source) URL.revokeObjectURL(source);
    const nextSource = URL.createObjectURL(nextFile);
    setFile(nextFile);
    setSource(nextSource);
    setDurationSec(null);
    setMetadataWarning("");
    const probedDuration = await probeDuration(nextFile, nextSource);
    setDurationSec(probedDuration);
    if (probedDuration == null) {
      setMetadataWarning("브라우저에서 영상 길이를 읽지 못했습니다. 백엔드가 업로드 후 metadata를 추출합니다.");
    }
  }

  async function submitUpload() {
    if (!file || uploading) return;
    setUploading(true);
    setUploadError("");
    setUploadProgress(0);
    const metadata = {
      ...form,
      home_score: form.home_score === "" ? undefined : Number(form.home_score),
      away_score: form.away_score === "" ? undefined : Number(form.away_score),
      match_date: form.match_date ? new Date(form.match_date).toISOString() : undefined,
      duration_sec: durationSec == null ? undefined : Math.round(durationSec),
    };
    const outcome = await onUpload({ file, source, metadata, onProgress: setUploadProgress });
    if (outcome?.ok) {
      setUploadResult(outcome.result);
    } else {
      setUploadError(outcome?.error?.detail || outcome?.error?.message || "네트워크 오류로 업로드를 완료하지 못했습니다.");
    }
    setUploading(false);
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    if (uploading) return;
    chooseFile(event.dataTransfer.files?.[0]);
  }

  return (
    <section className={`screen upload-screen ${active ? "active" : ""}`} id="upload">
      <div className="upload-shell">
        <div className="upload-intro">
          <p className="agent-label mini"><span></span> CREATE MATCH</p>
          <h2>하이라이트를 만들고 싶은 영상을 업로드하세요</h2>
        </div>

        <div className="upload-workspace-grid">
          <div className="upload-media-column">
            <div
              className={`upload-zone ${dragging ? "dragging" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => !uploading && fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === " ") && !uploading) fileInputRef.current?.click();
              }}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                id="video-upload"
                type="file"
                accept="video/mp4,video/quicktime,video/webm,.m4v"
                disabled={uploading}
                onChange={(event) => chooseFile(event.target.files?.[0])}
              />
              <span className="upload-icon" aria-hidden="true">↑</span>
              <span className="upload-kicker">Video file</span>
              <h3>{file?.name || "파일을 선택하거나 여기에 놓으세요"}</h3>
              <p>{file ? `${Math.max(1, Math.round(file.size / 1024 / 1024))}MB${durationSec ? ` · ${Math.round(durationSec)}초` : ""}` : "MP4, MOV, WebM 지원"}</p>
              {uploading ? (
                <div className="upload-progress" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
                  <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }}></div>
                  <span className="upload-progress-label">{uploadProgress}% · 큰 영상은 업로드에 시간이 걸릴 수 있습니다.</span>
                </div>
              ) : null}
              <span className="button primary">{uploading ? "업로드 중" : file ? "다른 영상 선택" : "파일 선택"}</span>
            </div>

            {metadataWarning ? <div className="upload-result warning" role="status">{metadataWarning}</div> : null}
          </div>

          <section className="match-form-card" aria-labelledby="match-info-heading">
            <div className="match-form-heading">
              <div><span>Optional</span><h3 id="match-info-heading">경기 정보</h3></div>
              <p>나중에 경기 영상을 찾기 쉽도록 입력해두세요.</p>
            </div>
            <div className="match-form-grid">
              <label><span>홈팀</span><input name="home_team" value={form.home_team} onChange={updateField} placeholder="대한민국" disabled={uploading} /></label>
              <label><span>원정팀</span><input name="away_team" value={form.away_team} onChange={updateField} placeholder="일본" disabled={uploading} /></label>
              <label><span>홈 스코어</span><input name="home_score" type="number" min="0" value={form.home_score} onChange={updateField} disabled={uploading} /></label>
              <label><span>원정 스코어</span><input name="away_score" type="number" min="0" value={form.away_score} onChange={updateField} disabled={uploading} /></label>
              <label><span>경기 일시</span><input name="match_date" type="datetime-local" value={form.match_date} onChange={updateField} disabled={uploading} /></label>
              <label><span>대회</span><input name="competition" value={form.competition} onChange={updateField} placeholder="AFC Asian Cup" disabled={uploading} /></label>
              <label><span>시즌</span><input name="season" value={form.season} onChange={updateField} placeholder="2026" disabled={uploading} /></label>
            </div>
          </section>
        </div>

        {uploadError ? <div className="upload-result error" role="alert">{uploadError}</div> : null}
        {uploadResult ? (
          <div className={`upload-result ${uploadResult.preview_status === "PREVIEW_FAILED_RAW_ONLY" ? "warning" : "success"}`} role="status">
            <strong>Match 생성 완료 · {uploadResult.match_id}</strong>
            <p>{previewStatusCopy(uploadResult)}</p>
          </div>
        ) : null}
        <div className="upload-submit-row">
          <button className="button primary" type="button" disabled={!file || uploading} onClick={submitUpload}>
            {uploading ? "영상 분석 준비 중…" : "영상 분석 시작하기"}
          </button>
        </div>
      </div>
    </section>
  );
}
