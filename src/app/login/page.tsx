"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { cookieUtils } from "@/utils/cookie";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState("");

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (username === "admin" && password === "admin") {
      cookieUtils.setSession(username, "ai_agent_auth_token_example");
      router.replace("/");
      return;
    }

    setError("账号或密码错误，请重试！");
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <section className="relative hidden flex-1 overflow-hidden bg-gradient-to-br from-blue-900 to-blue-700 p-10 text-white md:flex md:flex-col md:items-center md:justify-center">
        <div className="z-10 max-w-xl text-center">
          <h1 className="mb-4 text-5xl font-bold tracking-wide">EasyAgent平台</h1>
          <p className="mb-8 text-lg text-blue-100">
            探索更高效的智能体协作方式，帮助你完成复杂任务并提升工作效率。
          </p>
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
          <p className="mb-8 text-gray-500">请输入账号和密码进入 EasyAgent 平台</p>

          <form className="space-y-5" onSubmit={onSubmit}>
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700" htmlFor="username">
                账号
              </label>
              <input
                id="username"
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700" htmlFor="password">
                密码
              </label>
              <input
                id="password"
                type="password"
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error ? (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-500">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              className="mt-2 w-full rounded-lg bg-blue-700 py-3 text-base font-semibold text-white shadow hover:bg-blue-800"
            >
              登录
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
