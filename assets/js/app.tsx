import "phoenix_html";
import React from "react";
import { createRoot } from "react-dom/client";

import { SchemaApp } from "./schema_app";

document.querySelectorAll<HTMLElement>("[role=alert][data-flash]").forEach((element) => {
  element.addEventListener("click", () => {
    element.setAttribute("hidden", "");
  });
});

const schemaAppRoot = document.getElementById("schema-app");

if (schemaAppRoot instanceof HTMLDivElement) {
  createRoot(schemaAppRoot).render(
    <React.StrictMode>
      <SchemaApp schemaCode={schemaAppRoot.dataset.schemaCode ?? "local"} />
    </React.StrictMode>
  );
}
