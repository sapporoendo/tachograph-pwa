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
    setSaved(false);
  }, []);

  const retake = useCallback(() => {
    setCapturedImage(null);
    setSaved(false);
    setState("idle");
  }, []);

  const saveToPhotos = useCallback(() => {
    if (!capturedImage) return;
    // iOSでは <img> を長押し→保存が最も確実
    // ここではimgを全画面表示して保存を促す
    setSaved(true);
  }, [capturedImage]);

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
        
        {/* 撮影画像 */}
        <img
          src={capturedImage}
          alt="撮影画像"
          style={{ width:"100%", maxWidth:"400px", borderRadius:"12px" }}
        />

        {/* 保存方法の説明 */}
        {saved ? (
          <div style={{ background:"#1e293b", borderRadius:"12px", padding:"16px", maxWidth:"400px", width:"100%" }}>
            <p style={{ color:"#86efac", fontSize:"14px", textAlign:"center", marginBottom:"8px" }}>
              📌 上の写真を長押し → 「写真に保存」を選んでください
            </p>
            <p style={{ color:"#94a3b8", fontSize:"12px", textAlign:"center" }}>
              iOSの制限のため、長押し保存が必要です
            </p>
          </div>
        ) : null}

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

  return (
    <div style={{ position:"fixed", inset:0, background:"black", overflow:"hidden" }}>
      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted
        style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }}
      />
      <div
        onClick={capture}
        style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", zIndex:10 }}
      >
        <div style={{ position:"relative", width:"85vw", height:"85vw", maxWidth:"340px", maxHeight:"340px" }}>
          <svg viewBox="0 0 300 300" style={{ width:"100%", height:"100%", overflow:"visible" }}>
            <circle cx="150" cy="150" r="145" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="3" strokeDasharray="10 6" />
            <circle cx="150" cy="150" r="112" fill="none" stroke="rgba(96,165,250,0.9)" strokeWidth="2" strokeDasharray="5 4" />
            <line x1="130" y1="150" x2="170" y2="150" stroke="white" strokeWidth="2" />
            <line x1="150" y1="130" x2="150" y2="170" stroke="white" strokeWidth="2" />
          </svg>
          <div style={{ position:"absolute", bottom:"-36px", left:"50%", transform:"translateX(-50%)", color:"rgba(255,255,255,0.85)", fontSize:"14px", whiteSpace:"nowrap", textShadow:"0 1px 4px black" }}>
            円の中をタップして撮影
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} style={{ display:"none" }} />
    </div>
  );
}
