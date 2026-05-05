"use client";

/**
 * 首页（我的 Agent）：展示我的 Agent、订阅与广场入口。
 */


import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Circle, Ellipsis, Heart, Loader2, LogOut, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { agentService } from "@/api/agent";
import { cookieUtils } from "@/utils/cookie";
import type {
  AgentConfigSummaryResponseDTO,
  AgentMcpProfileResponseDTO,
  AgentSkillProfileResponseDTO,
} from "@/types/api";

const SUCCESS_CODE = "0000";
const STATUS_PUBLISHED = "PUBLISHED";
const PLAZA_ON = "ON";
const SOURCE_OFFICIAL = "OFFICIAL";
const SYSTEM_USER_ID = "system";

type Notice = {
  type: "success" | "error" | "info";
  text: string;
};

type ViewTab = "my" | "subscribed" | "plaza";
type MyAgentTab = "created" | "mcp" | "skills";
type McpProfileTransportType = "sse" | "streamableHttp";

type McpProfileForm = {
  id?: number;
  configJson: string;
};

type McpConnectionState = "success" | "failed";

type McpJsonServerConfig = {
  id?: number;
  configJson: string;
  type: McpProfileTransportType;
  name: string;
  description: string;
  baseUri: string;
  endpoint: string;
  requestTimeout: number;
  authType?: string;
  authToken?: string;
  authKeyName?: string;
  headersJson?: string;
  queryJson?: string;
};

const MCP_JSON_TEMPLATE = `{
  "mcpServers": {
    "web-search-mcp-server": {
      "type": "streamableHttp",
      "description": "根据用户提问，搜索实时网页信息",
      "url": "https://qianfan.baidubce.com/v2/tools/web-search/mcp",
      "headers": {
        "Authorization": "Bearer xxxxx"
      }
    }
  }
}`;

const EMPTY_MCP_PROFILE_FORM: McpProfileForm = {
  configJson: MCP_JSON_TEMPLATE,
};


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

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const pickStringRecord = (value: unknown): Record<string, string> => {
  if (!isObjectRecord(value)) return {};
  const record: Record<string, string> = {};
  Object.entries(value).forEach(([key, item]) => {
    if (typeof item === "string" && key.trim()) {
      record[key.trim()] = item;
    } else if (typeof item === "number" || typeof item === "boolean") {
      record[key.trim()] = String(item);
    }
  });
  return record;
};

const normalizeMcpType = (value: unknown): McpProfileTransportType => {
  if (typeof value === "string" && value.trim().toLowerCase() === "streamablehttp") {
    return "streamableHttp";
  }
  return "sse";
};

const normalizeEndpointPath = (rawPath: string, type: McpProfileTransportType): string => {
  const fallback = type === "streamableHttp" ? "/mcp" : "/sse";
  const path = rawPath.trim();
  if (!path) return fallback;
  if (path.startsWith("/")) return path;
  return `/${path}`;
};

const parseMcpJsonConfig = (jsonText: string, profileId?: number): McpJsonServerConfig => {
  if (!jsonText.trim()) {
    throw new Error("请先输入 MCP JSON 配置");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(error instanceof Error ? `JSON 解析失败：${error.message}` : "JSON 解析失败");
  }

  if (!isObjectRecord(parsed) || !isObjectRecord(parsed.mcpServers)) {
    throw new Error("JSON 蹇呴』鍖呭惈 mcpServers 瀵硅薄");
  }

  const serverEntries = Object.entries(parsed.mcpServers).filter(
    ([name, config]) => name.trim().length > 0 && isObjectRecord(config),
  );
  if (serverEntries.length !== 1) {
    throw new Error("当前每次仅支持配置 1 个 MCP Server，请在 mcpServers 中只保留一个对象");
  }

  const [serverName, rawServerConfig] = serverEntries[0];
  const rawConfig = rawServerConfig as Record<string, unknown>;
  const type = normalizeMcpType(rawConfig.type);
  const description = typeof rawConfig.description === "string" ? rawConfig.description.trim() : "";
  const rawUrl = typeof rawConfig.url === "string" ? rawConfig.url.trim() : "";
  if (!rawUrl) {
    throw new Error("mcpServers.<name>.url 不能为空");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (error) {
    throw new Error(error instanceof Error ? `url 格式非法: ${error.message}` : "url 格式非法");
  }
  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    throw new Error("url 协议仅支持 http:// 或 https://");
  }

  const baseUri = parsedUrl.origin;
  const pathFromUrl = parsedUrl.pathname || "";
  const endpoint = normalizeEndpointPath(pathFromUrl, type);

  const headers = pickStringRecord(rawConfig.headers);
  const query = {
    ...pickStringRecord(rawConfig.query),
    ...pickStringRecord(rawConfig.queryParams),
  };

  const auth = isObjectRecord(rawConfig.auth) ? rawConfig.auth : null;
  const authTypeRaw = typeof auth?.type === "string" ? auth.type.trim().toLowerCase().replace("-", "") : "";
  const authType = authTypeRaw === "bearer" || authTypeRaw === "apikey" || authTypeRaw === "none"
    ? (authTypeRaw === "apikey" ? "apiKey" : authTypeRaw)
    : undefined;
  const authToken = typeof auth?.token === "string" ? auth.token : undefined;
  const authKeyName = typeof auth?.keyName === "string" ? auth.keyName : undefined;

  const timeoutRaw = Number(rawConfig.requestTimeout);
  const requestTimeout = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : 3000;

  const mergedQuery: Record<string, string> = { ...query };
  parsedUrl.searchParams.forEach((value, key) => {
    if (!mergedQuery[key]) {
      mergedQuery[key] = value;
    }
  });

  return {
    id: profileId,
    configJson: JSON.stringify(parsed, null, 2),
    type,
    name: serverName.trim(),
    description,
    baseUri,
    endpoint,
    requestTimeout,
    authType,
    authToken,
    authKeyName,
    headersJson: Object.keys(headers).length ? JSON.stringify(headers) : "",
    queryJson: Object.keys(mergedQuery).length ? JSON.stringify(mergedQuery) : "",
  };
};

const buildMcpJsonFromProfile = (profile: AgentMcpProfileResponseDTO): string => {
  if (profile.configJson && profile.configJson.trim()) {
    try {
      return JSON.stringify(JSON.parse(profile.configJson), null, 2);
    } catch {
      // fallback to reconstructed json
    }
  }
  const endpoint = profile.sseEndpoint?.trim() || (profile.type === "streamableHttp" ? "/mcp" : "/sse");
  const baseUri = profile.baseUri?.trim() || "";
  const url = `${baseUri}${endpoint}`;
  const headers = (() => {
    if (!profile.headersJson) return {};
    try {
      const parsed = JSON.parse(profile.headersJson);
      return pickStringRecord(parsed);
    } catch {
      return {};
    }
  })();

  const query = (() => {
    if (!profile.queryJson) return {};
    try {
      const parsed = JSON.parse(profile.queryJson);
      return pickStringRecord(parsed);
    } catch {
      return {};
    }
  })();

  const payload: Record<string, unknown> = {
    type: profile.type === "streamableHttp" ? "streamableHttp" : "sse",
    description: profile.description || "",
    url,
  };
  if (Object.keys(headers).length) payload.headers = headers;
  if (Object.keys(query).length) payload.query = query;
  if (profile.requestTimeout && profile.requestTimeout > 0) payload.requestTimeout = profile.requestTimeout;
  if (profile.authType && profile.authType !== "none") {
    payload.auth = {
      type: profile.authType,
      token: profile.authToken || "",
      keyName: profile.authKeyName || "",
    };
  }

  return JSON.stringify(
    {
      mcpServers: {
        [profile.name || "mcp-server"]: payload,
      },
    },
    null,
    2,
  );
};

const canOpenChat = (agent: AgentConfigSummaryResponseDTO) => {
  return agent.status === STATUS_PUBLISHED || (agent.publishedVersion ?? 0) > 0;
};

const isSystemOwner = (ownerUserId?: string) => {
  return (ownerUserId || "").trim().toLowerCase() === SYSTEM_USER_ID;
};

const isSystemMcpProfile = (profile: AgentMcpProfileResponseDTO) => {
  return profile.systemProvided === true || isSystemOwner(profile.userId);
};

const isSystemSkillProfile = (profile: AgentSkillProfileResponseDTO) => {
  return profile.systemProvided === true || isSystemOwner(profile.userId);
};

export default function MyAgentPage() {
  const router = useRouter();

  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyAgentId, setBusyAgentId] = useState("");
  const [openMenuAgentId, setOpenMenuAgentId] = useState("");
  const [activeTab, setActiveTab] = useState<ViewTab>("my");
  const [activeMyTab, setActiveMyTab] = useState<MyAgentTab>("created");
  const [myAgents, setMyAgents] = useState<AgentConfigSummaryResponseDTO[]>([]);
  const [plazaAgents, setPlazaAgents] = useState<AgentConfigSummaryResponseDTO[]>([]);
  const [subscribedAgents, setSubscribedAgents] = useState<AgentConfigSummaryResponseDTO[]>([]);
  const [mcpProfiles, setMcpProfiles] = useState<AgentMcpProfileResponseDTO[]>([]);
  const [skillProfiles, setSkillProfiles] = useState<AgentSkillProfileResponseDTO[]>([]);
  const [mcpProfileForm, setMcpProfileForm] = useState<McpProfileForm>(EMPTY_MCP_PROFILE_FORM);
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [mcpTesting, setMcpTesting] = useState(false);
  const [mcpConnectionStateByName, setMcpConnectionStateByName] = useState<Record<string, McpConnectionState>>({});
  const [testingMcpProfileName, setTestingMcpProfileName] = useState<string | null>(null);

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
    const title = `EasyAgent 平台 - ${titleMap[type]}`;

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
        const [myResponse, plazaResponse, subscribeResponse, mcpProfileResponse, skillProfileResponse] = await Promise.all([
          agentService.queryMyAgentConfigList(currentUserId),
          agentService.queryAgentPlazaList(),
          agentService.queryMySubscribedAgentConfigList(currentUserId),
          agentService.queryMcpProfileList(currentUserId),
          agentService.querySkillProfileList(currentUserId),
        ]);
        const errors: string[] = [];

        if (myResponse.code === SUCCESS_CODE) {
          setMyAgents(myResponse.data ?? []);
        } else {
          setMyAgents([]);
          errors.push(myResponse.info || "加载我的 Agent 失败");
        }

        if (plazaResponse.code === SUCCESS_CODE) {
          setPlazaAgents(plazaResponse.data ?? []);
        } else {
          setPlazaAgents([]);
          errors.push(plazaResponse.info || "加载 Agent 广场失败");
        }

        if (subscribeResponse.code === SUCCESS_CODE) {
          setSubscribedAgents(subscribeResponse.data ?? []);
        } else {
          setSubscribedAgents([]);
          errors.push(subscribeResponse.info || "加载我的订阅失败");
        }

        if (mcpProfileResponse.code === SUCCESS_CODE) {
          setMcpProfiles(mcpProfileResponse.data ?? []);
        } else {
          setMcpProfiles([]);
          errors.push(mcpProfileResponse.info || "加载 MCP 配置失败");
        }

        if (skillProfileResponse.code === SUCCESS_CODE) {
          setSkillProfiles(skillProfileResponse.data ?? []);
        } else {
          setSkillProfiles([]);
          errors.push(skillProfileResponse.info || "加载 SKILL 配置失败");
        }

        if (errors.length > 0) {
          showNotice("error", errors[0]);
        }
      } catch (error) {
        console.error(error);
        showNotice("error", error instanceof Error ? error.message : "加载 Agent 列表失败");
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
      showNotice("info", "该 Agent 尚未发布运行，暂不可进入会话");
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

  const handleGoUpdateConfig = (agent: AgentConfigSummaryResponseDTO) => {
    router.push(`/agent-create?agentId=${encodeURIComponent(agent.agentId)}`);
  };

  const handleDeleteAgent = async (agent: AgentConfigSummaryResponseDTO) => {
    if (!window.confirm(`确认删除 Agent「${agent.agentName}」吗？`)) {
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

        // 删除成功后先本地移除，避免用户看到“已删除”但卡片仍停留在页面中。
        setMyAgents((prev) => prev.filter((item) => item.agentId !== agent.agentId));
        setPlazaAgents((prev) => prev.filter((item) => item.agentId !== agent.agentId));
        setSubscribedAgents((prev) => prev.filter((item) => item.agentId !== agent.agentId));
        setOpenMenuAgentId((prev) => (prev === agent.agentId ? "" : prev));
        showNotice("success", `已删除 Agent：${agent.agentName}`);
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

  const handleSaveMcpProfile = async () => {
    if (!userId) return;

    setProfileSubmitting(true);
    try {
      const parsed = parseMcpJsonConfig(mcpProfileForm.configJson, mcpProfileForm.id);
      const payload = {
        id: parsed.id,
        userId,
        configJson: parsed.configJson,
        description: parsed.description,
        type: parsed.type,
        name: parsed.name,
        baseUri: parsed.baseUri,
        sseEndpoint: parsed.endpoint,
        requestTimeout: parsed.requestTimeout,
        authType: parsed.authType,
        authToken: parsed.authToken,
        authKeyName: parsed.authKeyName,
        headersJson: parsed.headersJson,
        queryJson: parsed.queryJson,
      };

      const response = parsed.id
        ? await agentService.updateMcpProfile(payload)
        : await agentService.createMcpProfile(payload);

      if (response.code !== SUCCESS_CODE) {
        throw new Error(response.info || "保存 MCP 配置失败");
      }

      setMcpProfileForm(EMPTY_MCP_PROFILE_FORM);
      await refreshAll();
      showNotice("success", parsed.id ? "MCP 配置已更新" : "MCP 配置已创建");
    } catch (error) {
      console.error(error);
      showNotice("error", error instanceof Error ? error.message : "保存 MCP 配置失败");
    } finally {
      setProfileSubmitting(false);
    }
  };

  const loadMcpProfileDetailByName = async (profileName: string): Promise<AgentMcpProfileResponseDTO> => {
    const normalizedName = (profileName || "").trim();
    if (!normalizedName) {
      throw new Error("MCP 名称为空");
    }
    const response = await agentService.queryMcpProfileDetail(userId, normalizedName);
    if (response.code !== SUCCESS_CODE || !response.data) {
      throw new Error(response.info || `加载 MCP 详情失败：${normalizedName}`);
    }
    return response.data;
  };

  const buildMcpTestPayloadFromProfile = (profile: AgentMcpProfileResponseDTO): McpJsonServerConfig => ({
    id: profile.id,
    configJson: buildMcpJsonFromProfile(profile),
    description: profile.description || "",
    type: profile.type === "streamableHttp" ? "streamableHttp" : "sse",
    name: profile.name || "",
    baseUri: profile.baseUri || "",
    endpoint: profile.sseEndpoint || "",
    requestTimeout: profile.requestTimeout ?? 3000,
    authType: profile.authType || undefined,
    authToken: profile.authToken || undefined,
    authKeyName: profile.authKeyName || undefined,
    headersJson: profile.headersJson || undefined,
    queryJson: profile.queryJson || undefined,
  });

  const runMcpConnectionTest = async (
    requestPayload: McpJsonServerConfig,
    options?: { silent?: boolean },
  ): Promise<boolean> => {
    const targetProfileName = (requestPayload.name || "").trim();
    if (targetProfileName) {
      setTestingMcpProfileName(targetProfileName);
    }

    try {
      const response = await agentService.testMcpProfileConnection({
        id: requestPayload.id,
        configJson: requestPayload.configJson,
        description: requestPayload.description,
        type: requestPayload.type,
        name: requestPayload.name,
        baseUri: requestPayload.baseUri,
        sseEndpoint: requestPayload.endpoint,
        requestTimeout: requestPayload.requestTimeout,
        authType: requestPayload.authType,
        authToken: requestPayload.authToken,
        authKeyName: requestPayload.authKeyName,
        headersJson: requestPayload.headersJson,
        queryJson: requestPayload.queryJson,
        userId,
      });
      if (response.code !== SUCCESS_CODE || !response.data) {
        throw new Error(response.info || "MCP 服务连接测试失败");
      }

      if (targetProfileName) {
        setMcpConnectionStateByName((prev) => ({ ...prev, [targetProfileName]: "success" }));
      }
      if (!options?.silent) {
        showNotice("success", "MCP 服务连接测试成功");
      }
      return true;
    } catch (error) {
      console.error(error);
      if (targetProfileName) {
        setMcpConnectionStateByName((prev) => ({ ...prev, [targetProfileName]: "failed" }));
      }
      if (!options?.silent) {
        showNotice("error", error instanceof Error ? error.message : "MCP 服务连接测试失败");
      }
      return false;
    } finally {
      if (targetProfileName) {
        setTestingMcpProfileName((prev) => (prev === targetProfileName ? null : prev));
      }
    }
  };

  const handleTestMcpProfileConnection = async (payload?: McpJsonServerConfig) => {
    if (!userId) return;

    let requestPayload: McpJsonServerConfig;
    try {
      requestPayload = payload ?? parseMcpJsonConfig(mcpProfileForm.configJson, mcpProfileForm.id);
    } catch (error) {
      showNotice("error", error instanceof Error ? error.message : "MCP JSON 解析失败");
      return;
    }

    setMcpTesting(true);
    try {
      await runMcpConnectionTest(requestPayload);
    } finally {
      setMcpTesting(false);
      setTestingMcpProfileName(null);
    }
  };

  const handleEditMcpProfile = async (profileName: string) => {
    if (!userId) return;
    if (!profileName.trim()) return;
    try {
      const detail = await loadMcpProfileDetailByName(profileName);
      if (isSystemOwner(detail.userId)) {
        showNotice("info", "system 内置 MCP 不支持编辑");
        return;
      }
      setMcpProfileForm({
        id: detail.id,
        configJson: buildMcpJsonFromProfile(detail),
      });
    } catch (error) {
      showNotice("error", error instanceof Error ? error.message : "加载 MCP 详情失败");
    }
  };

  const handleTestSavedMcpProfile = async (profileName: string) => {
    if (!userId) return;
    if (!profileName.trim()) return;
    try {
      const detail = await loadMcpProfileDetailByName(profileName);
      if (isSystemOwner(detail.userId)) {
        showNotice("info", "system 内置 MCP 不支持连接测试");
        return;
      }
      setMcpTesting(true);
      await runMcpConnectionTest(buildMcpTestPayloadFromProfile(detail));
    } catch (error) {
      showNotice("error", error instanceof Error ? error.message : "MCP 服务连接测试失败");
    } finally {
      setMcpTesting(false);
      setTestingMcpProfileName(null);
    }
  };

  const handleTestAllMcpProfiles = async () => {
    if (!userId) return;
    if (!mcpProfiles.length) {
      showNotice("info", "暂无可测试的 MCP 配置");
      return;
    }

    setMcpTesting(true);
    let successCount = 0;
    let failedCount = 0;

    try {
      for (const profile of mcpProfiles) {
        if (!profile.name) continue;
        if (isSystemMcpProfile(profile)) continue;
        try {
          const detail = await loadMcpProfileDetailByName(profile.name);
          if (isSystemOwner(detail.userId)) {
            continue;
          }
          const ok = await runMcpConnectionTest(buildMcpTestPayloadFromProfile(detail), { silent: true });
          if (ok) {
            successCount += 1;
          } else {
            failedCount += 1;
          }
        } catch {
          failedCount += 1;
        }
      }
    } finally {
      setMcpTesting(false);
      setTestingMcpProfileName(null);
    }

    if (failedCount === 0) {
      showNotice("success", `全部测试成功，共 ${successCount} 个`);
    } else {
      showNotice("error", `测试完成：成功 ${successCount}，失败 ${failedCount}`);
    }
  };

  const handleDeleteMcpProfile = async (profileName: string) => {
    if (!userId) return;
    if (!profileName.trim()) return;

    let detail: AgentMcpProfileResponseDTO;
    try {
      detail = await loadMcpProfileDetailByName(profileName);
    } catch (error) {
      showNotice("error", error instanceof Error ? error.message : "加载 MCP 详情失败");
      return;
    }
    if (isSystemOwner(detail.userId)) {
      showNotice("info", "system 内置 MCP 不支持删除");
      return;
    }
    if (detail.id == null) {
      showNotice("error", "删除失败：MCP 配置 ID 不存在");
      return;
    }

    if (!window.confirm(`确认删除 MCP 配置「${detail.name}」吗？`)) return;

    setProfileSubmitting(true);

    try {
      const response = await agentService.deleteMcpProfile({
        id: detail.id,
        userId,
      });

      if (response.code !== SUCCESS_CODE) {
        throw new Error(response.info || "删除 MCP 配置失败");
      }

      if (mcpProfileForm.id === detail.id) {
        setMcpProfileForm(EMPTY_MCP_PROFILE_FORM);
      }

      setMcpConnectionStateByName((prev) => {
        const next = { ...prev };
        delete next[profileName];
        return next;
      });

      await refreshAll();
      showNotice("success", "MCP 配置已删除");
    } catch (error) {
      console.error(error);
      showNotice("error", error instanceof Error ? error.message : "删除 MCP 配置失败");
    } finally {
      setProfileSubmitting(false);
    }
  };

  const handleDeleteSkillProfile = async (profile: AgentSkillProfileResponseDTO) => {
    if (!userId) return;
    if (isSystemSkillProfile(profile)) {
      showNotice("info", "system 内置 SKILL 不支持删除");
      return;
    }
    if (!window.confirm(`确认删除 SKILL 配置「${profile.skillName}」吗？`)) return;
    setProfileSubmitting(true);
    try {
      const response = await agentService.deleteSkillProfile({
        id: profile.id,
        userId,
      });
      if (response.code !== SUCCESS_CODE) {
        throw new Error(response.info || "删除 SKILL 配置失败");
      }
      await refreshAll();
      showNotice("success", "SKILL 配置已删除");
    } catch (error) {
      console.error(error);
      showNotice("error", error instanceof Error ? error.message : "删除 SKILL 配置失败");
    } finally {
      setProfileSubmitting(false);
    }
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
          <p className="text-5xl font-semibold tracking-tight text-zinc-900">{agent.agentName || "未命名 Agent"}</p>
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
            title={isSubscribed ? "取消订阅" : "订阅 Agent"}
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
                      handleGoUpdateConfig(agent);
                    }}
                    disabled={isBusy}
                    className="inline-flex w-full items-center gap-1 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
                  >
                    {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
                    更新配置
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
            正在加载 Agent 列表...
          </div>
        ) : activeTab === "my" ? (
          <section>
            <div className="mb-5 inline-flex rounded-2xl border border-zinc-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setActiveMyTab("created")}
                className={`rounded-xl px-5 py-2 text-sm font-medium transition ${
                  activeMyTab === "created" ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                我创建的Agent
              </button>
              <button
                type="button"
                onClick={() => setActiveMyTab("mcp")}
                className={`rounded-xl px-5 py-2 text-sm font-medium transition ${
                  activeMyTab === "mcp" ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                MCP
              </button>
              <button
                type="button"
                onClick={() => setActiveMyTab("skills")}
                className={`rounded-xl px-5 py-2 text-sm font-medium transition ${
                  activeMyTab === "skills" ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                SKILLs
              </button>
            </div>

            {activeMyTab === "created" ? (
              <>
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
              </>
            ) : activeMyTab === "mcp" ? (
              <>
                <p className="mb-5 text-3xl font-medium text-zinc-700">MCP 配置管理</p>
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
                  <div className="xl:col-span-2 rounded-2xl border border-zinc-200 bg-white/80 p-5 shadow-sm">
                    <p className="mb-3 text-lg font-semibold text-zinc-800">{mcpProfileForm.id ? "更新 MCP 配置" : "新增 MCP 配置"}</p>
                    <div className="space-y-3">
                      <textarea
                        className="h-72 w-full rounded-xl border border-zinc-300 px-3 py-2 font-mono text-xs outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                        placeholder="请输入 mcpServers JSON"
                        value={mcpProfileForm.configJson}
                        onChange={(event) =>
                          setMcpProfileForm((prev) => ({ ...prev, configJson: event.target.value }))
                        }
                      />
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSaveMcpProfile()}
                        disabled={profileSubmitting || mcpTesting}
                        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                      >
                        {profileSubmitting ? "处理中..." : mcpProfileForm.id ? "更新配置" : "创建配置"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleTestMcpProfileConnection()}
                        disabled={profileSubmitting || mcpTesting}
                        className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                      >
                        {mcpTesting ? "测试中..." : "测试连接"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setMcpProfileForm(EMPTY_MCP_PROFILE_FORM)}
                        disabled={profileSubmitting || mcpTesting}
                        className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
                      >
                        重置
                      </button>
                    </div>
                  </div>

                  <div className="xl:col-span-3 rounded-2xl border border-zinc-200 bg-white/80 p-5 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-lg font-semibold text-zinc-800">已保存 MCP（新建 Agent 下拉可选）</p>
                      <button
                        type="button"
                        onClick={() => void handleTestAllMcpProfiles()}
                        disabled={profileSubmitting || mcpTesting || !mcpProfiles.length}
                        className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1 text-xs text-sky-700 hover:bg-sky-100 disabled:opacity-60"
                      >
                        {mcpTesting ? "测试中..." : "一键测试全部"}
                      </button>
                    </div>
                    <div className="space-y-3">
                      {mcpProfiles.map((profile, index) => {
                        const profileName = (profile.name || "").trim();
                        const connectionState = profileName ? mcpConnectionStateByName[profileName] : undefined;
                        return (
                        <div key={`${profileName || "mcp"}-${index}`} className="rounded-xl border border-zinc-200 bg-white p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                {profileName && testingMcpProfileName === profileName ? (
                                  <Loader2 size={14} className="animate-spin text-zinc-400" />
                                ) : (
                                  <Circle
                                    size={12}
                                    className={
                                      connectionState === "success"
                                        ? "fill-emerald-500 text-emerald-500"
                                        : connectionState === "failed"
                                          ? "fill-rose-500 text-rose-500"
                                          : "fill-zinc-300 text-zinc-300"
                                    }
                                  />
                                )}
                                <p className="truncate text-sm font-semibold text-zinc-800">{profile.name}</p>
                                {isSystemMcpProfile(profile) ? (
                                  <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700">
                                    系统
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-1 text-xs text-zinc-500">{profile.description || "无描述"}</p>
                            </div>
                            {!isSystemMcpProfile(profile) ? (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void handleEditMcpProfile(profileName)}
                                  className="rounded-lg border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                                >
                                  编辑
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleTestSavedMcpProfile(profileName)}
                                  disabled={profileSubmitting || mcpTesting}
                                  className="rounded-lg border border-emerald-200 bg-white px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                                >
                                  测试
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteMcpProfile(profileName)}
                                  disabled={profileSubmitting || mcpTesting}
                                  className="rounded-lg border border-rose-200 bg-white px-3 py-1 text-xs text-rose-700 hover:bg-rose-50"
                                >
                                  删除
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )})}
                      {!mcpProfiles.length ? (
                        <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-3 py-5 text-sm text-zinc-500">
                          还没有 MCP 配置，先在左侧创建后即可在新建 Agent 中下拉选择。
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="mb-5 flex items-center justify-between gap-3">
                  <p className="text-3xl font-medium text-zinc-700">SKILL 配置管理</p>
                  <button
                    type="button"
                    onClick={() => router.push("/skill-create")}
                    className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    <Plus size={14} />
                    新建SKILL
                  </button>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white/80 p-5 shadow-sm">
                  <p className="mb-3 text-lg font-semibold text-zinc-800">已保存 SKILL（新建 Agent 下拉可选）</p>
                  <div className="space-y-3">
                    {skillProfiles.map((profile) => (
                      <div key={profile.id} className="rounded-xl border border-zinc-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-semibold text-zinc-800">{profile.skillName}</p>
                              {isSystemSkillProfile(profile) ? (
                                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700">
                                  系统
                                </span>
                              ) : null}
                            </div>
                          </div>
                          {!isSystemSkillProfile(profile) ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => router.push(`/skill-create?id=${profile.id}`)}
                                className="rounded-lg border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                              >
                                编辑
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteSkillProfile(profile)}
                                disabled={profileSubmitting}
                                className="rounded-lg border border-rose-200 bg-white px-3 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                              >
                                删除
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    {!skillProfiles.length ? (
                      <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-3 py-5 text-sm text-zinc-500">
                        还没有 SKILL 配置，点击右上角“新建SKILL”创建。
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            )}
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



