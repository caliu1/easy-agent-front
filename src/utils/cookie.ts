import Cookies from "js-cookie";

const COOKIE_KEYS = {
  isLoggedIn: "isLoggedIn",
  username: "username",
  token: "token",
} as const;

export const cookieUtils = {
  setSession(username: string, token: string, days = 7): void {
    Cookies.set(COOKIE_KEYS.isLoggedIn, "true", { expires: days, path: "/" });
    Cookies.set(COOKIE_KEYS.username, username, { expires: days, path: "/" });
    Cookies.set(COOKIE_KEYS.token, token, { expires: days, path: "/" });
  },

  getSession(): { isLoggedIn?: string; username?: string; token?: string } {
    return {
      isLoggedIn: Cookies.get(COOKIE_KEYS.isLoggedIn),
      username: Cookies.get(COOKIE_KEYS.username),
      token: Cookies.get(COOKIE_KEYS.token),
    };
  },

  clearSession(): void {
    Cookies.remove(COOKIE_KEYS.isLoggedIn, { path: "/" });
    Cookies.remove(COOKIE_KEYS.username, { path: "/" });
    Cookies.remove(COOKIE_KEYS.token, { path: "/" });
  },
};
