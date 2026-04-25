import type { Device } from "./PreviewToolbar";
import type { ReactNode } from "react";

const DIM: Record<Exclude<Device, "fluid">, { w: number; h: number; radius: number; bezel: number }> = {
  desktop: { w: 1280, h: 800, radius: 8, bezel: 16 },
  tablet: { w: 768, h: 1024, radius: 28, bezel: 24 },
  phone: { w: 393, h: 852, radius: 42, bezel: 12 },
};

export function DeviceFrame({
  device,
  zoom,
  children,
}: {
  device: Device;
  zoom: number;
  children: ReactNode;
}) {
  if (device === "fluid") {
    return <div className="device device-fluid">{children}</div>;
  }
  const dim = DIM[device];
  return (
    <div
      className={"device device-" + device}
      style={{
        width: dim.w * zoom + dim.bezel * 2,
        height: dim.h * zoom + dim.bezel * 2,
        padding: dim.bezel,
        borderRadius: dim.radius + dim.bezel,
      }}
    >
      <div
        className="device-screen"
        style={{
          width: dim.w * zoom,
          height: dim.h * zoom,
          borderRadius: dim.radius,
        }}
      >
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
            width: dim.w,
            height: dim.h,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
