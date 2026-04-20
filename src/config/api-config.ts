export const API_CONFIG = {
  // 可通过 .env 或 public/env-config.js 覆盖
  baseUrl:
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    (typeof window !== "undefined" && (window as Window & { __ENV?: { NEXT_PUBLIC_API_BASE_URL?: string } }).__ENV?.NEXT_PUBLIC_API_BASE_URL) ||
    "http://127.0.0.1:8091",
  prefix: "/api/v1",
};

export const buildApiUrl = (path: string): string => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_CONFIG.baseUrl}${API_CONFIG.prefix}${normalizedPath}`;
};
