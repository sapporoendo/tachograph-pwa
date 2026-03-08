"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface HistoryItem {
  id: number;
  filename: string;
  dataUrl: string;
  calibration: {
    center_x: number;
    center_y: number;
    outer_radius: number;
    image_width: number;
    image_height: number;
  };
  captured_at: string;
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const router = useRouter();

  useEffect(() => {
    const raw = localStorage.getItem("tachograph_history");
    if (raw) setItems(JSON.parse(raw));
  }, []);

  const deleteItem = (id: number) => {
    const updated = items.filter((i) => i.id !== id);
    setItems(updated);
    localStorage.setItem("tachograph_history", JSON.stringify(updated));
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f172a",
        color: "#f1f5f9",
        fontFamily: "'Noto Sans JP', sans-serif",
        padding: "24px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button
          onClick={() => router.push("/")}
          style={{
            background: "#1e293b",
            border: "none",
            color: "#94a3b8",
            borderRadius: 10,
            padding: "8px 14px",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          ← 戻る
        </button>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>撮影履歴</h1>
        <span style={{ fontSize: 13, color: "#64748b" }}>{items.length}件</span>
      </div>

      {items.length === 0 && (
        <p style={{ color: "#64748b", textAlign: "center", marginTop: 80 }}>撮影履歴がありません</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              background: "#1e293b",
              borderRadius: 16,
              overflow: "hidden",
              display: "flex",
              gap: 12,
              padding: 12,
              alignItems: "flex-start",
            }}
          >
            <img
              src={item.dataUrl}
              alt="撮影画像"
              style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 10, flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
                {new Date(item.captured_at).toLocaleString("ja-JP")}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 12, color: "#86efac", lineHeight: 1.8 }}>
                cx: {item.calibration.center_x}
                <br />
                cy: {item.calibration.center_y}
                <br />
                r: {item.calibration.outer_radius}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#475569",
                  marginTop: 4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.filename}
              </div>
            </div>
            <button
              onClick={() => deleteItem(item.id)}
              style={{
                background: "none",
                border: "none",
                color: "#ef4444",
                fontSize: 18,
                cursor: "pointer",
                padding: "4px 8px",
                flexShrink: 0,
              }}
            >
              🗑
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
