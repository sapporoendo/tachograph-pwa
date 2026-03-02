"use client";

import { useRef, useState, useCallback } from "react";

type CaptureState = "idle" | "preview" | "captured";

export default function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [state, setState] = useState<CaptureState>("idle");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---- カメラ起動 ----
  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" }, // 背面カメラ優先
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setState("preview");
    } catch (err) {
      setError("カメラへのアクセスが拒否されました。設定を確認してください。");
      console.error(err);
    }
  }, []);

  // ---- 撮影 ----
  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    setCapturedImage(dataUrl);

    // カメラ停止
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setState("captured");
  }, []);

  // ---- 撮り直し ----
  const retake = useCallback(() => {
    setCapturedImage(null);
    setState("idle");
  }, []);

  // ---- 保存（ダウンロード） ----
  const save = useCallback(() => {
    if (!capturedImage) return;
    const a = document.createElement("a");
    a.href = capturedImage;
    a.download = `tachograph_${Date.now()}.jpg`;
    a.click();
  }, [capturedImage]);

  // ==============================
  // RENDER
  // ==============================

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
          <p className="text-red-400 text-sm text-center">{error}</p>
        )}
      </div>
    );
  }

  if (state === "captured" && capturedImage) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 w-full max-w-sm">
        <img
          src={capturedImage}
          alt="撮影画像"
          className="w-full rounded-xl border border-slate-600"
        />
        <p className="text-slate-400 text-sm">撮影完了</p>
        <div className="flex gap-3 w-full">
          <button
            onClick={retake}
            className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-medium transition-colors"
          >
            撮り直し
          </button>
          <button
            onClick={save}
            className="flex-1 py-3 bg-green-600 hover:bg-green-500 rounded-xl text-white font-medium transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    );
  }

  // state === "preview"
  return (
    <div className="relative w-full max-w-sm aspect-square flex items-center justify-center">
      {/* ライブプレビュー */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover rounded-xl"
      />

      {/* ガイド円オーバーレイ */}
      <GuideOverlay />

      {/* 撮影ボタン */}
      <button
        onClick={capture}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 w-16 h-16 rounded-full bg-white border-4 border-slate-300 shadow-lg active:scale-95 transition-transform"
        aria-label="撮影"
      />

      {/* 非表示の canvas（キャプチャ用） */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

// ---- ガイド円SVGオーバーレイ ----
function GuideOverlay() {
  const size = 300; // viewBox サイズ
  const cx = size / 2;
  const cy = size / 2;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="absolute inset-0 w-full h-full pointer-events-none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* 外周: チャート紙の端 */}
      <circle
        cx={cx}
        cy={cy}
        r={130}
        fill="none"
        stroke="rgba(255,255,255,0.8)"
        strokeWidth="2"
        strokeDasharray="8 6"
      />
      {/* 内周: 速度記録エリアのガイド */}
      <circle
        cx={cx}
        cy={cy}
        r={100}
        fill="none"
        stroke="rgba(96,165,250,0.7)"
        strokeWidth="1.5"
        strokeDasharray="4 4"
      />
      {/* 十字線（中心合わせ用） */}
      <line
        x1={cx - 12} y1={cy} x2={cx + 12} y2={cy}
        stroke="rgba(255,255,255,0.6)" strokeWidth="1"
      />
      <line
        x1={cx} y1={cy - 12} x2={cx} y2={cy + 12}
        stroke="rgba(255,255,255,0.6)" strokeWidth="1"
      />
      {/* ラベル */}
      <text
        x={cx}
        y={cy - 138}
        textAnchor="middle"
        fill="rgba(255,255,255,0.7)"
        fontSize="10"
        fontFamily="sans-serif"
      >
        チャート紙を円に合わせてください
      </text>
    </svg>
  );
}
