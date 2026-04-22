"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { agentService } from "@/api/agent";
import { cookieUtils } from "@/utils/cookie";

type AuthMode = "login" | "register";

const SUCCESS_CODE = "0000";
const AUTH_TIMEOUT_MS = 15000;

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("请求超时，请重试")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const session = cookieUtils.getSession();
    if (session.isLoggedIn === "true" && session.username) {
      router.replace("/");
    }
  }, [router]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setError("");

    const userId = username.trim();
    if (!userId) {
      setError("请输入账号");
      return;
    }
    if (!password) {
      setError("请输入密码");
      return;
    }

    setSubmitting(true);
    try {
      const response =
        mode === "register"
          ? await withTimeout(
              agentService.userRegister({
                userId,
                password,
                nickname: nickname.trim() || userId,
              }),
              AUTH_TIMEOUT_MS,
            )
          : await withTimeout(
              agentService.userLogin({
                userId,
                password,
              }),
              AUTH_TIMEOUT_MS,
            );

      if (response.code !== SUCCESS_CODE || !response.data?.token || !response.data?.userId) {
        throw new Error(response.info || (mode === "register" ? "注册失败" : "登录失败"));
      }

      cookieUtils.setSession(response.data.userId, response.data.token);

      // 强制刷新跳转，避免 App Router 状态异常导致停留在“提交中...”
      window.location.assign("/");
      return;
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : mode === "register" ? "注册失败，请重试" : "登录失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError("");
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <section className="relative hidden flex-1 overflow-hidden bg-gradient-to-br from-blue-900 to-blue-700 p-10 text-white md:flex md:flex-col md:items-center md:justify-center">
        <div className="z-10 max-w-xl text-center">
          <h1 className="mb-4 text-5xl font-bold tracking-wide">EasyAgent 平台</h1>
          <p className="mb-8 text-lg text-blue-100">探索更高效的智能体协作方式，帮助你完成复杂任务并提升工作效率。</p>
          <div
            className="mx-auto h-72 w-full max-w-xl rounded-2xl border border-white/10 bg-cover bg-center shadow-2xl"
            style={{
              backgroundImage:
                "url('https://images.unsplash.com/photo-1677442136019-21780ecad995?q=80&w=1000&auto=format&fit=crop')",
            }}
          />
        </div>
      </section>

      <section className="flex flex-1 items-center justify-center bg-white">
        <div className="w-full max-w-md p-10">
          <h2 className="mb-2 text-4xl font-semibold text-gray-800">欢迎登录</h2>
          <p className="mb-6 text-gray-500">请输入账号和密码进入 EasyAgent 平台</p>

          <div className="mb-6 inline-flex w-full rounded-lg border border-gray-200 bg-gray-50 p-1">
            <button
              type="button"
              onClick={() => switchMode("login")}
              className={`w-1/2 rounded-md py-2 text-sm font-medium transition ${
                mode === "login" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => switchMode("register")}
              className={`w-1/2 rounded-md py-2 text-sm font-medium transition ${
                mode === "register" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              注册
            </button>
          </div>

          <form className="space-y-5" onSubmit={onSubmit}>
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700" htmlFor="username">
                账号
              </label>
              <input
                id="username"
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>

            {mode === "register" ? (
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700" htmlFor="nickname">
                  昵称
                </label>
                <input
                  id="nickname"
                  className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="可选，不填默认使用账号"
                />
              </div>
            ) : null}

            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700" htmlFor="password">
                密码
              </label>
              <input
                id="password"
                type="password"
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
                placeholder={mode === "register" ? "至少 6 位" : ""}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            <p className="text-xs text-gray-400">账号规则：3-32 位字母/数字/_/-，不区分大小写。</p>

            {error ? (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-500">{error}</div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className={`mt-2 w-full rounded-lg py-3 text-base font-semibold text-white shadow ${
                submitting ? "cursor-not-allowed bg-blue-300" : "bg-blue-700 hover:bg-blue-800"
              }`}
            >
              {submitting ? "提交中..." : mode === "register" ? "注册并登录" : "登录"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
