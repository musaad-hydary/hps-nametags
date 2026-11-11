import {
  useState,
  useRef,
  useLayoutEffect,
  useCallback,
  useEffect,
} from "react";
import jsPDF from "jspdf";
import templateImg from "./assets/nametag-template.png";
import lanyardImg from "./assets/lanyard.jpg";
import paperImg from "./assets/paper.jpg";
import PrintImages from "./PrintImages";
import "./App.css";

// Template is 1322×850 — derive badge height from its natural ratio so nothing is squished
const TEMPLATE_RATIO = 850 / 1322;
const BADGE_W = 4 * 1.07; // baked-in 107% scale
const BADGE_H = BADGE_W * TEMPLATE_RATIO; // ≈ 2.75"
const GRID_COLS = 1;
const GRID_ROWS = 3;
const H_MARGIN = (8.5 - BADGE_W) / 2; // 2.25"
const V_MARGIN = (11 - GRID_ROWS * BADGE_H) / 2; // ≈ 1.64"
const HEADER_FRAC = 0.182;

const SUPPLIES = [
  {
    name: "Lanyards with badge holders",
    img: lanyardImg,
    url: "https://www.amazon.ca/Lanyard-Include-Plastic-Horizontal-Lanyards/dp/B0BWX5JVX5/",
  },
  {
    name: "Glossy photo paper (letter)",
    img: paperImg,
    url: "https://www.amazon.ca/dp/B0742C9BCP",
  },
];

function LayoutPreview({ count }) {
  // Preview SVG sized to match template ratio
  const PW = 68,
    PH = 88;
  const BW = Math.round(PW * (BADGE_W / 8.5)); // scale to match actual badge width
  const BH = BW * TEMPLATE_RATIO;
  const hm = (PW - GRID_COLS * BW) / 2;
  const vm = (PH - GRID_ROWS * BH) / 2;
  return (
    <svg width={PW} height={PH} viewBox={`0 0 ${PW} ${PH}`} aria-hidden="true">
      <rect
        width={PW}
        height={PH}
        rx="2"
        fill="#fff"
        stroke="#d4d0cc"
        strokeWidth="0.8"
      />
      {Array.from({ length: 3 }, (_, i) => {
        const col = i % GRID_COLS;
        const row = Math.floor(i / GRID_COLS);
        return (
          <rect
            key={i}
            x={hm + col * BW + 0.5}
            y={vm + row * BH + 0.5}
            width={BW - 1}
            height={BH - 1}
            rx="1"
            fill={i < count ? "#ad343e" : "#f0eeec"}
            stroke={i < count ? "#85282f" : "#dedad6"}
            strokeWidth="0.5"
          />
        );
      })}
    </svg>
  );
}

function ConfirmModal({ count, onConfirm, onCancel }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3 className="modal-title">
          {count === 1 ? "Delete this badge?" : `Delete ${count} badges?`}
        </h3>
        <p className="modal-sub">This can't be undone.</p>
        <div className="modal-btns">
          <button className="btn-modal-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-modal-delete" onClick={onConfirm} autoFocus>
            Delete{count > 1 ? ` ${count}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

function calcFontSize(name, containerPx) {
  if (!name) return 64;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const maxW = containerPx * 0.82;
  let size = Math.round(containerPx * 0.24);
  while (size > 12) {
    ctx.font = `700 ${size}px "Dancing Script", cursive`;
    if (ctx.measureText(name).width <= maxW) break;
    size--;
  }
  return size;
}

export default function App() {
  const [page, setPage] = useState("nametags");
  const perPage = 3;
  const [names, setNames] = useState([""]);
  const [fontSizes, setFontSizes] = useState(Array(6).fill(64));
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [greyscale, setGreyscale] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [pendingDelete, setPendingDelete] = useState(null);
  const slotRefs = useRef([]);

  useLayoutEffect(() => {
    document.fonts.ready.then(() => {
      setFontSizes(
        names.map((name, i) => {
          const el = slotRefs.current[i];
          if (!el) return 64;
          return calcFontSize(name, el.clientWidth);
        }),
      );
    });
  }, [names]);

  const handleNameChange = (i, value) => {
    setNames((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  };

  const addSlot = () => setNames((prev) => [...prev, ""]);

  const toggleSelect = (i) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const requestDelete = (indices) => setPendingDelete(indices);

  const confirmDeleteSlots = () => {
    const toDelete = new Set(pendingDelete);
    setNames((prev) => prev.filter((_, i) => !toDelete.has(i)));
    setFontSizes((prev) => prev.filter((_, i) => !toDelete.has(i)));
    setSelected(new Set());
    setSelectMode(false);
    setPendingDelete(null);
  };

  const downloadPDF = useCallback(async () => {
    setGenerating(true);
    setProgress(0);
    try {
      // Single badge gets full page width; multiple use configured grid
      const isSingle = names.length === 1;
      const bW = isSingle ? 8.0 : BADGE_W;
      const bH = bW * TEMPLATE_RATIO;
      const gCols = isSingle ? 1 : GRID_COLS;
      const gRows = isSingle ? 1 : GRID_ROWS;
      const hm = (8.5 - gCols * bW) / 2;
      const vm = (11 - gRows * bH) / 2;

      // 200 DPI is plenty for badge printing and encodes ~3× faster
      const DPI = 200;
      const W = Math.round(bW * DPI);
      const H = Math.round(bH * DPI);
      const contentMidY = H * HEADER_FRAC + (H - H * HEADER_FRAC) / 2;
      const maxW = W * 0.82;

      await document.fonts.load(`bold 100px "Dancing Script"`);

      const templateImage = new Image();
      templateImage.src = templateImg;
      await new Promise((res, rej) => {
        templateImage.onload = res;
        templateImage.onerror = rej;
      });

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "in",
        format: "letter",
      });
      const perPg = isSingle ? 1 : perPage;
      const totalPages = Math.ceil(names.length / perPg);
      const totalBadges = names.length;
      let rendered = 0;

      for (let pg = 0; pg < totalPages; pg++) {
        if (pg > 0) pdf.addPage();
        const start = pg * perPg;
        const end = Math.min(start + perPg, names.length);

        for (let i = start; i < end; i++) {
          const name = names[i] || "";
          const canvas = document.createElement("canvas");
          canvas.width = W;
          canvas.height = H;
          const ctx = canvas.getContext("2d");

          if (greyscale) ctx.filter = "grayscale(100%)";
          ctx.drawImage(templateImage, 0, 0, W, H);

          if (name) {
            if (!greyscale) ctx.filter = "none";
            let fs = Math.round(W * 0.24);
            while (fs > 16) {
              ctx.font = `bold ${fs}px "Dancing Script", cursive`;
              if (ctx.measureText(name).width <= maxW) break;
              fs -= 2;
            }
            ctx.font = `bold ${fs}px "Dancing Script", cursive`;
            ctx.fillStyle = "#111111";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(name, W / 2, contentMidY);
          }
          ctx.filter = "none";

          const posIdx = i - start;
          const col = posIdx % gCols;
          const row = Math.floor(posIdx / gCols);
          const badgesOnPage = end - start;
          const badgesInRow = Math.min(gCols, badgesOnPage - row * gCols);
          const xPos = badgesInRow === 1 ? (8.5 - bW) / 2 : hm + col * bW;
          // JPEG encodes much faster than PNG
          pdf.addImage(
            canvas.toDataURL("image/jpeg", 0.92),
            "JPEG",
            xPos,
            vm + row * bH,
            bW,
            bH,
          );

          rendered++;
          setProgress(Math.round((rendered / totalBadges) * 100));
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      const pageLabel = totalPages > 1 ? `-${totalPages}pg` : "";
      const modeLabel = greyscale ? "-grey" : "";
      pdf.save(`hps-nametags${modeLabel}${pageLabel}.pdf`);
    } catch (err) {
      console.error("PDF error:", err);
    } finally {
      setGenerating(false);
      setProgress(0);
    }
  }, [names, greyscale, perPage]);

  const totalPages = Math.ceil(names.length / perPage);
  const hasAnyName = names.some((n) => n.trim());

  return (
    <div className="app">
      {pendingDelete && (
        <ConfirmModal
          count={pendingDelete.length}
          onConfirm={confirmDeleteSlots}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      <header className="site-header">
        <div className="site-header-top">
          <h1>HPS Nametag Maker</h1>
          <p>High Park Speakers · Toastmasters International</p>
        </div>
        <nav className="site-nav">
          <button
            className={`nav-link${page === "nametags" ? " active" : ""}`}
            onClick={() => setPage("nametags")}
          >
            Create Nametags
          </button>
          <button
            className={`nav-link${page === "print" ? " active" : ""}`}
            onClick={() => setPage("print")}
          >
            Print Images
          </button>
        </nav>
      </header>

      {page === "print" ? (
        <PrintImages />
      ) : (
        <main>
          {/* Info cards */}
          <section className="info-section">
            <div className="info-card">
              <h2>Print Instructions</h2>
              <ol>
                <li>Download the PDF below</li>
                <li>Open in Preview, Reader, or Chrome</li>
                <li>
                  Print at <b>100%</b> — Actual Size
                </li>
                {greyscale ? (
                  <>
                    <li>
                      Select <b>Black &amp; White</b>
                    </li>
                    <li>Regular paper is fine</li>
                  </>
                ) : (
                  <>
                    <li>
                      Select <b>Color</b> printing
                    </li>
                    <li>
                      Load <b>glossy paper</b> in printer tray
                    </li>
                  </>
                )}
                <li>
                  Paper: <b>Letter 8.5″ × 11″</b>
                </li>
                <li>Cut and insert into badge holder</li>
              </ol>
              <p className="print-note">
                NOTE: Colors print slightly darker/more burgundy than on screen.
              </p>
            </div>

            <div className="info-card">
              <h2>Out of Supplies?</h2>
              <ul className="supply-list">
                {SUPPLIES.map((s) => (
                  <li key={s.url} className="supply-item">
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      <img className="supply-img" src={s.img} alt={s.name} />
                      <span className="supply-info">
                        <span className="supply-name">{s.name}</span>
                        <span className="supply-cta">Buy on Amazon.ca →</span>
                      </span>
                    </a>
                  </li>
                ))}
                <li className="supply-ink-note">
                  🖨️ <b>Printer ink</b> — make sure you have enough color and
                  B&amp;W ink.
                </li>
              </ul>
            </div>
          </section>

          {/* Badge name slots */}
          <section className="slots-section">
            <div className="slots-header">
              <p className="section-label">
                Enter names
                {totalPages > 1 && (
                  <span className="page-count-badge">{totalPages} pages</span>
                )}
              </p>
              <button
                className={`btn-select-toggle${selectMode ? " active" : ""}`}
                onClick={
                  selectMode ? exitSelectMode : () => setSelectMode(true)
                }
              >
                {selectMode ? "Cancel" : "Select"}
              </button>
            </div>

            <div
              className={`slots-grid${names.length === 1 ? " slots-grid-single" : ""}`}
            >
              {names.map((name, i) => {
                const pageNum = Math.floor(i / perPage) + 1;
                const isFirstOnPage = i % perPage === 0 && totalPages > 1;
                const isSelected = selected.has(i);
                return (
                  <div key={i} className="slot-outer">
                    {isFirstOnPage && (
                      <div className="page-divider">Page {pageNum}</div>
                    )}
                    <div
                      className={`badge-slot${isSelected ? " selected" : ""}`}
                    >
                      <div
                        className="nametag-wrapper"
                        ref={(el) => (slotRefs.current[i] = el)}
                        onClick={selectMode ? () => toggleSelect(i) : undefined}
                        style={selectMode ? { cursor: "pointer" } : undefined}
                      >
                        {selectMode && (
                          <div className="slot-checkbox">
                            <div
                              className={`checkbox-icon${isSelected ? " checked" : ""}`}
                            >
                              {isSelected && "✓"}
                            </div>
                          </div>
                        )}
                        <div
                          className={`nametag${greyscale ? " nametag-grey" : ""}`}
                        >
                          <img
                            src={templateImg}
                            alt=""
                            className="nametag-bg"
                          />
                          {name && (
                            <div className="name-overlay">
                              <span
                                className="name-text"
                                style={{ fontSize: `${fontSizes[i]}px` }}
                              >
                                {name}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="slot-input-row">
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => handleNameChange(i, e.target.value)}
                          placeholder={`Badge ${i + 1} — e.g. Conan G.`}
                          maxLength={15}
                          autoComplete="off"
                          spellCheck={false}
                          autoFocus={i === 0}
                          disabled={selectMode}
                          readOnly={selectMode}
                        />
                        {!selectMode && (
                          <button
                            className="btn-remove"
                            onClick={() => requestDelete([i])}
                            aria-label="Remove badge"
                            title="Remove"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {selectMode ? (
              <button
                className="btn-delete-selected"
                disabled={selected.size === 0}
                onClick={() => requestDelete([...selected])}
              >
                Delete {selected.size > 0 ? selected.size : ""} selected
              </button>
            ) : (
              <button className="btn-add" onClick={addSlot}>
                + Add badge
              </button>
            )}
          </section>

          {/* Per-page layout guide */}
          <section className="settings-section">
            <p className="section-label">Badges per page</p>
            <div className="count-grid">
              {[1, 2, 3].map((n) => (
                <div key={n} className="count-btn">
                  <LayoutPreview count={n} />
                  <span className="count-num">{n}</span>
                  {n === 3 && <span className="count-rec">recommended</span>}
                </div>
              ))}
            </div>
          </section>

          {/* Download */}
          <section className="actions">
            <label className="greyscale-toggle">
              <input
                type="checkbox"
                checked={greyscale}
                onChange={(e) => setGreyscale(e.target.checked)}
              />
              <span className="greyscale-toggle-label">Greyscale mode</span>
              <span className="greyscale-toggle-note">
                for guests · regular paper OK
              </span>
            </label>

            <button
              className="btn-download"
              onClick={downloadPDF}
              disabled={!hasAnyName || generating}
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
              Print at 100% · No scaling · Letter 8.5″ × 11″
            </p>
          </section>
        </main>
      )}

      <footer className="site-footer">
        High Park Speakers · Toastmasters International
      </footer>
    </div>
  );
}
