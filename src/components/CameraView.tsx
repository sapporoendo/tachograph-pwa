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
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setState("preview");
    } catch (err) {
      console.error(err);
      setError("カメラへのアクセスができませんでした。Safariの設定でカメラを許可してください。");
    }
  }, []);

  useEffect(() => {
    if (state === "preview" && videoRef.current && streamRef.current) {
      const video = videoRef.current;
      video.srcObject = streamRef.current;
      video.setAttribute("playsinline", "true");
      video.setAttribute("autoplay", "true");
      video.setAttribute("muted", "true");
      video.play().catch(console.error);
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
      <div className="flex flex-col items-center gap-6 p-4">
        <p className="text-slate-400 text-sm text-center max-w-xs">
          タコグラフのチャート紙を<br />ガイド円に合わせて撮影してください
        </p>
        <button
          onClick={startCamera}
          className="px-8 py-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 rounded-2xl text-white font-semibold text-lg transition-colors"
        >
          カメラを起動
        </button>
        {error && (
          <p className="text-red-400 text-sm text-center px-4">{error}</p>
        )}
      </div>
    );
  }

  if (state === "captured" && capturedImage) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 w-full max-w-sm">
        <img src={capturedImage} alt="撮影画像" className="w-full rounded-xl border border-slate-600" />
        <p className="text-slate-400 text-sm">撮影完了</p>
        <div className="flex gap-3 w-full">
          <button onClick={retake} className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-medium transition-colors">
            撮り直し
          </button>
          <button onClick={save} className="flex-1 py-3 bg-green-600 hover:bg-green-500 rounded-xl text-white font-medium transition-colors">
            保存
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full max-w-sm" style={{ aspectRatio: "1/1" }}>
      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted
        className="absolute inset-0 w-full h-full object-cover rounded-xl"
      />
      <svg viewBox="0 0 300 300" className="absolute inset-0 w-full h-full pointer-events-none">
        <circle cx="150" cy="150" r="130" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeDasharray="8 6" />
        <circle cx="150" cy="150" r="100" fill="none" stroke="rgba(96,165,250,0.7)" strokeWidth="1.5" strokeDasharray="4 4" />
        <line x1="138" y1="150" x2="162" y2="150" stroke="rgba(255,255,255,0.6)" strokeWidth="1" />
        <line x1="150" y1="138" x2="150" y2="162" stroke="rgba(255,255,255,0.6)" strokeWidth="1" />
      </svg>
      <button
        onClick={capture}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 w-16 h-16 rounded-full bg-white border-4 border-slate-300 shadow-lg active:scale-95 transition-transform"
        aria-label="撮影"
      />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
