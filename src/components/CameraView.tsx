"use client";

import { useRef, useState, useCallback, useEffect } from "react";

type CaptureState = "idle" | "preview" | "ready_to_shoot" | "captured";

export default function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CaptureState>("idle");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
    if ((state === "preview" || state === "ready_to_shoot") && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(console.error);
    }
  }, [state]);

  const handleFocus = useCallback(() => {
    setState("ready_to_shoot");
    if (videoRef.current) {
      videoRef.current.focus();
    }
  }, []);

  const doCapture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
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
  }, []);

  const retake = useCallback(() => {
    setCapturedImage(null);
    setSaved(false);
    setState("idle");
  }, []);

  const saveToPhotos = useCallback(() => {
    setSaved(true);
  }, []);

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
          <button onClick={saveToPhotos} style={{ flex:1, padding:"14px", background:"#16a34a", color:"white", borderRadius:"12px", border:"none", fontSize:"16px" }}>
            📷 写真に保存
          </button>
        </div>
      </div>
    );
  }

  const isReady = state === "ready_to_shoot";

  return (
    <div style={{ position:"fixed", inset:0, background:"black", overflow:"hidden" }}>
      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted
        style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }}
      />
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", zIndex:10, pointerEvents:"none" }}>
        <div style={{ color:"rgba(255,255,255,0.9)", fontSize:"13px", marginBottom:"8px", textShadow:"0 1px 4px black", textAlign:"center" }}>
          {isReady ? "✅ ピント確認できたら「撮影」を押してください" : "円に合わせて「ピント合わせ」を押してください"}
        </div>
        <div style={{ position:"relative", width:"85vw", height:"85vw", maxWidth:"340px", maxHeight:"340px" }}>
          <svg viewBox="0 0 300 300" style={{ width:"100%", height:"100%", overflow:"visible" }}>
            <circle cx="150" cy="150" r="145" fill="none"
              stroke={isReady ? "rgba(250,204,21,0.95)" : "rgba(255,255,255,0.95)"}
              strokeWidth="2.5" strokeDasharray="10 5" />
            <circle cx="150" cy="150" r="130" fill="none"
              stroke={isReady ? "rgba(250,204,21,0.8)" : "rgba(255,80,80,0.9)"}
              strokeWidth="2" strokeDasharray="6 4" />
            <circle cx="150" cy="150" r="106" fill="none"
              stroke={isReady ? "rgba(250,204,21,0.8)" : "rgba(96,165,250,0.9)"}
              strokeWidth="2" strokeDasharray="5 4" />
            <line x1="130" y1="150" x2="170" y2="150" stroke="white" strokeWidth="2" />
            <line x1="150" y1="130" x2="150" y2="170" stroke="white" strokeWidth="2" />
            {!isReady && <>
              <text x="152" y="6" fill="rgba(255,255,255,0.9)" fontSize="10" fontFamily="sans-serif">チャート紙の縁</text>
              <text x="152" y="21" fill="rgba(255,100,100,0.9)" fontSize="10" fontFamily="sans-serif">120km/h付近</text>
              <text x="152" y="36" fill="rgba(96,165,250,0.9)" fontSize="10" fontFamily="sans-serif">20km/h付近</text>
            </>}
          </svg>
        </div>
      </div>
      <div style={{
        position:"absolute", bottom:0, left:0, right:0, zIndex:20,
        padding:"24px 24px 40px",
        background:"linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
        display:"flex", flexDirection:"column", alignItems:"center", gap:"12px"
      }}>
        {!isReady ? (
          <button onClick={handleFocus} style={{ width:"100%", maxWidth:"320px", padding:"18px", background:"#2563eb", color:"white", borderRadius:"16px", fontSize:"18px", fontWeight:"bold", border:"none", boxShadow:"0 4px 20px rgba(37,99,235,0.5)" }}>
            🔍 ピント合わせ
          </button>
        ) : (
          <>
            <button onClick={doCapture} style={{ width:"100%", maxWidth:"320px", padding:"18px", background:"#16a34a", color:"white", borderRadius:"16px", fontSize:"20px", fontWeight:"bold", border:"none", boxShadow:"0 4px 20px rgba(22,163,74,0.5)" }}>
              📸 撮影する
            </button>
            <button onClick={() => setState("preview")} style={{ background:"transparent", border:"none", color:"rgba(255,255,255,0.6)", fontSize:"14px" }}>
              ← ピント合わせをやり直す
            </button>
          </>
        )}
      </div>
      <canvas ref={canvasRef} style={{ display:"none" }} />
    </div>
  );
}
