/**
 * 接口配置模块：统一拼接 API 基础地址与前缀。
 */
const runtimeBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (typeof window !== "undefined"
    ? (window as Window & { __ENV?: { NEXT_PUBLIC_API_BASE_URL?: string } }).__ENV?.NEXT_PUBLIC_API_BASE_URL
    : undefined) ||
  (typeof window !== "undefined" ? window.location.origin : "");

export const API_CONFIG = {
  // Can be overridden by .env or public/env-config.js
  baseUrl: runtimeBaseUrl,
  prefix: "/api/v1",
};

export const buildApiUrl = (path: string): string => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!API_CONFIG.baseUrl) {
    return `${API_CONFIG.prefix}${normalizedPath}`;
  }
  return `${API_CONFIG.baseUrl}${API_CONFIG.prefix}${normalizedPath}`;
};
