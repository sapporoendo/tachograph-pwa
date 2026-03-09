"use client";

import { useRef, useState, useCallback, useEffect } from "react";

type CaptureState = "idle" | "preview" | "captured";
type DistanceStatus = "too_close" | "ok" | "too_far" | "unknown";

interface DistanceResult {
  status: DistanceStatus;
  ratio: number;
  message: string;
}

function analyzeFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): DistanceResult {
  const W = 320, H = 320;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { status: "unknown", ratio: 0, message: "" };
  ctx.drawImage(video, 0, 0, W, H);

  const cx = W / 2, cy = H / 2;
  const guideR = (145 / 300) * W;
  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;

  // 各radial fractionごとに赤ピクセル数を集計（0.4〜1.0を100分割）
  const BINS = 60;
  const BIN_MIN = 0.4;
  const BIN_MAX = 1.0;
  const redCounts = new Array(BINS).fill(0);
  const binTotals = new Array(BINS).fill(0);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const frac = dist / guideR;
      if (frac < BIN_MIN || frac > BIN_MAX) continue;

      const binIdx = Math.floor((frac - BIN_MIN) / (BIN_MAX - BIN_MIN) * BINS);
      if (binIdx < 0 || binIdx >= BINS) continue;

      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      binTotals[binIdx]++;
      if (r > 140 && g < 110 && b < 110) redCounts[binIdx]++;
    }
  }

  // 赤率が最も高いbinを探す
  let maxRedRatio = 0;
  let maxBinIdx = -1;
  for (let i = 0; i < BINS; i++) {
    if (binTotals[i] < 10) continue;
    const rr = redCounts[i] / binTotals[i];
    if (rr > maxRedRatio) {
      maxRedRatio = rr;
      maxBinIdx = i;
    }
  }

  // チャート未検出
  if (maxRedRatio < 0.02 || maxBinIdx < 0) {
    return { status: "unknown", ratio: 0, message: "チャート紙を枠に合わせてください" };
  }

  // 赤リングの見かけ位置（ガイド円に対する割合）
  const redRingFrac = BIN_MIN + (maxBinIdx + 0.5) / BINS * (BIN_MAX - BIN_MIN);

  // 距離判定：赤リングが0.82〜0.92に来るのがちょうどいい
  if (redRingFrac > 0.92) {
    return { status: "too_close", ratio: redRingFrac, message: "もう少し離して！" };
  }
  if (redRingFrac >= 0.72) {
    return { status: "ok", ratio: redRingFrac, message: "ちょうどいい！撮影できます" };
  }
  return { status: "too_far", ratio: redRingFrac, message: "もう少し近づけて！" };
}

const guideColors: Record<DistanceStatus, { outer: string; mid: string; inner: string }> = {
  ok:        { outer: "rgba(74,222,128,0.95)",  mid: "rgba(74,222,128,0.8)",  inner: "rgba(74,222,128,0.8)"  },
  too_close: { outer: "rgba(248,113,113,0.95)", mid: "rgba(248,113,113,0.8)", inner: "rgba(248,113,113,0.8)" },
  too_far:   { outer: "rgba(250,204,21,0.95)",  mid: "rgba(250,204,21,0.8)",  inner: "rgba(250,204,21,0.8)"  },
  unknown:   { outer: "rgba(255,255,255,0.95)", mid: "rgba(255,80,80,0.9)",   inner: "rgba(96,165,250,0.9)"  },
};

// ===== チュートリアル用SVG（チャート紙イラスト） =====
// viewBox="0 -20 260 280" で12時ラベルが切れない
function ChartSVG({
  showGuideArc = true,
  showRedLines = false,
  showTimeRing = false,
  showOkBadge = false,
  showCenterLabel = false,
  showEdgeArrow = false,
  crossPulse = false,
  arcPulse = false,
}: {
  showGuideArc?: boolean;
  showRedLines?: boolean;
  showTimeRing?: boolean;
  showOkBadge?: boolean;
  showCenterLabel?: boolean;
  showEdgeArrow?: boolean;
  crossPulse?: boolean;
  arcPulse?: boolean;
}) {
  // 切り欠き：下部中央V字
  // ガイド円arc：切り欠き部分(70°〜110°)を除く → M90.7,238.1 A115,115 0 1,1 169.3,238.1
  return (
    <svg
      viewBox="0 -20 260 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: "100%", height: "100%", filter: "drop-shadow(0 8px 24px rgba(0,0,0,0.6))" }}
    >
      {/* チャート紙本体 */}
      <circle cx="130" cy="130" r="115" fill="#f0efe8" stroke="#ddd" strokeWidth="1" />
      {/* 切り欠き（V字、下部中央） */}
      <path d="M107,242 L130,215 L153,242 Q130,252 107,242 Z" fill="#141414" />

      {/* 時刻目盛り（緑） */}
      {showTimeRing && (
        <circle cx="130" cy="130" r="110" stroke="#22c55e" strokeWidth="1" opacity={0.4} strokeDasharray="3,8" />
      )}

      {/* 赤補助線 80/100km/h */}
      {showRedLines && <>
        <circle cx="130" cy="130" r="72" stroke="#e74c3c" strokeWidth="1.5" strokeDasharray="4,4" opacity={0.7} />
        <circle cx="130" cy="130" r="88" stroke="#e74c3c" strokeWidth="1.5" strokeDasharray="4,4" opacity={0.7} />
      </>}

      {/* 中心穴 */}
      <circle cx="130" cy="130" r="18" fill="#141414" />
      <circle cx="130" cy="130" r="15" fill="#e8e6de" />

      {/* 中心十字 */}
      {crossPulse ? (
        <>
          <line x1="118" y1="130" x2="142" y2="130" stroke="white" strokeWidth="2.5"
            style={{ animation: "cross-pulse 1.5s ease-in-out infinite" }} />
          <line x1="130" y1="118" x2="130" y2="142" stroke="white" strokeWidth="2.5"
            style={{ animation: "cross-pulse 1.5s ease-in-out infinite" }} />
        </>
      ) : (
        <>
          <line x1="120" y1="130" x2="140" y2="130" stroke="white" strokeWidth="2.5" />
          <line x1="130" y1="120" x2="130" y2="140" stroke="white" strokeWidth="2.5" />
        </>
      )}

      {/* ガイド円（黄色破線、切り欠き部分で途切れる） */}
      {showGuideArc && (
        <path
          d="M90.7,238.1 A115,115 0 1,1 169.3,238.1"
          stroke="#fbbf24" strokeWidth="2.5"
          strokeDasharray="12,8" fill="none"
          style={{ animation: arcPulse ? "pulse-ring 2s ease-in-out infinite" : "dash-rotate 1.5s linear infinite" }}
          opacity={0.9}
        />
      )}

      {/* 12時マーク（上部） */}
      <line x1="130" y1="28" x2="130" y2="8" stroke="#fbbf24" strokeWidth="3.5" strokeLinecap="round" />
      <rect x="112" y="-16" width="36" height="16" rx="4" fill="#fbbf24" />
      <text x="130" y="-4" textAnchor="middle" fill="#000" fontSize="10" fontWeight="bold" fontFamily="sans-serif">12時</text>

      {/* 外縁矢印ラベル */}
      {showEdgeArrow && <>
        <line x1="55" y1="88" x2="34" y2="68" stroke="#fbbf24" strokeWidth="2" strokeDasharray="3,3" />
        <polygon points="30,64 40,67 32,75" fill="#fbbf24" />
        <rect x="54" y="76" width="88" height="22" rx="6" fill="#fbbf24" />
        <text x="98" y="91" textAnchor="middle" fill="#000" fontSize="11" fontWeight="bold" fontFamily="sans-serif">紙の外縁に合わせる</text>
        {/* NG：緑の印刷線 */}
        <circle cx="130" cy="130" r="110" stroke="#22c55e" strokeWidth="2.5" opacity={0.8} strokeDasharray="3,8" />
        <line x1="200" y1="52" x2="222" y2="34" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3,3" />
        <rect x="148" y="36" width="78" height="22" rx="6" fill="rgba(239,68,68,0.15)" stroke="#ef4444" strokeWidth="1" />
        <text x="187" y="51" textAnchor="middle" fill="#ef4444" fontSize="10" fontFamily="sans-serif">印刷された緑線≠縁</text>
      </>}

      {/* 中心合わせラベル */}
      {showCenterLabel && <>
        <rect x="148" y="118" width="82" height="24" rx="8" fill="#22c55e" />
        <text x="189" y="134" textAnchor="middle" fill="#000" fontSize="11" fontWeight="bold" fontFamily="sans-serif">中心を重ねる</text>
        <line x1="148" y1="130" x2="143" y2="130" stroke="#22c55e" strokeWidth="1.5" />
      </>}

      {/* OKバッジ */}
      {showOkBadge && <>
        <circle cx="130" cy="130" r="40" fill="rgba(34,197,94,0.15)" stroke="#22c55e" strokeWidth="2" />
        <text x="130" y="118" textAnchor="middle" fill="#22c55e" fontSize="22" fontFamily="sans-serif">✅</text>
        <text x="130" y="138" textAnchor="middle" fill="#22c55e" fontSize="11" fontWeight="bold" fontFamily="sans-serif">ちょうど</text>
        <text x="130" y="152" textAnchor="middle" fill="#22c55e" fontSize="11" fontWeight="bold" fontFamily="sans-serif">いい！</text>
      </>}
    </svg>
  );
}

// ===== チュートリアルのステップ定義 =====
const TUTORIAL_STEPS = [
  {
    label: "はじめに",
    title: "撮影ガイドの\n使い方",
    desc: (
      <>
        画面上の<span style={{ color: "#fbbf24", fontWeight: 700 }}>黄色い破線</span>をチャート紙の縁に合わせることで、解析精度が大きく上がります。
        <br /><br />3ステップで確認しましょう。
        <br /><br />
        <span style={{ fontSize: 13, color: "#aaa" }}>
          <span style={{ color: "#fbbf24" }}>- - -</span>　黄色い破線 ＝ 合わせる目標ライン<br />
          <span style={{ color: "#22c55e" }}>───</span>　緑の線 ＝ 印刷された時刻目盛り
        </span>
      </>
    ),
    svg: <ChartSVG showRedLines showTimeRing />,
  },
  {
    label: "ステップ 1 / 3",
    title: "黄色い破線を\n紙の外縁に合わせる",
    desc: (
      <>
        <span style={{ color: "#fbbf24", fontWeight: 700 }}>黄色い破線</span>は
        <span style={{ color: "#f5f5f5", fontWeight: 700 }}>チャート紙の丸い端（物理的な縁）</span>に合わせます。
        <br /><br />
        <span style={{ display: "flex", gap: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "12px 14px", fontSize: 13, color: "#fca5a5" }}>
          ⚠️　印刷されている<strong>緑の時刻目盛り線</strong>は縁より内側です。そこに合わせるのはNGです。
        </span>
      </>
    ),
    svg: <ChartSVG showEdgeArrow />,
  },
  {
    label: "ステップ 2 / 3",
    title: "切り欠きの\n真向かいが12時",
    desc: (
      <>
        チャート紙の下部にある<span style={{ color: "#f5f5f5", fontWeight: 700 }}>切り欠き（スリット）</span>の真反対側が<span style={{ color: "#fbbf24", fontWeight: 700 }}>12時の位置</span>です。
        <br /><br />
        <span style={{ display: "flex", gap: 8, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 12, padding: "12px 14px", fontSize: 13, color: "#fde68a" }}>
          💡　画面上部の<strong>黄色いライン（12時）</strong>を、チャート紙の12時の目盛りに合わせてください。
        </span>
      </>
    ),
    svg: <ChartSVG showRedLines showTimeRing crossPulse={false} />,
  },
  {
    label: "ステップ 3 / 3",
    title: "中心の十字も\n穴に合わせる",
    desc: (
      <>
        <span style={{ color: "#22c55e", fontWeight: 700 }}>白い十字マーク</span>をチャート紙の<span style={{ color: "#f5f5f5", fontWeight: 700 }}>中心の穴</span>に重ねます。
        <br /><br />
        <span style={{ display: "flex", gap: 8, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 12, padding: "12px 14px", fontSize: 13, color: "#86efac" }}>
          💡　「✅ ちょうどいい！撮影できます」と表示されたら準備完了です。
        </span>
      </>
    ),
    svg: <ChartSVG showRedLines crossPulse showCenterLabel arcPulse />,
  },
];

// ===== チュートリアルコンポーネント =====
function Tutorial({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const total = TUTORIAL_STEPS.length;
  const current = TUTORIAL_STEPS[step];
  const isLast = step === total - 1;

  const handleDone = () => {
    localStorage.setItem("tachograph_tutorial_done", "1");
    onDone();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#0a0a0a",
      display: "flex", flexDirection: "column",
      fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
      color: "#f5f5f5",
    }}>
      {/* CSS animations */}
      <style>{`
        @keyframes dash-rotate { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -40; } }
        @keyframes pulse-ring { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        @keyframes cross-pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
        @keyframes fade-up { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      {/* ヘッダー */}
      <div style={{ padding: "24px 24px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {/* ステップドット */}
        <div style={{ display: "flex", gap: 6 }}>
          {TUTORIAL_STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 20 : 6, height: 6,
              borderRadius: i === step ? 3 : "50%",
              background: i < step ? "#16a34a" : i === step ? "#22c55e" : "rgba(255,255,255,0.15)",
              transition: "all 0.3s",
            }} />
          ))}
        </div>
        <button onClick={handleDone} style={{
          fontSize: 13, color: "#888", background: "none", border: "none", cursor: "pointer", padding: "4px 8px",
        }}>スキップ</button>
      </div>

      {/* SVGビジュアル */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 24px" }}>
        <div style={{ width: 240, height: 240 }}>
          {current.svg}
        </div>
      </div>

      {/* テキスト */}
      <div style={{ padding: "0 24px 16px", animation: "fade-up 0.4s ease both" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", color: "#22c55e", marginBottom: 8 }}>
          {current.label.toUpperCase()}
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.3, marginBottom: 12, whiteSpace: "pre-line" }}>
          {current.title}
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.7, color: "#bbb" }}>
          {current.desc}
        </div>
      </div>

      {/* ボタン */}
      <div style={{ padding: "8px 24px 48px" }}>
        <button
          onClick={isLast ? handleDone : () => setStep(s => s + 1)}
          style={{
            width: "100%", padding: "16px",
            background: isLast ? "linear-gradient(135deg, #22c55e, #16a34a)" : "#22c55e",
            color: "#000", fontSize: isLast ? 17 : 16, fontWeight: 700,
            border: "none", borderRadius: 16, cursor: "pointer",
            boxShadow: isLast ? "0 8px 24px rgba(34,197,94,0.35)" : "none",
          }}
        >
          {isLast ? "📷　撮影をはじめる" : "次へ →"}
        </button>
      </div>
    </div>
  );
}

// ===== メインコンポーネント =====
export default function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const prevStatusRef = useRef<DistanceStatus>("unknown");

  const [state, setState] = useState<CaptureState>("idle");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [calibrationData, setCalibrationData] = useState<object | null>(null);
  const [distResult, setDistResult] = useState<DistanceResult>({
    status: "unknown", ratio: 0, message: "カメラを向けてください",
  });
  // チュートリアル：初回のみ表示
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    const done = localStorage.getItem("tachograph_tutorial_done");
    if (!done) setShowTutorial(true);
  }, []);

  const startAnalysisLoop = useCallback(() => {
    const loop = () => {
      const video = videoRef.current;
      const canvas = analysisCanvasRef.current;
      if (video && canvas && video.readyState >= 2) {
        const result = analyzeFrame(video, canvas);
        // ヒステリシス：一度OKになったら緩い条件(30%〜58%)で維持→チラつき防止
        const prev = prevStatusRef.current;
        let finalResult = result;
        if (prev === "ok" && result.ratio >= 0.30 && result.ratio <= 0.58) {
          finalResult = { status: "ok", ratio: result.ratio, message: "ちょうどいい！撮影できます" };
        }
        prevStatusRef.current = finalResult.status;
        setDistResult(finalResult);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const stopAnalysisLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setState("preview");
    } catch (err) {
      console.error(err);
      setError("カメラへのアクセスができませんでした。");
    }
  }, []);

  useEffect(() => {
    if (state === "preview" && videoRef.current && streamRef.current) {
      const v = videoRef.current;
      v.srcObject = streamRef.current;
      v.onloadedmetadata = () => { v.play().then(() => startAnalysisLoop()); };
    }
    return () => {
      if (state !== "preview") stopAnalysisLoop();
    };
  }, [state, startAnalysisLoop, stopAnalysisLoop]);

  const doCapture = useCallback(() => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas) return;
    stopAnalysisLoop();
    const videoW = video.videoWidth || 1280;
    const videoH = video.videoHeight || 720;
    canvas.width = videoW;
    canvas.height = videoH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const videoScale = Math.max(screenW / videoW, screenH / videoH);
    const displaySize = Math.min(0.85 * screenW, 340);
    const guideScreenRadius = (145 / 300) * displaySize;
    const outerRadiusPx = Math.round(guideScreenRadius / videoScale);
    const calibration = {
      center_x: Math.round(videoW / 2),
      center_y: Math.round(videoH / 2),
      outer_radius: outerRadiusPx,
      image_width: videoW,
      image_height: videoH,
      captured_at: new Date().toISOString(),
    };
    // ファイル名にキャリブレーション情報を埋め込む
    const filename = `tacho_cx${calibration.center_x}_cy${calibration.center_y}_r${calibration.outer_radius}.jpg`;
    setCalibrationData({ ...calibration, filename });
    setCapturedImage(dataUrl);
    streamRef.current?.getTracks().forEach((t) => t.stop());

    const history = JSON.parse(localStorage.getItem("tachograph_history") || "[]");
    history.unshift({
      id: Date.now(),
      filename: filename,
      dataUrl: dataUrl,
      calibration: calibration,
      captured_at: calibration.captured_at,
    });
    // 最大20件保持
    if (history.length > 20) history.splice(20);
    localStorage.setItem("tachograph_history", JSON.stringify(history));

    setState("captured");
    setSaved(false);
  }, [stopAnalysisLoop]);

  const retake = useCallback(() => {
    setCapturedImage(null);
    setSaved(false);
    setDistResult({ status: "unknown", ratio: 0, message: "カメラを向けてください" });
    setState("idle");
  }, []);

  // チュートリアル表示中
  if (showTutorial) {
    return <Tutorial onDone={() => setShowTutorial(false)} />;
  }

  const colors = guideColors[distResult.status];
  const isOk = distResult.status === "ok";

  if (state === "idle") {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#0f172a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "24px" }}>
        <p style={{ color: "#94a3b8", fontSize: "14px", textAlign: "center", padding: "0 16px" }}>
          タコグラフのチャート紙をガイド円に合わせて撮影してください
        </p>
        <button onClick={startCamera} style={{ padding: "16px 32px", background: "#2563eb", color: "white", borderRadius: "16px", fontSize: "18px", fontWeight: "bold", border: "none" }}>
          カメラを起動
        </button>
        {/* チュートリアルを再表示するボタン */}
        <button onClick={() => setShowTutorial(true)} style={{ fontSize: 13, color: "#64748b", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
          撮影ガイドの使い方を見る
        </button>
        {error && <p style={{ color: "#f87171", fontSize: "14px", textAlign: "center", padding: "0 16px" }}>{error}</p>}
      </div>
    );
  }

  if (state === "captured" && capturedImage) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#0f172a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px", padding: "16px" }}>
        <img src={capturedImage} alt="撮影画像" style={{ width: "100%", maxWidth: "400px", borderRadius: "12px" }} />
        {calibrationData && (
          <div style={{ background: "#1e293b", borderRadius: "12px", padding: "12px 16px", maxWidth: "400px", width: "100%", fontFamily: "monospace" }}>
            <p style={{ color: "#94a3b8", fontSize: "11px", marginBottom: "6px" }}>calibration.json</p>
            <pre style={{ color: "#86efac", fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>
              {JSON.stringify(calibrationData, null, 2)}
            </pre>
          </div>
        )}
        {saved && (
          <div style={{ background: "#1e293b", borderRadius: "12px", padding: "16px", maxWidth: "400px", width: "100%" }}>
            <p style={{ color: "#86efac", fontSize: "14px", textAlign: "center", marginBottom: "8px" }}>
              📌 上の写真を長押し → 「写真に保存」
            </p>
            <p style={{ color: "#94a3b8", fontSize: "12px", textAlign: "center" }}>
              iOSの制限のため長押し保存が必要です
            </p>
          </div>
        )}
        <div style={{ display: "flex", gap: "12px", width: "100%", maxWidth: "400px" }}>
          <button onClick={() => {
            window.location.href = "/history";
          }} style={{
            flex: 1, padding: "14px",
            background: "#1e40af", color: "white",
            borderRadius: "12px", border: "none", fontSize: "14px"
          }}>
            📋 履歴
          </button>
          <button onClick={retake} style={{ flex: 1, padding: "14px", background: "#334155", color: "white", borderRadius: "12px", border: "none", fontSize: "16px" }}>
            撮り直し
          </button>
          <button onClick={() => {
            const a = document.createElement("a");
            a.href = capturedImage;
            a.download = (calibrationData as any)?.filename ?? "tacho.jpg";
            a.click();
            setSaved(true);
          }} style={{ flex: 1, padding: "14px", background: "#16a34a", color: "white", borderRadius: "12px", border: "none", fontSize: "16px" }}>
            📥 画像を保存
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "black", overflow: "hidden" }}>
      <video
        ref={videoRef}
        playsInline autoPlay muted
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />

      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 10, pointerEvents: "none" }}>
        <div style={{
          marginBottom: "12px", padding: "8px 20px", borderRadius: "999px",
          background: "rgba(0,0,0,0.55)",
          color: isOk ? "#4ade80" : distResult.status === "too_close" ? "#f87171" : distResult.status === "too_far" ? "#facc15" : "white",
          fontSize: "15px", fontWeight: "bold", textShadow: "0 1px 4px black",
          transition: "color 0.3s",
        }}>
          {distResult.status === "too_close" && "⬆️ "}
          {distResult.status === "too_far" && "⬇️ "}
          {isOk && "✅ "}
          {distResult.message}
        </div>

        <div style={{
          position: "relative", width: "85vw", height: "85vw", maxWidth: "340px", maxHeight: "340px",
          filter: isOk ? "drop-shadow(0 0 16px rgba(74,222,128,0.7))" : "none",
          transition: "filter 0.3s",
        }}>
          <svg viewBox="0 0 300 300" style={{ width: "100%", height: "100%", overflow: "visible" }}>
            <circle cx="150" cy="150" r="145" fill="none"
              stroke={colors.outer} strokeWidth="3"
              strokeDasharray={isOk ? "0" : "10 5"} />
            <circle cx="150" cy="150" r="130" fill="none"
              stroke={colors.mid} strokeWidth="2"
              strokeDasharray={isOk ? "0" : "6 4"} />
            <circle cx="150" cy="150" r="106" fill="none"
              stroke={colors.inner} strokeWidth="2"
              strokeDasharray={isOk ? "0" : "5 4"} />
            {/* 中心十字 */}
            <line x1="130" y1="150" x2="170" y2="150" stroke="white" strokeWidth="2" />
            <line x1="150" y1="130" x2="150" y2="170" stroke="white" strokeWidth="2" />
            {/* 12時ライン（上部） */}
            <line x1="150" y1="5" x2="150" y2="155" stroke={colors.outer} strokeWidth="2" opacity={0.6} strokeDasharray="4,4" />
            <line x1="144" y1="5" x2="156" y2="5" stroke={colors.outer} strokeWidth="3" strokeLinecap="round" />
            <text x="150" y="-4" textAnchor="middle" fill={colors.outer} fontSize="11" fontWeight="bold" fontFamily="sans-serif">12時</text>

            {!isOk && <>
              <text x="152" y="6" fill="rgba(255,255,255,0.8)" fontSize="10" fontFamily="sans-serif">チャート紙の縁</text>
              <text x="152" y="21" fill="rgba(255,100,100,0.8)" fontSize="10" fontFamily="sans-serif">120km/h付近</text>
              <text x="152" y="36" fill="rgba(96,165,250,0.8)" fontSize="10" fontFamily="sans-serif">20km/h付近</text>
            </>}
          </svg>
        </div>

        <div style={{ marginTop: "8px", color: "rgba(255,255,255,0.4)", fontSize: "11px" }}>
          赤リング位置: {(distResult.ratio * 100).toFixed(1)}%
        </div>
      </div>

      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20,
        padding: "24px 24px 48px",
        background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
        display: "flex", flexDirection: "column", alignItems: "center",
        opacity: isOk ? 1 : 0,
        pointerEvents: isOk ? "auto" : "none",
        transition: "opacity 0.3s",
      }}>
        <button onClick={doCapture} style={{
          width: "100%", maxWidth: "320px", padding: "18px",
          background: "#16a34a", color: "white",
          borderRadius: "16px", fontSize: "20px", fontWeight: "bold", border: "none",
          boxShadow: "0 4px 24px rgba(22,163,74,0.6)",
        }}>
          📸 撮影する
        </button>
      </div>

      <canvas ref={analysisCanvasRef} style={{ display: "none" }} />
      <canvas ref={captureCanvasRef} style={{ display: "none" }} />
    </div>
  );
}
