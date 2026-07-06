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
    icons: [
      {
        src: "/icon.png",
        sizes: "1000x1000",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable.png",
        sizes: "1250x1250",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
