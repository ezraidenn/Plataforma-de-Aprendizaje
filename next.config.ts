import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    // Hay un package-lock.json suelto en el home; fijamos la raíz al proyecto
    root: path.join(__dirname),
  },
  // better-sqlite3 y argon2 son módulos nativos: no deben empaquetarse
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2"],
};

export default nextConfig;
