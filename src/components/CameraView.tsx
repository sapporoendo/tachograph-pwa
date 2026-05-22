"use client";

import { useRef, useState, useCallback, useEffect } from "react";

type CaptureState = "idle" | "preview" | "captured";
type DistanceStatus = "too_close" | "ok" | "too_far" | "unknown";

interface TachographDetectionResult {
  centerX: number | null;
  centerY: number | null;
  confidence: number;
  outerRatio: number;
  outerWarning: boolean;
  isAligned: boolean;
  isDistanceOk: boolean;
  canCapture: boolean;
  message: string;
}

interface DetectionState extends TachographDetectionResult {
  status: DistanceStatus;
}

interface SelectedCameraDebugInfo {
  label: string | null;
  deviceId: string | null;
  width: number | null;
  height: number | null;
  facingMode: string | null;
}

interface CenterDebugInfo {
  x: number | null;
  y: number | null;
}

interface CalibrationData {
  cx: number | null;
  cy: number | null;
  r: number;
  center_x: number | null;
  center_y: number | null;
  outer_ratio: number;
  outer_radius: number;
  image_width: number;
  image_height: number;
  coordinate_system: "saved_jpeg_pixels";
  analysis_canvas_width: number;
  analysis_canvas_height: number;
  raw_center_x: number | null;
  raw_center_y: number | null;
  raw_outer_radius: number;
  confidence: number;
  outer_warning: boolean;
  can_capture: boolean;
  message: string;
  chart_diameter_cm: number;
  timestamp: string;
  user_agent: string;
  selected_camera_label: string | null;
  selected_camera_device_id: string | null;
  captured_at: string;
  detection: TachographDetectionResult;
  filename: string;
  json_filename: string;
}

interface AnalysisMapping {
  sourceX: number;
  sourceY: number;
  sourceSize: number;
  analysisWidth: number;
  analysisHeight: number;
  savedImageWidth: number;
  savedImageHeight: number;
}

const ANALYSIS_SIZE = 320;
// タコグラフチャート紙の物理直径。UIでは実寸補正せず、後続の解析エンジンが参照しやすいメタ情報として保持する。
const TACHOGRAPH_CHART_DIAMETER_CM = 12.2;
const MIN_CENTER_CONFIDENCE = 0.35;
const CENTER_ALIGNMENT_TOLERANCE_RATIO = 0.075;
const OUTER_RATIO_MIN = 0.32;
const OUTER_RATIO_MAX = 1.08;
const OUTER_RADIUS_MIN_RATIO = 0.26;
const OUTER_RADIUS_MAX_RATIO = 0.48;
const OUTER_EDGE_MIN_CONFIDENCE = 0.06;
const OUTER_WARNING_CONFIDENCE = 0.22;
const CAPTURE_ENABLE_FRAMES = 3;
const CAPTURE_DISABLE_FRAMES = 8;
const CAPTURE_MIN_HOLD_MS = 1200;
const CENTER_HARD_DISABLE_RATIO = 0.16;
const DETECTION_SMOOTHING = 0.35;
const CENTER_JUMP_SMOOTHING = 0.18;
const GUIDE_GREEN_MIN_HOLD_MS = 1000;
const GUIDE_GREEN_DISABLE_DELAY_MS = 800;
const GUIDE_DISPLAY_RATIO = 0.85;
const GUIDE_MAX_SIZE = 340;

const initialDetection: DetectionState = {
  centerX: null,
  centerY: null,
  confidence: 0,
  outerRatio: 0,
  outerWarning: true,
  isAligned: false,
  isDistanceOk: false,
  canCapture: false,
  message: "カメラを向けてください",
  status: "unknown",
};

function hasOuterCandidate(detection: DetectionState): boolean {
  return detection.confidence >= OUTER_EDGE_MIN_CONFIDENCE && detection.outerRatio >= OUTER_RATIO_MIN;
}

function getCanCaptureBlockReason(detection: DetectionState, stableOkFrames: number): string {
  if (detection.canCapture) return "none";
  if (!hasOuterCandidate(detection)) return detection.outerRatio < OUTER_RATIO_MIN ? "outerRatio too small" : "outer candidate missing";
  if (detection.centerX === null || detection.centerY === null || detection.confidence < MIN_CENTER_CONFIDENCE) return "confidence low";
  if (!detection.isAligned) return "center not aligned";
  if (stableOkFrames < CAPTURE_ENABLE_FRAMES) return "waiting stable frames";
  return "waiting stable frames";
}

function getShowGreenGuideBlockReason(detection: DetectionState, stableOkFrames: number): string {
  if (detection.canCapture) return "none";
  return getCanCaptureBlockReason(detection, stableOkFrames);
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function createCaptureFilename(cx: number | null, cy: number | null, r: number): string {
  const safeCx = cx === null ? "unknown" : Math.round(cx).toString();
  const safeCy = cy === null ? "unknown" : Math.round(cy).toString();
  return `tacho_cx${safeCx}_cy${safeCy}_r${Math.round(r)}.jpg`;
}

function getAnalysisMapping(videoWidth: number, videoHeight: number): AnalysisMapping {
  const sourceSize = Math.min(videoWidth, videoHeight);
  return {
    sourceX: (videoWidth - sourceSize) / 2,
    sourceY: (videoHeight - sourceSize) / 2,
    sourceSize,
    analysisWidth: ANALYSIS_SIZE,
    analysisHeight: ANALYSIS_SIZE,
    savedImageWidth: videoWidth,
    savedImageHeight: videoHeight,
  };
}

function mapAnalysisPointToSavedJpeg(
  x: number | null,
  y: number | null,
  mapping: AnalysisMapping
) {
  if (x === null || y === null) {
    return { x: null, y: null };
  }

  return {
    x: mapping.sourceX + x / mapping.analysisWidth * mapping.sourceSize,
    y: mapping.sourceY + y / mapping.analysisHeight * mapping.sourceSize,
  };
}

function mapAnalysisRadiusToSavedJpeg(radius: number, mapping: AnalysisMapping): number {
  return radius / mapping.analysisWidth * mapping.sourceSize;
}

function blendDetection(
  previous: DetectionState | null,
  current: DetectionState
): DetectionState {
  if (
    !previous ||
    previous.centerX === null ||
    previous.centerY === null ||
    current.centerX === null ||
    current.centerY === null
  ) {
    return current;
  }

  const keep = 1 - DETECTION_SMOOTHING;
  const centerJump = Math.sqrt((current.centerX - previous.centerX) ** 2 + (current.centerY - previous.centerY) ** 2);
  const centerSmoothing = centerJump > ANALYSIS_SIZE * 0.055 ? CENTER_JUMP_SMOOTHING : DETECTION_SMOOTHING;
  const centerKeep = 1 - centerSmoothing;
  const smoothed: DetectionState = {
    ...current,
    centerX: previous.centerX * centerKeep + current.centerX * centerSmoothing,
    centerY: previous.centerY * centerKeep + current.centerY * centerSmoothing,
    confidence: previous.confidence * keep + current.confidence * DETECTION_SMOOTHING,
    outerRatio: previous.outerRatio * keep + current.outerRatio * DETECTION_SMOOTHING,
    outerWarning: current.outerWarning,
  };

  return smoothed;
}

function isLikelyUltraWideCamera(label: string): boolean {
  const normalized = label.toLowerCase();
  return normalized.includes("ultra") || normalized.includes("0.5") || normalized.includes("超広角");
}

function scoreEnvironmentCamera(device: MediaDeviceInfo): number {
  const label = device.label.toLowerCase();
  let score = 0;

  if (label.includes("back") || label.includes("rear") || label.includes("environment") || label.includes("背面")) score += 30;
  if (label.includes("wide") || label.includes("広角")) score += 10;
  if (label.includes("camera")) score += 2;
  if (isLikelyUltraWideCamera(label)) score -= 60;
  if (label.includes("front") || label.includes("user") || label.includes("selfie") || label.includes("前面")) score -= 80;
  if (label.includes("tele") || label.includes("望遠")) score -= 20;

  return score;
}

async function getPreferredVideoConstraints(): Promise<MediaTrackConstraints> {
  const baseConstraints: MediaTrackConstraints = {
    facingMode: "environment",
    width: { ideal: 3840 },
    height: { ideal: 2160 },
  };

  if (!navigator.mediaDevices?.enumerateDevices) return baseConstraints;

  let devices = await navigator.mediaDevices.enumerateDevices();
  let videoDevices = devices.filter((device) => device.kind === "videoinput");

  if (videoDevices.every((device) => !device.label)) {
    let temporaryStream: MediaStream | null = null;
    try {
      temporaryStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      devices = await navigator.mediaDevices.enumerateDevices();
      videoDevices = devices.filter((device) => device.kind === "videoinput");
    } catch {
      return baseConstraints;
    } finally {
      temporaryStream?.getTracks().forEach((track) => track.stop());
    }
  }

  const preferredDevice = videoDevices
    .filter((device) => !isLikelyUltraWideCamera(device.label))
    .sort((a, b) => scoreEnvironmentCamera(b) - scoreEnvironmentCamera(a))[0];

  if (!preferredDevice?.deviceId || scoreEnvironmentCamera(preferredDevice) <= 0) return baseConstraints;

  return {
    ...baseConstraints,
    // iOS Safari/PWAでは背面カメラ群が仮想デバイスとして扱われ、deviceId指定でもレンズ切替を完全には止められない場合がある。
    deviceId: { exact: preferredDevice.deviceId },
  };
}

function analyzeFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): DetectionState {
  const W = ANALYSIS_SIZE, H = ANALYSIS_SIZE;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return initialDetection;
  const mapping = getAnalysisMapping(video.videoWidth || W, video.videoHeight || H);
  ctx.drawImage(
    video,
    mapping.sourceX,
    mapping.sourceY,
    mapping.sourceSize,
    mapping.sourceSize,
    0,
    0,
    W,
    H
  );

  const screenCx = W / 2, screenCy = H / 2;
  const guideR = (145 / 300) * W;
  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;
  const sampleCount = 96;
  const centerOffsets = [-24, -16, -8, 0, 8, 16, 24];
  const radiusMin = Math.round(Math.min(W, H) * OUTER_RADIUS_MIN_RATIO);
  const radiusMax = Math.round(Math.min(W, H) * OUTER_RADIUS_MAX_RATIO);

  const getPixel = (x: number, y: number) => {
    const px = Math.max(0, Math.min(W - 1, Math.round(x)));
    const py = Math.max(0, Math.min(H - 1, Math.round(y)));
    const i = (py * W + px) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return {
      r,
      g,
      b,
      luma: 0.299 * r + 0.587 * g + 0.114 * b,
    };
  };

  const getCenterFeatureScore = (cx: number, cy: number) => {
    const centerSamples = [
      getPixel(cx, cy),
      getPixel(cx - 4, cy),
      getPixel(cx + 4, cy),
      getPixel(cx, cy - 4),
      getPixel(cx, cy + 4),
    ];
    const centerLuma = centerSamples.reduce((sum, pixel) => sum + pixel.luma, 0) / centerSamples.length;
    const ringSamples = Array.from({ length: 24 }, (_, i) => {
      const angle = (Math.PI * 2 * i) / 24;
      return getPixel(cx + Math.cos(angle) * 16, cy + Math.sin(angle) * 16);
    });
    const ringLuma = ringSamples.reduce((sum, pixel) => sum + pixel.luma, 0) / ringSamples.length;
    const ringVariance = ringSamples.reduce((sum, pixel) => sum + (pixel.luma - ringLuma) ** 2, 0) / ringSamples.length;
    const contrastScore = Math.min(Math.abs(centerLuma - ringLuma) / 90, 1);
    const brightHoleScore = Math.max(0, Math.min((centerLuma - ringLuma) / 70, 1));
    const circularScore = 1 - Math.min(ringVariance / 2600, 1);
    const verticalContrast =
      Math.abs(getPixel(cx, cy - 24).luma - centerLuma) +
      Math.abs(getPixel(cx, cy + 24).luma - centerLuma);
    const horizontalContrast =
      Math.abs(getPixel(cx - 24, cy).luma - centerLuma) +
      Math.abs(getPixel(cx + 24, cy).luma - centerLuma);
    const verticalLinePenalty = verticalContrast > horizontalContrast * 1.35 ? 1 : 0;
    const upwardPenalty = cy < screenCy ? (screenCy - cy) / 32 : 0;

    return contrastScore * 0.07 + brightHoleScore * 0.05 + circularScore * 0.04 - verticalLinePenalty * 0.06 - upwardPenalty * 0.04;
  };

  let best = {
    centerX: screenCx,
    centerY: screenCy,
    radius: 0,
    confidence: 0,
    edgeRatio: 0,
  };

  for (const ox of centerOffsets) {
    for (const oy of centerOffsets) {
      const candidateX = screenCx + ox;
      const candidateY = screenCy + oy;
      const centerPenalty = Math.sqrt(ox * ox + oy * oy) / (W * 0.18);
      const centerFeatureScore = getCenterFeatureScore(candidateX, candidateY);

      for (let radius = radiusMin; radius <= radiusMax; radius += 4) {
        let edgeHits = 0;
        let edgeStrength = 0;

        for (let s = 0; s < sampleCount; s++) {
          const angle = (Math.PI * 2 * s) / sampleCount;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const inner = getPixel(candidateX + cos * (radius - 3), candidateY + sin * (radius - 3));
          const outer = getPixel(candidateX + cos * (radius + 3), candidateY + sin * (radius + 3));
          const edge = Math.abs(inner.luma - outer.luma);
          const isDarkEdge = inner.luma < 150 || outer.luma < 150;
          const isGreenEdge =
            (inner.g > inner.r + 12 && inner.g > inner.b + 12) ||
            (outer.g > outer.r + 12 && outer.g > outer.b + 12);

          if (edge > 18 && (isDarkEdge || isGreenEdge)) {
            edgeHits++;
            edgeStrength += Math.min(edge / 80, 1);
          }
        }

        const edgeRatio = edgeHits / sampleCount;
        const radiusBonus = (radius - radiusMin) / Math.max(1, radiusMax - radiusMin) * 0.12;
        const confidence = edgeRatio * 0.75 + (edgeStrength / sampleCount) * 0.25 + radiusBonus + centerFeatureScore - centerPenalty * 0.2;

        if (confidence > best.confidence) {
          best = {
            centerX: candidateX,
            centerY: candidateY,
            radius,
            confidence: Math.max(0, Math.min(1, confidence)),
            edgeRatio,
          };
        }
      }
    }
  }

  if (best.confidence < OUTER_EDGE_MIN_CONFIDENCE || best.radius <= 0) {
    return {
      ...initialDetection,
      confidence: best.confidence,
      message: "外周を円形ガイドに合わせてください",
    };
  }

  const centerX = best.centerX;
  const centerY = best.centerY;
  const redRingFrac = best.radius / guideR;
  const centerOffset = Math.sqrt((centerX - screenCx) ** 2 + (centerY - screenCy) ** 2);
  const outerWarning =
    best.confidence < OUTER_WARNING_CONFIDENCE ||
    redRingFrac < OUTER_RATIO_MIN ||
    redRingFrac > OUTER_RATIO_MAX;
  const confidence = best.confidence;
  const hasCenter = confidence >= MIN_CENTER_CONFIDENCE;
  const isAligned = hasCenter && centerOffset <= W * CENTER_ALIGNMENT_TOLERANCE_RATIO;
  const isDistanceOk = redRingFrac >= OUTER_RATIO_MIN && redRingFrac <= OUTER_RATIO_MAX;
  const canCapture = hasCenter && isAligned;

  if (!hasCenter) {
    return {
      centerX: null,
      centerY: null,
      confidence,
      outerRatio: redRingFrac,
      outerWarning: true,
      isAligned: false,
      isDistanceOk,
      canCapture: false,
      message: "中心を検出できません",
      status: "unknown",
    };
  }

  if (!isDistanceOk) {
    return {
      centerX,
      centerY,
      confidence,
      outerRatio: redRingFrac,
      outerWarning,
      isAligned,
      isDistanceOk,
      canCapture,
      message: "外周を円形ガイドに合わせてください",
      status: redRingFrac > OUTER_RATIO_MAX ? "too_close" : "too_far",
    };
  }

  if (!isAligned) {
    return {
      centerX,
      centerY,
      confidence,
      outerRatio: redRingFrac,
      outerWarning,
      isAligned,
      isDistanceOk,
      canCapture,
      message: "中心を十字に合わせてください",
      status: "too_far",
    };
  }

  return {
    centerX,
    centerY,
    confidence,
    outerRatio: redRingFrac,
    outerWarning,
    isAligned,
    isDistanceOk,
    canCapture,
    message: outerWarning ? "外周を円形ガイドに合わせてください" : "撮影できます",
    status: outerWarning ? "unknown" : "ok",
  };
}

async function saveJpeg(blobUrl: string, filename: string) {
  const res = await fetch(blobUrl);
  const blob = await res.blob();
  const file = new File([blob], filename, { type: "image/jpeg" });
  const shareData: ShareData = { files: [file], title: filename, text: filename };

  if (navigator.canShare?.(shareData)) {
    await navigator.share(shareData);
    return;
  }

  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  // ブラウザ/PWAから写真フォルダへ直接保存できるかはOSとブラウザ実装に依存するため、非対応時はJPEGのdownloadで保存する。
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function createJsonFilename(filename: string): string {
  return filename.replace(/\.jpe?g$/i, ".json");
}

function createCalibrationJsonBlob(calibration: CalibrationData): Blob {
  return new Blob([JSON.stringify(calibration, null, 2)], { type: "application/json" });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function shareOrDownloadCalibrationJson(calibration: CalibrationData) {
  const blob = createCalibrationJsonBlob(calibration);
  const file = new File([blob], calibration.json_filename, { type: "application/json" });
  const shareData: ShareData = {
    files: [file],
    title: calibration.json_filename,
    text: calibration.json_filename,
  };

  if (navigator.canShare?.(shareData)) {
    await navigator.share(shareData);
    return;
  }

  downloadBlob(blob, calibration.json_filename);
}

async function shareAnalysisFiles(blobUrl: string, calibration: CalibrationData) {
  const imageResponse = await fetch(blobUrl);
  const imageBlob = await imageResponse.blob();
  const imageFile = new File([imageBlob], calibration.filename, { type: "image/jpeg" });
  const jsonFile = new File(
    [createCalibrationJsonBlob(calibration)],
    calibration.json_filename,
    { type: "application/json" }
  );
  const shareData: ShareData = {
    files: [imageFile, jsonFile],
    title: calibration.filename,
    text: `${calibration.filename}\n${calibration.json_filename}`,
  };

  if (navigator.canShare?.(shareData)) {
    await navigator.share(shareData);
    return;
  }

  throw new Error("この環境では複数ファイル共有に対応していません。");
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
  const smoothedDetectionRef = useRef<DetectionState | null>(null);
  const stableCanCaptureRef = useRef(false);
  const captureOkFramesRef = useRef(0);
  const captureNgFramesRef = useRef(0);
  const captureEnabledAtRef = useRef(0);
  const guideGreenStartedAtRef = useRef(0);
  const guideGreenNgStartedAtRef = useRef<number | null>(null);
  const detectionFrameRef = useRef(0);

  const [state, setState] = useState<CaptureState>("idle");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [calibrationData, setCalibrationData] = useState<CalibrationData | null>(null);
  const [detectionResult, setDetectionResult] = useState<DetectionState>(initialDetection);
  const [showGreenGuide, setShowGreenGuide] = useState(false);
  const [rawCenter, setRawCenter] = useState<CenterDebugInfo>({ x: null, y: null });
  const [selectedCamera, setSelectedCamera] = useState<SelectedCameraDebugInfo>({
    label: null,
    deviceId: null,
    width: null,
    height: null,
    facingMode: null,
  });
  // チュートリアル：初回のみ表示
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    const done = localStorage.getItem("tachograph_tutorial_done");
    if (!done) setShowTutorial(true);
  }, []);

  useEffect(() => {
    const now = Date.now();

    if (detectionResult.canCapture) {
      guideGreenStartedAtRef.current = now;
      guideGreenNgStartedAtRef.current = null;
      setShowGreenGuide(true);
      return;
    }

    if (!showGreenGuide) return;

    if (guideGreenNgStartedAtRef.current === null) {
      guideGreenNgStartedAtRef.current = now;
    }

    const remainingHold = Math.max(0, GUIDE_GREEN_MIN_HOLD_MS - (now - guideGreenStartedAtRef.current));
    const remainingNg = Math.max(0, GUIDE_GREEN_DISABLE_DELAY_MS - (now - guideGreenNgStartedAtRef.current));
    const timeout = window.setTimeout(() => {
      setShowGreenGuide(false);
      guideGreenNgStartedAtRef.current = null;
    }, Math.max(80, remainingHold, remainingNg));

    return () => window.clearTimeout(timeout);
  }, [detectionResult.canCapture, showGreenGuide]);

  const startAnalysisLoop = useCallback(() => {
    const loop = () => {
      const video = videoRef.current;
      const canvas = analysisCanvasRef.current;
      if (video && canvas && video.readyState >= 2) {
        const rawResult = analyzeFrame(video, canvas);
        setRawCenter({ x: rawResult.centerX, y: rawResult.centerY });
        const smoothedResult = blendDetection(smoothedDetectionRef.current, rawResult);
        const smoothedCenterOffset =
          smoothedResult.centerX === null || smoothedResult.centerY === null
            ? Infinity
            : Math.sqrt((smoothedResult.centerX - ANALYSIS_SIZE / 2) ** 2 + (smoothedResult.centerY - ANALYSIS_SIZE / 2) ** 2);
        const smoothedIsAligned =
          smoothedResult.confidence >= MIN_CENTER_CONFIDENCE &&
          smoothedCenterOffset <= ANALYSIS_SIZE * CENTER_ALIGNMENT_TOLERANCE_RATIO;
        const smoothedIsDistanceOk =
          smoothedResult.outerRatio >= OUTER_RATIO_MIN &&
          smoothedResult.outerRatio <= OUTER_RATIO_MAX;
        const smoothedOuterWarning = smoothedResult.outerWarning || !smoothedIsDistanceOk;
        const smoothedHasOuterCandidate = hasOuterCandidate({
          ...smoothedResult,
          isDistanceOk: smoothedIsDistanceOk,
          outerWarning: smoothedOuterWarning,
        });
        const frameCanCapture =
          smoothedHasOuterCandidate &&
          smoothedResult.confidence >= MIN_CENTER_CONFIDENCE &&
          smoothedIsAligned;

        if (frameCanCapture) {
          captureOkFramesRef.current++;
          captureNgFramesRef.current = 0;
        } else {
          captureNgFramesRef.current++;
          captureOkFramesRef.current = 0;
        }

        const centerHardLost = smoothedCenterOffset > ANALYSIS_SIZE * CENTER_HARD_DISABLE_RATIO;
        const holdUntil = captureEnabledAtRef.current + CAPTURE_MIN_HOLD_MS;

        if (captureOkFramesRef.current >= CAPTURE_ENABLE_FRAMES && !stableCanCaptureRef.current) {
          stableCanCaptureRef.current = true;
          captureEnabledAtRef.current = Date.now();
        }
        if (centerHardLost) {
          stableCanCaptureRef.current = false;
          captureEnabledAtRef.current = 0;
        } else if (captureNgFramesRef.current >= CAPTURE_DISABLE_FRAMES && Date.now() >= holdUntil) {
          stableCanCaptureRef.current = false;
          captureEnabledAtRef.current = 0;
        }

        const finalResult: DetectionState = {
          ...smoothedResult,
          isAligned: smoothedIsAligned,
          isDistanceOk: smoothedIsDistanceOk,
          outerWarning: smoothedOuterWarning,
          canCapture: stableCanCaptureRef.current,
          message: stableCanCaptureRef.current
            ? "撮影できます"
            : frameCanCapture
              ? "そのまま保持してください"
              : smoothedResult.message,
          status: stableCanCaptureRef.current ? "ok" : frameCanCapture ? "unknown" : smoothedResult.status,
        };

        smoothedDetectionRef.current = finalResult;
        detectionFrameRef.current++;
        const videoTrack = streamRef.current?.getVideoTracks()[0] ?? null;
        const trackSettings = videoTrack?.getSettings();
        setSelectedCamera({
          label: videoTrack?.label || null,
          deviceId: trackSettings?.deviceId || null,
          width: trackSettings?.width || null,
          height: trackSettings?.height || null,
          facingMode: trackSettings?.facingMode || null,
        });
        setDetectionResult(finalResult);
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
    smoothedDetectionRef.current = null;
    stableCanCaptureRef.current = false;
    captureOkFramesRef.current = 0;
    captureNgFramesRef.current = 0;
    captureEnabledAtRef.current = 0;
    guideGreenStartedAtRef.current = 0;
    guideGreenNgStartedAtRef.current = null;
    detectionFrameRef.current = 0;
    setRawCenter({ x: null, y: null });
    setShowGreenGuide(false);
    try {
      const videoConstraints = await getPreferredVideoConstraints();
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
          audio: false,
        });
      }
      streamRef.current = stream;
      const videoTrack = stream.getVideoTracks()[0] ?? null;
      const trackSettings = videoTrack?.getSettings();
      setSelectedCamera({
        label: videoTrack?.label || null,
        deviceId: trackSettings?.deviceId || null,
        width: trackSettings?.width || null,
        height: trackSettings?.height || null,
        facingMode: trackSettings?.facingMode || null,
      });
      smoothedDetectionRef.current = null;
      stableCanCaptureRef.current = false;
      captureOkFramesRef.current = 0;
      captureNgFramesRef.current = 0;
      captureEnabledAtRef.current = 0;
      setDetectionResult(initialDetection);
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
    if (!video || !detectionResult.canCapture) return;
    stopAnalysisLoop();

    const videoW = video.videoWidth || 1280;
    const videoH = video.videoHeight || 720;
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const videoScale = Math.max(screenW / videoW, screenH / videoH);
    const analysisMapping = getAnalysisMapping(videoW, videoH);
    const displaySize = Math.min(GUIDE_DISPLAY_RATIO * screenW, GUIDE_MAX_SIZE);
    const guideScreenRadius = (145 / 300) * displaySize;
    const outerRadiusPx = Math.round(guideScreenRadius / videoScale);
    const capturedAt = new Date();
    const mappedCenter = mapAnalysisPointToSavedJpeg(detectionResult.centerX, detectionResult.centerY, analysisMapping);
    const rawOuterRadius = detectionResult.outerRatio * ((145 / 300) * ANALYSIS_SIZE);
    const mappedOuterRadius = mapAnalysisRadiusToSavedJpeg(rawOuterRadius, analysisMapping);
    const filename = createCaptureFilename(mappedCenter.x, mappedCenter.y, mappedOuterRadius);
    const jsonFilename = createJsonFilename(filename);
    const videoTrack = streamRef.current?.getVideoTracks()[0] ?? null;
    const trackSettings = videoTrack?.getSettings();

    const calibration = {
      cx: mappedCenter.x === null ? null : Math.round(mappedCenter.x),
      cy: mappedCenter.y === null ? null : Math.round(mappedCenter.y),
      r: Math.round(mappedOuterRadius),
      center_x: mappedCenter.x === null ? null : Math.round(mappedCenter.x),
      center_y: mappedCenter.y === null ? null : Math.round(mappedCenter.y),
      outer_ratio: detectionResult.outerRatio,
      outer_radius: Math.round(mappedOuterRadius),
      image_width: videoW,
      image_height: videoH,
      coordinate_system: "saved_jpeg_pixels" as const,
      analysis_canvas_width: analysisMapping.analysisWidth,
      analysis_canvas_height: analysisMapping.analysisHeight,
      raw_center_x: detectionResult.centerX === null ? null : Math.round(detectionResult.centerX),
      raw_center_y: detectionResult.centerY === null ? null : Math.round(detectionResult.centerY),
      raw_outer_radius: Math.round(rawOuterRadius),
      confidence: detectionResult.confidence,
      outer_warning: detectionResult.outerWarning,
      can_capture: detectionResult.canCapture,
      message: detectionResult.message,
      chart_diameter_cm: TACHOGRAPH_CHART_DIAMETER_CM,
      timestamp: capturedAt.toISOString(),
      user_agent: navigator.userAgent,
      selected_camera_label: videoTrack?.label || null,
      selected_camera_device_id: trackSettings?.deviceId || null,
      captured_at: capturedAt.toISOString(),
      detection: detectionResult,
      filename,
      json_filename: jsonFilename,
    };

    // canvasで撮影
    const canvas = document.createElement("canvas");
    canvas.width = videoW;
    canvas.height = videoH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setCapturedImage(url);
      setCalibrationData(calibration);

      const history = JSON.parse(localStorage.getItem("tachograph_history") || "[]");
      history.unshift({
        id: Date.now(),
        filename,
        calibration,
        captured_at: calibration.captured_at,
      });
      if (history.length > 20) history.splice(20);
      localStorage.setItem("tachograph_history", JSON.stringify(history));

      streamRef.current?.getTracks().forEach((t) => t.stop());
      setState("captured");
      setSaved(false);
    }, "image/jpeg", 0.95);
  }, [detectionResult, stopAnalysisLoop]);

  const retake = useCallback(() => {
    setCapturedImage(null);
    setSaved(false);
    setCalibrationData(null);
    smoothedDetectionRef.current = null;
    stableCanCaptureRef.current = false;
    captureOkFramesRef.current = 0;
    captureNgFramesRef.current = 0;
    captureEnabledAtRef.current = 0;
    guideGreenStartedAtRef.current = 0;
    guideGreenNgStartedAtRef.current = null;
    detectionFrameRef.current = 0;
    setRawCenter({ x: null, y: null });
    setSelectedCamera({ label: null, deviceId: null, width: null, height: null, facingMode: null });
    setShowGreenGuide(false);
    setDetectionResult(initialDetection);
    setState("idle");
  }, []);

  // チュートリアル表示中
  if (showTutorial) {
    return <Tutorial onDone={() => setShowTutorial(false)} />;
  }

  const colors = guideColors[showGreenGuide ? "ok" : detectionResult.status];
  const isOk = detectionResult.canCapture;
  const markerX = detectionResult.centerX === null ? null : (detectionResult.centerX / ANALYSIS_SIZE) * 300;
  const markerY = detectionResult.centerY === null ? null : (detectionResult.centerY / ANALYSIS_SIZE) * 300;
  const rawOuterRadius = detectionResult.outerRatio * ((145 / 300) * ANALYSIS_SIZE);
  const captureHoldRemainingMs = Math.max(0, Math.round(captureEnabledAtRef.current + CAPTURE_MIN_HOLD_MS - Date.now()));
  const canCaptureBlockReason = getCanCaptureBlockReason(detectionResult, captureOkFramesRef.current);
  const showGreenGuideBlockReason = getShowGreenGuideBlockReason(detectionResult, captureOkFramesRef.current);

  if (state === "idle") {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#0f172a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "24px" }}>
        <p style={{ color: "#94a3b8", fontSize: "14px", textAlign: "center", padding: "0 16px" }}>
          12時位置を画面上側へ、中心を十字へ、外周を円形ガイドへ合わせて撮影してください
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
      <div style={{
        position: "fixed", inset: 0, background: "#0f172a",
        display: "flex", flexDirection: "column",
        alignItems: "center", overflowY: "scroll",
        WebkitOverflowScrolling: "touch",
        padding: "16px 16px 48px", gap: "16px",
      }}>
        <img src={capturedImage} alt="撮影画像"
          style={{ width: "100%", maxWidth: "400px", borderRadius: "12px", flexShrink: 0 }} />
        {calibrationData && (
          <div style={{
            background: "#111827", borderRadius: "12px", padding: "12px 16px",
            maxWidth: "400px", width: "100%", flexShrink: 0,
            border: "1px solid rgba(148,163,184,0.24)",
          }}>
            <p style={{ color: "#94a3b8", fontSize: "11px", margin: "0 0 6px" }}>保存名</p>
            <p style={{ color: "#e2e8f0", fontSize: "12px", margin: 0, wordBreak: "break-all", fontFamily: "monospace" }}>
              {calibrationData.filename}
            </p>
            <button
              onClick={() => navigator.clipboard?.writeText(calibrationData.filename)}
              style={{
                marginTop: "10px", padding: "8px 12px", background: "#334155", color: "white",
                border: "none", borderRadius: "10px", fontSize: "13px",
              }}
            >
              保存名をコピー
            </button>
          </div>
        )}
        {calibrationData && (
          <div style={{
            background: "#111827", borderRadius: "12px", padding: "12px 16px",
            maxWidth: "400px", width: "100%", flexShrink: 0,
            border: "1px solid rgba(148,163,184,0.24)",
          }}>
            <p style={{ color: "#94a3b8", fontSize: "11px", margin: "0 0 6px" }}>JSON保存名</p>
            <p style={{ color: "#e2e8f0", fontSize: "12px", margin: 0, wordBreak: "break-all", fontFamily: "monospace" }}>
              {calibrationData.json_filename}
            </p>
            <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
              <button
                onClick={() => navigator.clipboard?.writeText(JSON.stringify(calibrationData, null, 2))}
                style={{
                  flex: 1, padding: "8px 10px", background: "#334155", color: "white",
                  border: "none", borderRadius: "10px", fontSize: "13px",
                }}
              >
                JSONをコピー
              </button>
              <button
                onClick={() => shareOrDownloadCalibrationJson(calibrationData)}
                style={{
                  flex: 1, padding: "8px 10px", background: "#0f766e", color: "white",
                  border: "none", borderRadius: "10px", fontSize: "13px",
                }}
              >
                JSON保存
              </button>
            </div>
          </div>
        )}
        {calibrationData && (
          <div style={{ background: "#1e293b", borderRadius: "12px", padding: "12px 16px",
            maxWidth: "400px", width: "100%", fontFamily: "monospace", flexShrink: 0 }}>
            <p style={{ color: "#94a3b8", fontSize: "11px", marginBottom: "6px" }}>calibration.json</p>
            <pre style={{ color: "#86efac", fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>
              {JSON.stringify(calibrationData, null, 2)}
            </pre>
          </div>
        )}
        {saved && (
          <div style={{
            background: "#166534", borderRadius: "12px", padding: "14px 16px",
            maxWidth: "400px", width: "100%", flexShrink: 0,
            textAlign: "center",
          }}>
            <p style={{ color: "#86efac", fontSize: "16px", fontWeight: "bold", margin: 0 }}>
              ✅ 保存できました！
            </p>
            <p style={{ color: "#4ade80", fontSize: "12px", margin: "4px 0 0" }}>
              共有またはJPEGダウンロードを開始しました
            </p>
          </div>
        )}
        {calibrationData && (
          <div style={{
            background: "#111827", borderRadius: "12px", padding: "12px 16px",
            maxWidth: "400px", width: "100%", flexShrink: 0,
            border: "1px solid rgba(148,163,184,0.24)",
          }}>
            <p style={{ color: "#e2e8f0", fontSize: "12px", margin: 0, lineHeight: 1.6 }}>
              写真アプリ保存ではファイル名が `IMG_XXXX` に変わる場合があります。
              <br />
              解析用には AirDrop または Files 保存を推奨します。
            </p>
          </div>
        )}
        <div style={{ display: "flex", gap: "12px", width: "100%", maxWidth: "400px", flexShrink: 0 }}>
          <button onClick={retake} style={{
            flex: 1, padding: "14px", background: "#334155", color: "white",
            borderRadius: "12px", border: "none", fontSize: "16px"
          }}>撮り直し</button>
          <button onClick={async () => {
            const filename = calibrationData?.filename ?? createCaptureFilename(null, null, 0);
            await saveJpeg(capturedImage, filename);
            setSaved(true);
          }} style={{
            flex: 1, padding: "14px", background: "#16a34a", color: "white",
            borderRadius: "12px", border: "none", fontSize: "16px"
          }}>📷 写真に保存</button>
        </div>
        {calibrationData && (
          <button
            onClick={async () => {
              await shareAnalysisFiles(capturedImage, calibrationData);
            }}
            style={{
              width: "100%", maxWidth: "400px", padding: "14px",
              background: "#0f766e", color: "white",
              borderRadius: "12px", border: "none", fontSize: "16px", flexShrink: 0,
            }}
          >
            解析用に共有
          </button>
        )}
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

      <div style={{
        position: "absolute",
        top: "calc(env(safe-area-inset-top, 0px) + 8px)",
        left: "8px",
        right: "8px",
        zIndex: 40,
        maxHeight: "32vh",
        overflow: "auto",
        padding: "8px 10px",
        color: "white",
        fontSize: "11px",
        lineHeight: 1.45,
        fontFamily: "monospace",
        wordBreak: "break-all",
        background: "rgba(0,0,0,0.72)",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: "10px",
        textShadow: "0 1px 2px black",
      }}>
        false reason: {canCaptureBlockReason}
        <br />
        showGreen false reason: {showGreenGuide ? "none" : showGreenGuideBlockReason}
        <br />
        detection frames: {detectionFrameRef.current}
        <br />
        canCapture: {String(detectionResult.canCapture)} / showGreenGuide: {String(showGreenGuide)}
        <br />
        stableOkFrames: {captureOkFramesRef.current} / stableNgFrames: {captureNgFramesRef.current}
        <br />
        captureHoldMs: {captureHoldRemainingMs}
        <br />
        raw_center_x: {rawCenter.x === null ? "-" : rawCenter.x.toFixed(1)} / raw_center_y: {rawCenter.y === null ? "-" : rawCenter.y.toFixed(1)}
        <br />
        smoothed_center_x: {detectionResult.centerX === null ? "-" : detectionResult.centerX.toFixed(1)} / smoothed_center_y: {detectionResult.centerY === null ? "-" : detectionResult.centerY.toFixed(1)}
        <br />
        confidence: {detectionResult.confidence.toFixed(2)} / isAligned: {String(detectionResult.isAligned)}
        <br />
        outerRatio: {detectionResult.outerRatio.toFixed(2)} / min: {OUTER_RATIO_MIN.toFixed(2)}
        <br />
        outerWarning: {String(detectionResult.outerWarning)} / isDistanceOk: {String(detectionResult.isDistanceOk)}
        <br />
        rawOuterRadius: {rawOuterRadius.toFixed(1)} / display: {showGreenGuide ? "green" : detectionResult.status === "too_far" ? "yellow" : detectionResult.status === "too_close" ? "red" : "white"}
        <br />
        selected camera label: {selectedCamera.label ?? "-"}
        <br />
        selected deviceId: {selectedCamera.deviceId ?? "-"}
        <br />
        track: {selectedCamera.width ?? "-"}x{selectedCamera.height ?? "-"} / facingMode: {selectedCamera.facingMode ?? "-"}
      </div>

      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 10, pointerEvents: "none" }}>
        <div style={{
          marginBottom: "12px", padding: "8px 20px", borderRadius: "999px",
          background: "rgba(0,0,0,0.55)",
          color: isOk ? "#4ade80" : detectionResult.status === "too_close" ? "#f87171" : detectionResult.status === "too_far" ? "#facc15" : "white",
          fontSize: "15px", fontWeight: "bold", textShadow: "0 1px 4px black",
          transition: "color 0.3s",
        }}>
          {detectionResult.status === "too_close" && "⬆️ "}
          {detectionResult.status === "too_far" && "⬇️ "}
          {isOk && "✅ "}
          {detectionResult.message}
        </div>
        <div style={{
          marginBottom: "10px", padding: "7px 14px", borderRadius: "12px",
          background: "rgba(0,0,0,0.42)",
          color: "rgba(255,255,255,0.86)",
          fontSize: "12px", lineHeight: 1.5, textAlign: "center",
          textShadow: "0 1px 3px black",
        }}>
          12時を上に / 中心を十字に / 外周を円形ガイドに
        </div>

        <div style={{
          position: "relative", width: `${GUIDE_DISPLAY_RATIO * 100}vw`, height: `${GUIDE_DISPLAY_RATIO * 100}vw`, maxWidth: `${GUIDE_MAX_SIZE}px`, maxHeight: `${GUIDE_MAX_SIZE}px`,
          filter: showGreenGuide ? "drop-shadow(0 0 16px rgba(74,222,128,0.7))" : "none",
          transition: "filter 0.3s",
        }}>
          <svg viewBox="0 0 300 300" style={{ width: "100%", height: "100%", overflow: "visible" }}>
            <circle cx="150" cy="150" r="145" fill="none"
              stroke={colors.outer} strokeWidth="3"
              strokeDasharray={showGreenGuide ? "0" : "10 5"} />
            <circle cx="150" cy="150" r="130" fill="none"
              stroke={colors.mid} strokeWidth="2"
              strokeDasharray={showGreenGuide ? "0" : "6 4"} />
            <circle cx="150" cy="150" r="106" fill="none"
              stroke={colors.inner} strokeWidth="2"
              strokeDasharray={showGreenGuide ? "0" : "5 4"} />
            {/* 画面中央の十字補助線 */}
            <line x1="150" y1="0" x2="150" y2="300" stroke="rgba(255,255,255,0.62)" strokeWidth="1.5" strokeDasharray="7,7" />
            <line x1="0" y1="150" x2="300" y2="150" stroke="rgba(255,255,255,0.62)" strokeWidth="1.5" strokeDasharray="7,7" />
            <line x1="130" y1="150" x2="170" y2="150" stroke="white" strokeWidth="2.5" />
            <line x1="150" y1="130" x2="150" y2="170" stroke="white" strokeWidth="2.5" />
            {markerX !== null && markerY !== null && (
              <>
                <line x1={markerX - 12} y1={markerY} x2={markerX + 12} y2={markerY} stroke="#fb7185" strokeWidth="2.5" />
                <line x1={markerX} y1={markerY - 12} x2={markerX} y2={markerY + 12} stroke="#fb7185" strokeWidth="2.5" />
                <circle cx={markerX} cy={markerY} r="7" fill="none" stroke="#fb7185" strokeWidth="2.5" />
                <line x1="150" y1="150" x2={markerX} y2={markerY} stroke="#fb7185" strokeWidth="1.5" opacity={0.8} strokeDasharray="3,3" />
              </>
            )}
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
          外周位置: {(detectionResult.outerRatio * 100).toFixed(1)}% / 中心信頼度: {(detectionResult.confidence * 100).toFixed(0)}%
        </div>
      </div>

      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20,
        padding: "24px 24px 48px",
        background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
        display: "flex", flexDirection: "column", alignItems: "center",
        opacity: 1,
        pointerEvents: "auto",
        transition: "opacity 0.3s",
      }}>
        <button onClick={doCapture} disabled={!isOk} style={{
          width: "100%", maxWidth: "320px", padding: "18px",
          background: isOk ? "#16a34a" : "#334155", color: isOk ? "white" : "#94a3b8",
          borderRadius: "16px", fontSize: "20px", fontWeight: "bold", border: "none",
          boxShadow: isOk ? "0 4px 24px rgba(22,163,74,0.6)" : "none",
        }}>
          📸 撮影する
        </button>
      </div>

      <canvas ref={analysisCanvasRef} style={{ display: "none" }} />
      <canvas ref={captureCanvasRef} style={{ display: "none" }} />
    </div>
  );
}
