import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ganpati Enterprises — Order Capture",
    short_name: "Ganpati Orders",
    description: "Direct sales order capture for Ganpati Enterprises",
    start_url: "/",
    display: "standalone",
    background_color: "#F2F3F5",
    theme_color: "#14181F",
    // Plain static public/ icons at the standard sizes — Google's WebAPK
    // minter reliably fetches these (the previous 1000/1250 oddballs via the
    // app-icon convention were part of why installs fell back to a shortcut).
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
