/// <reference types="vite/client" />

import type React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        alt?: string;
        "auto-rotate"?: boolean | string;
        "camera-orbit"?: string;
        "camera-controls"?: boolean | string;
        "camera-target"?: string;
        class?: string;
        exposure?: string;
        "field-of-view"?: string;
        "environment-image"?: string;
        "shadow-intensity"?: string;
        src?: string;
      };
    }
  }
}
