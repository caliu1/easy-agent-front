"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Ellipsis, Heart, Loader2, LogOut, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { agentService } from "@/api/agent";
import { cookieUtils } from "@/utils/cookie";
import type { AgentConfigSummaryResponseDTO } from "@/types/api";

const SUCCESS_CODE = "0000";
const STATUS_PUBLISHED = "PUBLISHED";
const PLAZA_ON = "ON";
const SOURCE_OFFICIAL = "OFFICIAL";

type Notice = {
  type: "success" | "error" | "info";
  text: string;
};

type ViewTab = "my" | "subscribed" | "plaza";

const formatIdLabel = (agentId: string) => {
  if (!agentId) return "-";
  if (agentId.length <= 3) return agentId;
  return `${agentId.slice(0, 3)}-${agentId.slice(3)}`;
};

const formatStatusText = (status?: string) => {
  if (status === "DRAFT") return "草稿";
  if (status === "PUBLISHED") return "已发布";
  if (status === "OFFLINE") return "已下线";
  return status || "未知";
};

const canOpenChat = (agent: AgentConfigSummaryResponseDTO) => {
  return agent.status === STATUS_PUBLISHED || (agent.publishedVersion ?? 0) > 0;
};

export default function MyAgentPage() {
  const router = useRouter();

  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyAgentId, setBusyAgentId] = useState("");
  const [openMenuAgentId, setOpenMenuAgentId] = useState("");
  const [activeTab, setActiveTab] = useState<ViewTab>("my");
  const [myAgents, setMyAgents] = useState<AgentConfigSummaryResponseDTO[]>([]);
  const [plazaAgents, setPlazaAgents] = useState<AgentConfigSummaryResponseDTO[]>([]);
  const [subscribedAgents, setSubscribedAgents] = useState<AgentConfigSummaryResponseDTO[]>([]);

  const avatarPalette = useMemo(
    () => [
      "from-blue-200 to-blue-300",
      "from-emerald-200 to-emerald-300",
      "from-indigo-200 to-indigo-300",
      "from-cyan-200 to-cyan-300",
      "from-sky-200 to-sky-300",
      "from-violet-200 to-violet-300",
    ],
    [],
  );

  const showNotice = useCallback((type: Notice["type"], text: string) => {
    if (typeof window === "undefined") return;

    const titleMap: Record<Notice["type"], string> = {
      success: "成功",
      error: "失败",
      info: "提示",
    };
    const title = `EasyAgent平台 - ${titleMap[type]}`;

    // 使用浏览器原生通知，2 秒后自动关闭；不再在页面中显示提示条。
    const pushNotification = () => {
      const notification = new Notification(title, {
        body: text,
        icon: "/favicon.ico",
      });
      window.setTimeout(() => notification.close(), 2000);
    };

    if (!("Notification" in window)) return;

    if (Notification.permission === "granted") {
      pushNotification();
      return;
    }

    if (Notification.permission !== "denied") {
      void Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
          pushNotification();
        }
      });
    }
  }, []);

  const loadAgents = useCallback(
    async (currentUserId: string) => {
      setLoading(true);
      try {
        const [myResponse, plazaResponse, subscribeResponse] = await Promise.all([
          agentService.queryMyAgentConfigList(currentUserId),
          agentService.queryAgentPlazaList(),
          agentService.queryMySubscribedAgentConfigList(currentUserId),
        ]);

        if (myResponse.code !== SUCCESS_CODE) {
          throw new Error(myResponse.info || "加载我的Agent失败");
        }
        if (plazaResponse.code !== SUCCESS_CODE) {
          throw new Error(plazaResponse.info || "加载Agent广场失败");
        }
        if (subscribeResponse.code !== SUCCESS_CODE) {
          throw new Error(subscribeResponse.info || "加载我的订阅失败");
        }

        setMyAgents(myResponse.data ?? []);
        setPlazaAgents(plazaResponse.data ?? []);
        setSubscribedAgents(subscribeResponse.data ?? []);
      } catch (error) {
        console.error(error);
        showNotice("error", error instanceof Error ? error.message : "加载Agent列表失败");
      } finally {
        setLoading(false);
      }
    },
    [showNotice],
  );

  const withBusyAgent = useCallback(async (agentId: string, action: () => Promise<void>) => {
    setBusyAgentId(agentId);
    try {
      await action();
    } finally {
      setBusyAgentId("");
    }
  }, []);

  const refreshAll = useCallback(async () => {
    if (!userId) return;
    await loadAgents(userId);
  }, [loadAgents, userId]);

  const subscribedAgentIdSet = useMemo(() => {
    return new Set(subscribedAgents.map((item) => item.agentId));
  }, [subscribedAgents]);

  const handleOpenChat = (agent: AgentConfigSummaryResponseDTO) => {
    if (!canOpenChat(agent)) {
      showNotice("info", "该Agent尚未发布运行，暂不可进入会话");
      return;
    }
    router.push(`/chat?agentId=${encodeURIComponent(agent.agentId)}`);
  };

  const handleToggleSubscribe = async (agent: AgentConfigSummaryResponseDTO) => {
    if (!userId) return;
    const isSubscribed = subscribedAgentIdSet.has(agent.agentId);
    await withBusyAgent(agent.agentId, async () => {
      try {
        const response = isSubscribed
          ? await agentService.unsubscribeAgentConfig({
              userId,
              agentId: agent.agentId,
            })
          : await agentService.subscribeAgentConfig({
              userId,
              agentId: agent.agentId,
            });

        if (response.code !== SUCCESS_CODE) {
          throw new Error(response.info || (isSubscribed ? "取消订阅失败" : "订阅失败"));
        }

        showNotice("success", isSubscribed ? `已取消订阅：${agent.agentName}` : `已订阅：${agent.agentName}`);
        await refreshAll();
      } catch (error) {
        console.error(error);
        showNotice("error", error instanceof Error ? error.message : isSubscribed ? "取消订阅失败" : "订阅失败");
      }
    });
  };

  const handleQuickUpdateAgent = async (agent: AgentConfigSummaryResponseDTO) => {
    await withBusyAgent(agent.agentId, async () => {
      try {
        const detailResponse = await agentService.queryAgentConfigDetail(agent.agentId);
        if (detailResponse.code !== SUCCESS_CODE || !detailResponse.data) {
          throw new Error(detailResponse.info || "查询Agent详情失败");
        }

        const detail = detailResponse.data;
        const nextName = window.prompt("请输入新的Agent名称", detail.agentName || agent.agentName || "");
        if (nextName === null) return;

        const nextDesc = window.prompt("请输入新的Agent描述", detail.agentDesc || agent.agentDesc || "");
        if (nextDesc === null) return;

        const agentName = nextName.trim();
        if (!agentName) {
          showNotice("error", "Agent名称不能为空");
          return;
        }

        const rawConfigJson = detail.configJson?.trim() || "";
        if (!rawConfigJson) {
          throw new Error("当前Agent缺少configJson，无法更新");
        }

        const normalizedConfigJson = JSON.stringify(JSON.parse(rawConfigJson));
        const response = await agentService.updateAgentConfig({
          agentId: detail.agentId,
          appName: detail.appName,
          agentName,
          agentDesc: nextDesc.trim(),
          configJson: normalizedConfigJson,
          operator: userId || "admin",
        });

        if (response.code !== SUCCESS_CODE || !response.data) {
          throw new Error(response.info || "更新失败");
        }

        showNotice("success", `已更新：${agentName}`);
        await refreshAll();
      } catch (error) {
        console.error(error);
        showNotice("error", error instanceof Error ? error.message : "更新失败");
      }
    });
  };

  const handlePublishAgent = async (agent: AgentConfigSummaryResponseDTO) => {
    await withBusyAgent(agent.agentId, async () => {
      try {
        const response = await agentService.publishAgentConfig({
          agentId: agent.agentId,
          operator: userId || "admin",
        });
        if (response.code !== SUCCESS_CODE || !response.data) {
          throw new Error(response.info || "发布失败");
        }

        showNotice("success", `已发布运行：${agent.agentName}`);
        await refreshAll();
      } catch (error) {
        console.error(error);
        showNotice("error", error instanceof Error ? error.message : "发布失败");
      }
    });
  };

  const handleOfflineAgent = async (agent: AgentConfigSummaryResponseDTO) => {
    await withBusyAgent(agent.agentId, async () => {
      try {
        const response = await agentService.offlineAgentConfig({
          agentId: agent.agentId,
          operator: userId || "admin",
        });
        if (response.code !== SUCCESS_CODE || !response.data) {
          throw new Error(response.info || "下线失败");
        }

        showNotice("success", `已下线：${agent.agentName}`);
        await refreshAll();
      } catch (error) {
        console.error(error);
        showNotice("error", error instanceof Error ? error.message : "下线失败");
      }
    });
  };

  const handleRollbackAgent = async (agent: AgentConfigSummaryResponseDTO) => {
    const raw = window.prompt("请输入回滚版本号（正整数）", "1");
    if (!raw) return;

    const targetVersion = Number(raw);
    if (!Number.isInteger(targetVersion) || targetVersion <= 0) {
      showNotice("error", "版本号必须为正整数");
      return;
    }

    await withBusyAgent(agent.agentId, async () => {
      try {
        const response = await agentService.rollbackAgentConfig({
          agentId: agent.agentId,
          targetVersion,
          operator: userId || "admin",
        });
        if (response.code !== SUCCESS_CODE || !response.data) {
          throw new Error(response.info || "回滚失败");
        }

        showNotice("success", `已回滚到版本 ${targetVersion}：${agent.agentName}`);
        await refreshAll();
      } catch (error) {
        console.error(error);
        showNotice("error", error instanceof Error ? error.message : "回滚失败");
      }
    });
  };

  const handleDeleteAgent = async (agent: AgentConfigSummaryResponseDTO) => {
    if (!window.confirm(`确认删除 Agent「${agent.agentName}」?`)) {
      return;
    }

    await withBusyAgent(agent.agentId, async () => {
      try {
        const response = await agentService.deleteAgentConfig({
          agentId: agent.agentId,
          operator: userId || "admin",
        });
        if (response.code !== SUCCESS_CODE) {
          throw new Error(response.info || "删除失败");
        }

        // 删除成功后先本地移除，避免用户看到“已删除”但卡片仍停留在页面上。
        setMyAgents((prev) => prev.filter((item) => item.agentId !== agent.agentId));
        setPlazaAgents((prev) => prev.filter((item) => item.agentId !== agent.agentId));
        setSubscribedAgents((prev) => prev.filter((item) => item.agentId !== agent.agentId));
        setOpenMenuAgentId((prev) => (prev === agent.agentId ? "" : prev));
        showNotice("success", `已删除Agent：${agent.agentName}`);
      } catch (error) {
        console.error(error);
        showNotice("error", error instanceof Error ? error.message : "删除失败");
      }
    });
  };

  const handlePublishToPlaza = async (agent: AgentConfigSummaryResponseDTO) => {
    await withBusyAgent(agent.agentId, async () => {
      try {
        const response = await agentService.publishAgentToPlaza({
          agentId: agent.agentId,
          operator: userId || "admin",
        });
        if (response.code !== SUCCESS_CODE || !response.data) {
          throw new Error(response.info || "发布到广场失败");
        }

        showNotice("success", `已发布到广场：${agent.agentName}`);
        await refreshAll();
      } catch (error) {
        console.error(error);
        showNotice("error", error instanceof Error ? error.message : "发布到广场失败");
      }
    });
  };

  const handleUnpublishFromPlaza = async (agent: AgentConfigSummaryResponseDTO) => {
    await withBusyAgent(agent.agentId, async () => {
      try {
        const response = await agentService.unpublishAgentFromPlaza({
          agentId: agent.agentId,
          operator: userId || "admin",
        });
        if (response.code !== SUCCESS_CODE || !response.data) {
          throw new Error(response.info || "从广场下架失败");
        }

        showNotice("success", `已从广场下架：${agent.agentName}`);
        await refreshAll();
      } catch (error) {
        console.error(error);
        showNotice("error", error instanceof Error ? error.message : "从广场下架失败");
      }
    });
  };

  useEffect(() => {
    const session = cookieUtils.getSession();
    if (session.isLoggedIn !== "true" || !session.username) {
      router.replace("/login");
      return;
    }

    const currentUser = session.username;
    setUserId(currentUser);
    void loadAgents(currentUser);
  }, [loadAgents, router]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const inMenu = target.closest("[data-agent-menu-root='true']");
      if (!inMenu) {
        setOpenMenuAgentId("");
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, []);

  useEffect(() => {
    setOpenMenuAgentId("");
  }, [activeTab]);

  const renderAgentCard = (
    agent: AgentConfigSummaryResponseDTO,
    index: number,
    options?: { allowManage?: boolean; showSubscribeAction?: boolean },
  ) => {
    const allowManage = options?.allowManage ?? false;
    const showSubscribeAction = options?.showSubscribeAction ?? false;
    const gradient = avatarPalette[index % avatarPalette.length];
    const initial = (agent.agentName?.trim()?.[0] || "A").toUpperCase();
    const isMenuOpen = openMenuAgentId === agent.agentId;
    const isBusy = busyAgentId === agent.agentId;
    const inPlaza = agent.plazaStatus === PLAZA_ON;
    const isSubscribed = subscribedAgentIdSet.has(agent.agentId);

    return (
      <article
        key={agent.agentId}
        className="relative rounded-3xl border border-zinc-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
      >
        <button type="button" onClick={() => handleOpenChat(agent)} className="w-full text-left">
          <div className="mb-4 flex items-start justify-between">
            <div
              className={`flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br ${gradient} text-2xl font-semibold text-zinc-800`}
            >
              {initial}
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500">
                {formatStatusText(agent.status)}
              </span>
              {agent.sourceType === SOURCE_OFFICIAL ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">官方</span>
              ) : null}
              {inPlaza ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-700">广场中</span> : null}
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <Bot size={14} />
              </div>
            </div>
          </div>
          <p className="text-5xl font-semibold tracking-tight text-zinc-900">{agent.agentName || "未命名Agent"}</p>
          <p className="mt-1 text-xs text-zinc-400">编号：{formatIdLabel(agent.agentId)}</p>
          <p className="mt-3 line-clamp-2 text-sm leading-6 text-zinc-500">{agent.agentDesc || "暂无描述"}</p>
          <p className="mt-1 text-xs text-zinc-400">作者：{agent.ownerUserId || userId || "admin"}</p>
        </button>

        {showSubscribeAction ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleToggleSubscribe(agent);
            }}
            disabled={isBusy}
            className={`absolute bottom-4 right-4 inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition ${
              isSubscribed
                ? "border-rose-200 bg-rose-50 text-rose-500 hover:bg-rose-100"
                : "border-zinc-200 bg-white text-zinc-400 hover:bg-zinc-100 hover:text-rose-400"
            } ${isBusy ? "cursor-not-allowed opacity-60" : ""}`}
            aria-label={isSubscribed ? "unsubscribe-agent" : "subscribe-agent"}
            title={isSubscribed ? "取消订阅" : "订阅Agent"}
          >
            {isBusy ? <Loader2 size={16} className="animate-spin" /> : <Heart size={16} fill={isSubscribed ? "currentColor" : "none"} />}
          </button>
        ) : null}

        {allowManage ? (
          <div className="absolute bottom-4 right-4" data-agent-menu-root="true">
            <div className="relative">
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpenMenuAgentId((prev) => (prev === agent.agentId ? "" : agent.agentId));
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-sm hover:bg-zinc-100"
                aria-label="agent-actions"
              >
                <Ellipsis size={16} />
              </button>

              {isMenuOpen ? (
                <div className="absolute bottom-0 right-0 z-30 w-56 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handleQuickUpdateAgent(agent);
                    }}
                    disabled={isBusy}
                    className="inline-flex w-full items-center gap-1 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
                  >
                    {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
                    快速更新
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handlePublishAgent(agent);
                    }}
                    disabled={isBusy}
                    className="inline-flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
                  >
                    发布运行
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handleOfflineAgent(agent);
                    }}
                    disabled={isBusy}
                    className="inline-flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
                  >
                    下线运行
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handleRollbackAgent(agent);
                    }}
                    disabled={isBusy}
                    className="inline-flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
                  >
                    回滚版本
                  </button>
                  {inPlaza ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void handleUnpublishFromPlaza(agent);
                      }}
                      disabled={isBusy}
                      className="inline-flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                    >
                      从广场下架
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void handlePublishToPlaza(agent);
                      }}
                      disabled={isBusy}
                      className="inline-flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                    >
                      发布到广场
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handleDeleteAgent(agent);
                    }}
                    disabled={isBusy}
                    className="inline-flex w-full items-center gap-1 rounded-lg px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                  >
                    {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    删除
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => handleOpenChat(agent)}
          className="mt-4 inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
        >
          <Sparkles size={12} />
          点击进入会话
        </button>
      </article>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-zinc-100 to-slate-200 text-zinc-900">
      <div className="mx-auto w-full max-w-[1360px] px-6 py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <h1 className="text-6xl font-semibold tracking-tight">EasyAgent</h1>
              <span className="h-3.5 w-3.5 rounded-full bg-blue-500" />
            </div>
            <div className="inline-flex rounded-2xl border border-zinc-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setActiveTab("my")}
                className={`rounded-xl px-5 py-2 text-sm font-medium transition ${
                  activeTab === "my" ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                我的Agent
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("subscribed")}
                className={`rounded-xl px-5 py-2 text-sm font-medium transition ${
                  activeTab === "subscribed" ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                我的订阅
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("plaza")}
                className={`rounded-xl px-5 py-2 text-sm font-medium transition ${
                  activeTab === "plaza" ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                Agent广场
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              cookieUtils.clearSession();
              router.replace("/login");
            }}
            className="inline-flex items-center gap-1 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-100"
          >
            <LogOut size={14} />
            退出
          </button>
        </div>

        {loading ? (
          <div className="flex min-h-40 items-center justify-center rounded-2xl border border-zinc-200 bg-white/70 text-zinc-500">
            <Loader2 className="mr-2 animate-spin" size={18} />
            正在加载Agent列表...
          </div>
        ) : activeTab === "my" ? (
          <section>
            <p className="mb-5 text-3xl font-medium text-zinc-700">我创建的Agent</p>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
              <button
                type="button"
                onClick={() => router.push("/agent-create")}
                className="group flex min-h-[290px] flex-col justify-center rounded-3xl border border-dashed border-blue-300 bg-white/80 p-8 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md"
              >
                <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-blue-600">
                  <Plus size={24} />
                </div>
                <p className="text-5xl font-semibold text-zinc-900">新建Agent</p>
                <p className="mt-3 text-sm leading-6 text-zinc-500">点击卡片进入新建页面，创建后可按需发布到广场。</p>
              </button>

              {myAgents.map((agent, index) => renderAgentCard(agent, index, { allowManage: true }))}

              {!myAgents.length ? (
                <div className="col-span-full rounded-2xl border border-zinc-200 bg-white/70 px-5 py-10 text-center text-zinc-500">
                  暂无你创建的Agent，点击左侧“新建Agent”开始创建。
                </div>
              ) : null}
            </div>
          </section>
        ) : activeTab === "subscribed" ? (
          <section>
            <p className="mb-5 text-3xl font-medium text-zinc-700">我订阅的Agent</p>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {subscribedAgents.map((agent, index) =>
                renderAgentCard(agent, index, { showSubscribeAction: true }),
              )}

              {!subscribedAgents.length ? (
                <div className="col-span-full rounded-2xl border border-zinc-200 bg-white/70 px-5 py-10 text-center text-zinc-500">
                  暂无订阅，去 Agent 广场点亮右下角爱心即可收藏。
                </div>
              ) : null}
            </div>
          </section>
        ) : (
          <section>
            <p className="mb-5 text-3xl font-medium text-zinc-700">Agent广场</p>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {plazaAgents.map((agent, index) => renderAgentCard(agent, index, { showSubscribeAction: true }))}

              {!plazaAgents.length ? (
                <div className="col-span-full rounded-2xl border border-zinc-200 bg-white/70 px-5 py-10 text-center text-zinc-500">
                  广场暂无可用Agent。
                </div>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
