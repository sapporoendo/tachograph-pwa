import CameraView from "@/components/CameraView";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-slate-900">
      <h1 className="text-xl font-bold mb-6 text-slate-100 tracking-wide">
        タコグラフ撮影
      </h1>
      <CameraView />
    </main>
  );
}
