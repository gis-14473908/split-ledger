import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "分账本",
    short_name: "分账本",
    description: "导入银行账单，和同学分账",
    start_url: "/",
    display: "standalone",
    background_color: "#e9edf3",
    theme_color: "#2346d8",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
