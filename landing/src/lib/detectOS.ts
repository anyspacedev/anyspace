export type OSName = "macOS" | "Windows" | "Linux" | "Unknown";

export function detectOS(): OSName {
  if (typeof navigator === "undefined") return "Unknown";
  const ua = navigator.userAgent || "";
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? "";
  const hay = `${platform} ${ua}`.toLowerCase();
  if (hay.includes("mac")) return "macOS";
  if (hay.includes("win")) return "Windows";
  if (hay.includes("linux")) return "Linux";
  return "Unknown";
}

export function downloadLabel(os: OSName): string {
  switch (os) {
    case "macOS":
      return "Download for macOS";
    case "Windows":
      return "Download for Windows";
    case "Linux":
      return "Download for Linux";
    default:
      return "Download";
  }
}
