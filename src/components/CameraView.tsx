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
  const W = 320;
  const H = 320;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { status: "unknown", ratio: 0, message: "" };

  ctx.drawImage(video, 0, 0, W, H);

  const cx = W / 2;
  const cy = H / 2;
  const guideR = (145 / 300) * W;

  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;

  let totalPixels = 0;
  let whitePixels = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > guideR * guideR) continue;

      totalPixels++;
      const idx = (y * W + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      if (r > 180 && g > 180 && b > 180) {
        whitePixels++;
      }
    }
  }

  const ratio = totalPixels > 0 ? whitePixels / totalPixels : 0;

  let status: DistanceStatus;
  let message: string;

  if (ratio > 0.55) {
    status = "too_close";
    message = "もう少し離して！";
  } else if (ratio >= 0.35) {
    status = "ok";
    message = "ちょうどいい！撮影できます";
  } else {
    status = "too_far";
    message = "もう少し近づけて！";
  }

  return { status, ratio, message };
}

const guideColors: Record<DistanceStatus, { outer: string; mid: string; inner: string }> = {
  ok:        { outer: "rgba(74,222,128,0.95)",  mid: "rgba(74,222,128,0.8)",  inner: "rgba(74,222,128,0.8)"  },
  too_close: { outer: "rgba(248,113,113,0.95)", mid: "rgba(248,113,113,0.8)", inner: "rgba(248,113,113,0.8)" },
  too_far:   { outer: "rgba(250,204,21,0.95)",  mid: "rgba(250,204,21,0.8)",  inner: "rgba(250,204,21,0.8)"  },
  unknown:   { outer: "rgba(255,255,255,0.95)", mid: "rgba(255,80,80,0.9)",   inner: "rgba(96,165,250,0.9)"  },
};

export default function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [state, setState] = useState<CaptureState>("idle");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [distResult, setDistResult] = useState<DistanceResult>({
    status: "unknown", ratio: 0, message: "カメラを向けてください",
  });

  const startAnalysisLoop = useCallback(() => {
    const loop = () => {
      const video = videoRef.current;
      const canvas = analysisCanvasRef.current;
      if (video && canvas && video.readyState >= 2) {
        const result = analyzeFrame(video, canvas);
        setDistResult(result);
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
        video: { facingMode: "environment" },
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
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().then(() => {
        startAnalysisLoop();
      }).catch(console.error);
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
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    setCapturedImage(dataUrl);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setState("captured");
    setSaved(false);
  }, [stopAnalysisLoop]);

  const retake = useCallback(() => {
    setCapturedImage(null);
    setSaved(false);
    setDistResult({ status: "unknown", ratio: 0, message: "カメラを向けてください" });
    setState("idle");
  }, []);

  const colors = guideColors[distResult.status];
  const isOk = distResult.status === "ok";

  if (state === "idle") {
    return (
      <div style={{ position:"fixed", inset:0, background:"#0f172a", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"24px" }}>
        <p style={{ color:"#94a3b8", fontSize:"14px", textAlign:"center", padding:"0 16px" }}>
          タコグラフのチャート紙をガイド円に合わせて撮影してください
        </p>
        <button onClick={startCamera} style={{ padding:"16px 32px", background:"#2563eb", color:"white", borderRadius:"16px", fontSize:"18px", fontWeight:"bold", border:"none" }}>
          カメラを起動
        </button>
        {error && <p style={{ color:"#f87171", fontSize:"14px", textAlign:"center", padding:"0 16px" }}>{error}</p>}
      </div>
    );
  }

  if (state === "captured" && capturedImage) {
    return (
      <div style={{ position:"fixed", inset:0, background:"#0f172a", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"16px", padding:"16px" }}>
        <img src={capturedImage} alt="撮影画像" style={{ width:"100%", maxWidth:"400px", borderRadius:"12px" }} />
        {saved && (
          <div style={{ background:"#1e293b", borderRadius:"12px", padding:"16px", maxWidth:"400px", width:"100%" }}>
            <p style={{ color:"#86efac", fontSize:"14px", textAlign:"center", marginBottom:"8px" }}>
              📌 上の写真を長押し → 「写真に保存」
            </p>
            <p style={{ color:"#94a3b8", fontSize:"12px", textAlign:"center" }}>
              iOSの制限のため長押し保存が必要です
            </p>
          </div>
        )}
        <div style={{ display:"flex", gap:"12px", width:"100%", maxWidth:"400px" }}>
          <button onClick={retake} style={{ flex:1, padding:"14px", background:"#334155", color:"white", borderRadius:"12px", border:"none", fontSize:"16px" }}>
            撮り直し
          </button>
          <button onClick={() => setSaved(true)} style={{ flex:1, padding:"14px", background:"#16a34a", color:"white", borderRadius:"12px", border:"none", fontSize:"16px" }}>
            📷 写真に保存
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"black", overflow:"hidden" }}>
      <video
        ref={videoRef}
        playsInline autoPlay muted
        style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }}
      />

      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", zIndex:10, pointerEvents:"none" }}>
        <div style={{
          marginBottom:"12px", padding:"8px 20px", borderRadius:"999px",
          background:"rgba(0,0,0,0.55)",
          color: isOk ? "#4ade80" : distResult.status === "too_close" ? "#f87171" : distResult.status === "too_far" ? "#facc15" : "white",
          fontSize:"15px", fontWeight:"bold", textShadow:"0 1px 4px black",
          transition:"color 0.3s",
        }}>
          {distResult.status === "too_close" && "⬆️ "}
          {distResult.status === "too_far"   && "⬇️ "}
          {isOk                              && "✅ "}
          {distResult.message}
        </div>

        <div style={{
          position:"relative", width:"85vw", height:"85vw", maxWidth:"340px", maxHeight:"340px",
          filter: isOk ? "drop-shadow(0 0 16px rgba(74,222,128,0.7))" : "none",
          transition:"filter 0.3s",
        }}>
          <svg viewBox="0 0 300 300" style={{ width:"100%", height:"100%", overflow:"visible" }}>
            <circle cx="150" cy="150" r="145" fill="none"
              stroke={colors.outer} strokeWidth="3"
              strokeDasharray={isOk ? "0" : "10 5"} />
            <circle cx="150" cy="150" r="130" fill="none"
              stroke={colors.mid} strokeWidth="2"
              strokeDasharray={isOk ? "0" : "6 4"} />
            <circle cx="150" cy="150" r="106" fill="none"
              stroke={colors.inner} strokeWidth="2"
              strokeDasharray={isOk ? "0" : "5 4"} />
            <line x1="130" y1="150" x2="170" y2="150" stroke="white" strokeWidth="2" />
            <line x1="150" y1="130" x2="150" y2="170" stroke="white" strokeWidth="2" />
            {!isOk && <>
              <text x="152" y="6"  fill="rgba(255,255,255,0.8)" fontSize="10" fontFamily="sans-serif">チャート紙の縁</text>
              <text x="152" y="21" fill="rgba(255,100,100,0.8)" fontSize="10" fontFamily="sans-serif">120km/h付近</text>
              <text x="152" y="36" fill="rgba(96,165,250,0.8)"  fontSize="10" fontFamily="sans-serif">20km/h付近</text>
            </>}
          </svg>
        </div>

        <div style={{ marginTop:"8px", color:"rgba(255,255,255,0.4)", fontSize:"11px" }}>
          白色率: {(distResult.ratio * 100).toFixed(1)}%
        </div>
      </div>

      <div style={{
        position:"absolute", bottom:0, left:0, right:0, zIndex:20,
        padding:"24px 24px 48px",
        background:"linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
        display:"flex", flexDirection:"column", alignItems:"center",
        opacity: isOk ? 1 : 0,
        pointerEvents: isOk ? "auto" : "none",
        transition:"opacity 0.3s",
      }}>
        <button onClick={doCapture} style={{
          width:"100%", maxWidth:"320px", padding:"18px",
          background:"#16a34a", color:"white",
          borderRadius:"16px", fontSize:"20px", fontWeight:"bold", border:"none",
          boxShadow:"0 4px 24px rgba(22,163,74,0.6)",
        }}>
          📸 撮影する
        </button>
      </div>

      <canvas ref={analysisCanvasRef} style={{ display:"none" }} />
      <canvas ref={captureCanvasRef}  style={{ display:"none" }} />
    </div>
  );
}
