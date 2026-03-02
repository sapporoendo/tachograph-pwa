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
      const video = videoRef.current;
      video.srcObject = streamRef.current;
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
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-slate-900 gap-6 p-4">
        <p className="text-slate-400 text-sm text-center">
          タコグラフのチャート紙をガイド円に合わせて撮影してください
        </p>
        <button
          onClick={startCamera}
          className="px-8 py-4 bg-blue-600 rounded-2xl text-white font-semibold text-lg"
        >
          カメラを起動
        </button>
        {error && <p className="text-red-400 text-sm text-center px-4">{error}</p>}
      </div>
    );
  }

  if (state === "captured" && capturedImage) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-slate-900 gap-4 p-4">
        <img src={capturedImage} alt="撮影画像" className="w-full max-w-sm rounded-xl" />
        <div className="flex gap-3 w-full max-w-sm">
          <button onClick={retake} className="flex-1 py-3 bg-slate-700 rounded-xl text-white font-medium">
            撮り直し
          </button>
          <button onClick={save} className="flex-1 py-3 bg-green-600 rounded-xl text-white font-medium">
            保存
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black">
      {/* 全画面カメラ映像 */}
      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* ガイド円オーバーレイ */}
      <div className="absolute inset-0 flex items-center justify-center">
        <svg
          viewBox="0 0 300 300"
          className="w-4/5 max-w-xs pointer-events-none"
        >
          <circle cx="150" cy="150" r="140" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" strokeDasharray="8 6" />
          <circle cx="150" cy="150" r="108" fill="none" stroke="rgba(96,165,250,0.8)" strokeWidth="2" strokeDasharray="4 4" />
          <line x1="135" y1="150" x2="165" y2="150" stroke="white" strokeWidth="1.5" />
          <line x1="150" y1="135" x2="150" y2="165" stroke="white" strokeWidth="1.5" />
          <text x="150" y="20" textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="12" fontFamily="sans-serif">
            円に合わせてください
          </text>
        </svg>
      </div>
      {/* 撮影ボタン */}
      <button
        onClick={capture}
        className="absolute bottom-12 left-1/2 -translate-x-1/2 w-20 h-20 rounded-full bg-white border-4 border-gray-300 shadow-xl active:scale-95 transition-transform"
        aria-label="撮影"
      />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
