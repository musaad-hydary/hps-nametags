import { useState, useCallback, useRef } from "react";
import jsPDF from "jspdf";

const TEMPLATE_RATIO = 850 / 1322;
const BADGE_W = 4 * 1.07, BADGE_H = BADGE_W * TEMPLATE_RATIO, GRID_COLS = 1; // baked-in 107% scale
const H_MARGIN = (8.5 - BADGE_W) / 2;  // 2.25"
const V_MARGIN = (11 - 3 * BADGE_H) / 2; // ≈ 1.64"
const PER_PAGE = 3;

export default function PrintImages() {
  const [images, setImages] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const addFiles = (files) => {
    const valid = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const next = valid.map((f) => ({ url: URL.createObjectURL(f), name: f.name }));
    setImages((prev) => [...prev, ...next]);
  };

  const removeImage = (i) => {
    setImages((prev) => {
      URL.revokeObjectURL(prev[i].url);
      return prev.filter((_, idx) => idx !== i);
    });
  };

  const clearAll = () => {
    images.forEach((img) => URL.revokeObjectURL(img.url));
    setImages([]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const downloadPDF = useCallback(async () => {
    if (!images.length) return;
    setGenerating(true);
    setProgress(0);
    try {
      const DPI = 200;
      const W = Math.round(BADGE_W * DPI);
      const H = Math.round(BADGE_H * DPI);
      const pdf = new jsPDF({ orientation: "portrait", unit: "in", format: "letter" });
      const totalPages = Math.ceil(images.length / PER_PAGE);
      const total = images.length;
      let rendered = 0;

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) pdf.addPage();
        const start = page * PER_PAGE;
        const end = Math.min(start + PER_PAGE, images.length);

        for (let i = start; i < end; i++) {
          const el = new Image();
          el.src = images[i].url;
          await new Promise((res, rej) => {
            el.onload = res;
            el.onerror = rej;
          });

          const canvas = document.createElement("canvas");
          canvas.width = W;
          canvas.height = H;
          const ctx = canvas.getContext("2d");

          const scale = Math.max(W / el.naturalWidth, H / el.naturalHeight);
          const sw = el.naturalWidth * scale;
          const sh = el.naturalHeight * scale;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, W, H);
          ctx.drawImage(el, (W - sw) / 2, (H - sh) / 2, sw, sh);

          const posIdx = i - start;
          const col = posIdx % GRID_COLS;
          const row = Math.floor(posIdx / GRID_COLS);
          const badgesOnPage = end - start;
          const badgesInRow = Math.min(GRID_COLS, badgesOnPage - row * GRID_COLS);
          const xPos = badgesInRow === 1 ? (8.5 - BADGE_W) / 2 : H_MARGIN + col * BADGE_W;
          pdf.addImage(
            canvas.toDataURL("image/jpeg", 0.92),
            "JPEG",
            xPos,
            V_MARGIN + row * BADGE_H,
            BADGE_W,
            BADGE_H
          );

          rendered++;
          setProgress(Math.round((rendered / total) * 100));
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      const label = totalPages > 1 ? `-${totalPages}pg` : "";
      pdf.save(`badges-${images.length}${label}.pdf`);
    } catch (err) {
      console.error("PDF error:", err);
    } finally {
      setGenerating(false);
      setProgress(0);
    }
  }, [images]);

  const totalPages = Math.ceil(images.length / PER_PAGE);

  return (
    <main>
      <div className="print-images-intro">
        <p>Already have badge images? Upload PNGs or JPGs and get a print-ready PDF.</p>
        <ul>
          <li>3 badges per page, single column</li>
          <li>Letter 8.5″ × 11″ — no adjustments needed</li>
          <li>Great for badges designed externally or exported from another tool</li>
        </ul>
      </div>

      <section className="upload-section">
        <div
          className={`drop-zone${dragging ? " dragging" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/jpg,image/webp"
            style={{ display: "none" }}
            onChange={(e) => addFiles(e.target.files)}
          />
          <div className="drop-icon">⬆</div>
          <p className="drop-title">Drop badge images here</p>
          <p className="drop-sub">or click to browse · PNG, JPG, WebP</p>
        </div>
      </section>

      {images.length > 0 && (
        <>
          <section className="print-section">
            <div className="print-header">
              <p className="section-label">
                {images.length} badge{images.length !== 1 ? "s" : ""}
                {totalPages > 1 && (
                  <span className="page-count-badge">{totalPages} pages</span>
                )}
              </p>
              <button className="btn-clear" onClick={clearAll}>
                Clear all
              </button>
            </div>
            <div className="print-grid">
              {images.map((img, i) => (
                <div key={i} className="print-thumb">
                  <img src={img.url} alt={img.name} className="thumb-img" />
                  <button
                    className="btn-remove-thumb"
                    onClick={() => removeImage(i)}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                  <span className="thumb-num">{i + 1}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="actions">
            <button
              className="btn-download"
              onClick={downloadPDF}
              disabled={generating}
            >
              {generating ? (
                <>
                  <span>Generating PDF… {progress}%</span>
                  <div className="pdf-progress-wrap">
                    <div
                      className="pdf-progress-bar"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </>
              ) : (
                `⬇ Download PDF${totalPages > 1 ? ` — ${totalPages} pages` : ""}`
              )}
            </button>
            <p className="btn-hint">
              Print at 100% · No scaling · 3 per page, single column, letter 8.5″ × 11″
            </p>
          </section>
        </>
      )}
    </main>
  );
}
