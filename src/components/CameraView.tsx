"use client";

import { useRef, useState, useCallback, useEffect } from "react";

type CaptureState = "idle" | "preview" | "captured";

export default function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CaptureState>("idle");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      videoRef.current.play().catch(console.error);
    }
  }, [state]);

  const capture = useCallback(() => {
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
  }, []);

  const retake = useCallback(() => {
    setCapturedImage(null);
    setState("idle");
  }, []);

  const save = useCallback(() => {
    if (!capturedImage) return;
    const a = document.createElement("a");
    a.href = capturedImage;
    a.download = `tachograph_${Date.now()}.jpg`;
    a.click();
  }, [capturedImage]);

  if (state === "idle") {
    return (
      <div style={{ position:"fixed", inset:0, background:"#0f172a", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"24px", padding:"16px" }}>
        <p style={{ color:"#94a3b8", fontSize:"14px", textAlign:"center" }}>
          タコグラフのチャート紙をガイド円に合わせて撮影してください
        </p>
        <button onClick={startCamera} style={{ padding:"16px 32px", background:"#2563eb", color:"white", borderRadius:"16px", fontSize:"18px", fontWeight:"bold", border:"none" }}>
          カメラを起動
        </button>
        {error && <p style={{ color:"#f87171", fontSize:"14px", textAlign:"center" }}>{error}</p>}
      </div>
    );
  }

  if (state === "captured" && capturedImage) {
    return (
      <div style={{ position:"fixed", inset:0, background:"#0f172a", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"16px", padding:"16px" }}>
        <img src={capturedImage} alt="撮影画像" style={{ width:"100%", maxWidth:"400px", borderRadius:"12px" }} />
        <div style={{ display:"flex", gap:"12px", width:"100%", maxWidth:"400px" }}>
          <button onClick={retake} style={{ flex:1, padding:"12px", background:"#334155", color:"white", borderRadius:"12px", border:"none", fontSize:"16px" }}>撮り直し</button>
          <button onClick={save} style={{ flex:1, padding:"12px", background:"#16a34a", color:"white", borderRadius:"12px", border:"none", fontSize:"16px" }}>保存</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"black" }}>
      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted
        style={{ position:"absolute", top:0, left:0, width:"100%", height:"100%", objectFit:"cover" }}
      />
      {/* ガイド円とボタンを最前面に */}
      <div style={{ position:"absolute", inset:0, zIndex:10, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>
        <svg viewBox="0 0 300 300" style={{ width:"80vw", maxWidth:"320px" }}>
          <circle cx="150" cy="150" r="140" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" strokeDasharray="8 6" />
          <circle cx="150" cy="150" r="108" fill="none" stroke="rgba(96,165,250,0.8)" strokeWidth="2" strokeDasharray="4 4" />
          <line x1="135" y1="150" x2="165" y2="150" stroke="white" strokeWidth="1.5" />
          <line x1="150" y1="135" x2="150" y2="165" stroke="white" strokeWidth="1.5" />
          <text x="150" y="18" textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize="13" fontFamily="sans-serif">円に合わせてください</text>
        </svg>
      </div>
      <button
        onClick={capture}
        style={{ position:"absolute", bottom:"48px", left:"50%", transform:"translateX(-50%)", width:"80px", height:"80px", borderRadius:"50%", background:"white", border:"4px solid #d1d5db", zIndex:20, pointerEvents:"auto" }}
        aria-label="撮影"
      />
      <canvas ref={canvasRef} style={{ display:"none" }} />
    </div>
  );
}
