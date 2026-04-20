"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { agentService } from "@/api/agent";
import { cookieUtils } from "@/utils/cookie";

const SUCCESS_CODE = "0000";
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/";
const DEFAULT_MODEL = "qwen-plus";
const DEFAULT_COMPLETIONS_PATH = "v1/chat/completions";
const DEFAULT_EMBEDDINGS_PATH = "v1/embeddings";
const CONFIG_WRITER_AGENT_ID = "100090";
const CONFIG_WRITER_AGENT_NAME = "agentConfigWriterAgent";

const CJK_REGEX = /[\u4E00-\u9FFF]/;
const UNICODE_ESCAPE_REGEX = /\\u[0-9a-fA-F]{4}/;

type Notice = {
  type: "success" | "error" | "info";
  text: string;
};

type AgentItem = {
  name: string;
  description: string;
  instruction: string;
  outputKey: string;
};

type WorkflowItem = {
  type: "sequential" | "parallel" | "loop" | "supervisor";
  name: string;
  description: string;
  subAgentsText: string;
  routerAgent: string;
  maxIterations: string;
};

type CreateForm = {
  agentId: string;
  appName: string;
  agentName: string;
  agentDesc: string;
  baseUrl: string;
  completionsPath: string;
  embeddingsPath: string;
  model: string;
  apiKey: string;
  runnerAgentName: string;
  pluginNameListText: string;
  autoPublish: boolean;
  agents: AgentItem[];
  agentWorkflows: WorkflowItem[];
};

type CreateFormPatch = Partial<Omit<CreateForm, "agents" | "agentWorkflows">> & {
  agents?: AgentItem[];
  agentWorkflows?: WorkflowItem[];
};

type AssistantRole = "user" | "assistant";
type AssistantParseState = "idle" | "streaming" | "repairing" | "parsed" | "error";

type AssistantMessage = {
  id: string;
  role: AssistantRole;
  content: string;
};

const createEmptyAgentItem = (): AgentItem => ({
  name: "",
  description: "",
  instruction: "",
  outputKey: "",
});

const createEmptyWorkflowItem = (): WorkflowItem => ({
  type: "sequential",
  name: "",
  description: "",
  subAgentsText: "",
  routerAgent: "",
  maxIterations: "3",
});

const INITIAL_FORM: CreateForm = {
  agentId: "",
  appName: "MyAgentApp",
  agentName: "",
  agentDesc: "",
  baseUrl: DEFAULT_BASE_URL,
  completionsPath: DEFAULT_COMPLETIONS_PATH,
  embeddingsPath: DEFAULT_EMBEDDINGS_PATH,
  model: DEFAULT_MODEL,
  apiKey: "",
  runnerAgentName: "",
  pluginNameListText: "",
  autoPublish: true,
  agents: [createEmptyAgentItem()],
  agentWorkflows: [createEmptyWorkflowItem()],
};

const parseTextList = (input: string): string[] =>
  input
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

const decodeUnicodeEscapes = (value: string): string => {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
};

const normalizePotentialMojibake = (value: string): string => {
  if (!value) return value;
  const unicodeNormalized = UNICODE_ESCAPE_REGEX.test(value) ? decodeUnicodeEscapes(value) : value;
  if (CJK_REGEX.test(unicodeNormalized)) return unicodeNormalized;
  if (!/[^\u0000-\u007F]/.test(unicodeNormalized)) return unicodeNormalized;

  const bytes = new Uint8Array(unicodeNormalized.length);
  for (let i = 0; i < unicodeNormalized.length; i += 1) {
    const code = unicodeNormalized.charCodeAt(i);
    if (code > 0xff) {
      return unicodeNormalized;
    }
    bytes[i] = code;
  }

  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (decoded.includes("\uFFFD")) return unicodeNormalized;

  const decodedCjkCount = (decoded.match(CJK_REGEX) ?? []).length;
  return decodedCjkCount >= 2 ? decoded : unicodeNormalized;
};

const buildConfigJsonFromForm = (form: CreateForm): string => {
  const normalizedAgents = form.agents.map((item) => {
    const agent: Record<string, unknown> = {
      name: item.name.trim(),
      instruction: item.instruction.trim(),
      description: item.description.trim(),
    };
    if (item.outputKey.trim()) {
      agent.outputKey = item.outputKey.trim();
    }
    return agent;
  });

  const normalizedWorkflows = form.agentWorkflows.map((item) => {
    const workflow: Record<string, unknown> = {
      type: item.type,
      name: item.name.trim(),
      description: item.description.trim(),
      subAgents: parseTextList(item.subAgentsText),
      maxIterations: Number(item.maxIterations) > 0 ? Number(item.maxIterations) : 3,
    };
    if (item.routerAgent.trim()) {
      workflow.routerAgent = item.routerAgent.trim();
    }
    return workflow;
  });

  const runnerAgentName =
    form.runnerAgentName.trim() ||
    normalizedWorkflows[0]?.name?.toString() ||
    normalizedAgents[0]?.name?.toString() ||
    "";

  const config = {
    appName: form.appName.trim(),
    agent: {
      agentId: form.agentId.trim(),
      agentName: form.agentName.trim(),
      agentDesc: form.agentDesc.trim(),
    },
    module: {
      aiApi: {
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
        completionsPath: form.completionsPath.trim(),
        embeddingsPath: form.embeddingsPath.trim(),
      },
      chatModel: {
        model: form.model.trim(),
      },
      agents: normalizedAgents,
      agentWorkflows: normalizedWorkflows,
      runner: {
        agentName: runnerAgentName,
        pluginNameList: parseTextList(form.pluginNameListText),
      },
    },
  };

  return JSON.stringify(config, null, 2);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const normalized = normalizePotentialMojibake(value).trim();
    return normalized.length ? normalized : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }
  return null;
};

const toStringListFromUnknown = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => toNonEmptyString(item))
      .filter((item): item is string => Boolean(item));
  }

  const text = toNonEmptyString(value);
  if (!text) return [];
  return parseTextList(text);
};

const normalizeWorkflowType = (value: unknown): WorkflowItem["type"] => {
  const normalized = toNonEmptyString(value)?.toLowerCase();
  if (normalized === "parallel" || normalized === "loop" || normalized === "supervisor") {
    return normalized;
  }
  return "sequential";
};

const tryParseJson = (value: string): unknown | null => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const stripCodeFences = (value: string): string => {
  return value
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
};

const extractFirstJsonSegment = (value: string): string | null => {
  // 从自然语言+JSON混合文本中提取第一个 JSON 片段（支持未闭合片段）
  const normalized = stripCodeFences(value);
  const firstCurly = normalized.indexOf("{");
  const firstSquare = normalized.indexOf("[");

  if (firstCurly < 0 && firstSquare < 0) return null;

  const useSquare = firstCurly < 0 || (firstSquare >= 0 && firstSquare < firstCurly);
  const start = useSquare ? firstSquare : firstCurly;

  const stack: string[] = [useSquare ? "]" : "}"];
  let inString = false;
  let escaped = false;

  for (let index = start + 1; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      if (inString) escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      stack.push("}");
      continue;
    }

    if (char === "[") {
      stack.push("]");
      continue;
    }

    if (char === "}" || char === "]") {
      if (!stack.length) continue;
      const expected = stack[stack.length - 1];
      if (char !== expected) continue;
      stack.pop();
      if (!stack.length) {
        return normalized.slice(start, index + 1);
      }
    }
  }

  return normalized.slice(start);
};

const repairJsonFragment = (value: string): string => {
  // 对流式输出中的“截断 JSON”做轻量修复：补齐引号、括号并去除尾逗号
  let repaired = "";
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    repaired += char;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      if (inString) escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      stack.push("}");
      continue;
    }

    if (char === "[") {
      stack.push("]");
      continue;
    }

    if ((char === "}" || char === "]") && stack.length > 0) {
      const expected = stack[stack.length - 1];
      if (char === expected) {
        stack.pop();
      }
    }
  }

  if (inString) {
    repaired += "\"";
  }

  repaired = repaired.replace(/,\s*$/g, "");

  while (stack.length) {
    const closer = stack.pop();
    if (closer) repaired += closer;
  }

  repaired = repaired.replace(/,\s*([}\]])/g, "$1");
  return repaired;
};

const tryParseProgressiveJson = (value: string): unknown | null => {
  // 先直接解析，再尝试修复后解析，保证流式阶段也能尽快拿到可用对象
  const segment = extractFirstJsonSegment(value);
  if (!segment) return null;

  const direct = tryParseJson(segment);
  if (direct !== null) return direct;

  const repaired = repairJsonFragment(segment);
  const repairedResult = tryParseJson(repaired);
  if (repairedResult !== null) return repairedResult;

  const trimmed = segment.replace(/[^\]}]+$/g, "");
  return tryParseJson(trimmed);
};
  // 兼容多种包裹结构：configJson/data/result/payload/config
const unwrapConfigObject = (value: unknown, depth = 0): Record<string, unknown> | null => {
  // 鍏煎澶氱鍖呰９缁撴瀯锛歝onfigJson/data/result/payload/config
  if (!isRecord(value) || depth > 4) return null;

  const rawConfigJson = value.configJson;
  if (typeof rawConfigJson === "string") {
    const parsedConfig = tryParseProgressiveJson(rawConfigJson);
    const nested = unwrapConfigObject(parsedConfig, depth + 1);
    if (nested) return nested;
  }

  for (const key of ["data", "result", "payload", "config"]) {
    const nested = unwrapConfigObject(value[key], depth + 1);
    if (nested) return nested;
  }

  return value;
};

const mapAgentsFromUnknown = (value: unknown): AgentItem[] | undefined => {
  if (!Array.isArray(value)) return undefined;

  const mapped = value
    .map((item) => {
      if (!isRecord(item)) return null;

      const name = toNonEmptyString(item.name) ?? toNonEmptyString(item.agentName);
      const instruction =
        toNonEmptyString(item.instruction) ??
        toNonEmptyString(item.systemPrompt) ??
        toNonEmptyString(item.prompt);

      if (!name && !instruction) return null;

      return {
        name: name ?? "",
        description: toNonEmptyString(item.description) ?? toNonEmptyString(item.agentDesc) ?? "",
        instruction: instruction ?? "",
        outputKey: toNonEmptyString(item.outputKey) ?? "",
      } satisfies AgentItem;
    })
    .filter((item): item is AgentItem => item !== null);

  return mapped.length ? mapped : [createEmptyAgentItem()];
};

const mapWorkflowsFromUnknown = (value: unknown): WorkflowItem[] | undefined => {
  if (!Array.isArray(value)) return undefined;

  const mapped = value
    .map((item) => {
      if (!isRecord(item)) return null;

      const name = toNonEmptyString(item.name) ?? toNonEmptyString(item.workflowName);
      if (!name) return null;

      const subAgents = toStringListFromUnknown(item.subAgents ?? item.subAgentList ?? item.agents);
      const maxIterationsText = toNonEmptyString(item.maxIterations) ?? "3";

      return {
        type: normalizeWorkflowType(item.type),
        name,
        description: toNonEmptyString(item.description) ?? "",
        subAgentsText: subAgents.join(","),
        routerAgent: toNonEmptyString(item.routerAgent) ?? "",
        maxIterations: maxIterationsText,
      } satisfies WorkflowItem;
    })
    .filter((item): item is WorkflowItem => item !== null);

  return mapped.length ? mapped : [createEmptyWorkflowItem()];
};

const buildFormPatchFromUnknown = (value: unknown): CreateFormPatch | null => {
  const root = unwrapConfigObject(value);
  if (!root) return null;

  const patch: CreateFormPatch = {};

  const agentNode = isRecord(root.agent) ? root.agent : null;
  const moduleNode = isRecord(root.module) ? root.module : null;
  const aiApiNode =
    (moduleNode && isRecord(moduleNode.aiApi) ? moduleNode.aiApi : null) ??
    (isRecord(root.aiApi) ? root.aiApi : null);
  const chatModelNode =
    (moduleNode && isRecord(moduleNode.chatModel) ? moduleNode.chatModel : null) ??
    (isRecord(root.chatModel) ? root.chatModel : null);
  const runnerNode =
    (moduleNode && isRecord(moduleNode.runner) ? moduleNode.runner : null) ??
    (isRecord(root.runner) ? root.runner : null);

  const appName = toNonEmptyString(root.appName);
  if (appName) patch.appName = appName;

  const agentId = toNonEmptyString(agentNode?.agentId ?? root.agentId);
  if (agentId) patch.agentId = agentId;

  const agentName = toNonEmptyString(agentNode?.agentName ?? root.agentName);
  if (agentName) patch.agentName = agentName;

  const agentDesc = toNonEmptyString(agentNode?.agentDesc ?? root.agentDesc ?? root.description);
  if (agentDesc) patch.agentDesc = agentDesc;

  const baseUrl = toNonEmptyString(aiApiNode?.baseUrl ?? root.baseUrl);
  if (baseUrl) patch.baseUrl = baseUrl;

  const completionsPath = toNonEmptyString(
    aiApiNode?.completionsPath ?? aiApiNode?.["completions-path"] ?? root.completionsPath ?? root["completions-path"],
  );
  if (completionsPath) patch.completionsPath = completionsPath;

  const embeddingsPath = toNonEmptyString(
    aiApiNode?.embeddingsPath ?? aiApiNode?.["embeddings-path"] ?? root.embeddingsPath ?? root["embeddings-path"],
  );
  if (embeddingsPath) patch.embeddingsPath = embeddingsPath;

  const model = toNonEmptyString(chatModelNode?.model ?? root.model);
  if (model) patch.model = model;

  const apiKey = toNonEmptyString(aiApiNode?.apiKey ?? root.apiKey);
  if (apiKey) patch.apiKey = apiKey;

  const runnerAgentName = toNonEmptyString(runnerNode?.agentName ?? root.runnerAgentName);
  if (runnerAgentName) patch.runnerAgentName = runnerAgentName;

  const pluginList = toStringListFromUnknown(runnerNode?.pluginNameList ?? root.pluginNameList);
  if (pluginList.length > 0) {
    patch.pluginNameListText = pluginList.join(",");
  } else {
    const pluginText = toNonEmptyString(root.pluginNameListText);
    if (pluginText) patch.pluginNameListText = pluginText;
  }

  const agents = mapAgentsFromUnknown(moduleNode?.agents ?? root.agents);
  if (agents) patch.agents = agents;

  const workflows = mapWorkflowsFromUnknown(moduleNode?.agentWorkflows ?? root.agentWorkflows);
  if (workflows) patch.agentWorkflows = workflows;

  return Object.keys(patch).length ? patch : null;
};

const mergeCreateFormPatch = (prev: CreateForm, patch: CreateFormPatch): CreateForm => {
  return {
    ...prev,
    ...patch,
    agents: patch.agents ?? prev.agents,
    agentWorkflows: patch.agentWorkflows ?? prev.agentWorkflows,
  };
};

const getParseStatusText = (state: AssistantParseState): string => {
  if (state === "streaming") return "正在流式生成配置...";
  if (state === "repairing") return "收到片段，正在修复 JSON 并动态回填表单...";
  if (state === "parsed") return "已解析最新 JSON 片段，表单已自动更新。";
  if (state === "error") return "本次输出未能解析为配置 JSON，请补充需求后重试。";
  return "输入需求后，右侧助手会自动生成并实时填写左侧表单。";
};

const getParseStatusStyle = (state: AssistantParseState): string => {
  if (state === "parsed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (state === "error") return "border-rose-200 bg-rose-50 text-rose-700";
  if (state === "streaming" || state === "repairing") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-600";
};

export default function AgentCreatePage() {
  const router = useRouter();
  const session = useMemo(() => cookieUtils.getSession(), []);
  const operator = session.username || "admin";

  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [form, setForm] = useState<CreateForm>(INITIAL_FORM);

  const [assistantSessionId, setAssistantSessionId] = useState("");
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantStreaming, setAssistantStreaming] = useState(false);
  const [assistantParseState, setAssistantParseState] = useState<AssistantParseState>("idle");
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([
    {
      id: "writer-welcome",
      role: "assistant",
      content:
        "你好，我是 Agent Config Writer。描述你想要的 Agent 能力、流程和模型要求，我会实时生成配置并自动填写左侧表单。",
    },
  ]);

  const assistantSessionRef = useRef("");
  const assistantAbortRef = useRef<AbortController | null>(null);
  const assistantBufferRef = useRef("");
  const assistantLastPatchRef = useRef("");
  const assistantViewportRef = useRef<HTMLDivElement | null>(null);

  const showNotice = (type: Notice["type"], text: string) => {
    setNotice({ type, text });
  };

  const validateCreateForm = (): string | null => {
    if (!form.agentId.trim()) return "请填写 Agent ID";
    if (!form.appName.trim()) return "请填写 appName";
    if (!form.agentName.trim()) return "请填写 Agent 名称";
    if (!form.baseUrl.trim()) return "请填写 baseUrl";
    if (!form.completionsPath.trim()) return "请填写 completions-path";
    if (!form.embeddingsPath.trim()) return "请填写 embeddings-path";
    if (!form.model.trim()) return "请填写模型";
    if (form.autoPublish && !form.apiKey.trim()) return "勾选自动发布时必须填写 API Key";
    if (!form.agents.length) return "至少需要 1 个 agents 节点";

    for (let index = 0; index < form.agents.length; index += 1) {
      const item = form.agents[index];
      if (!item.name.trim()) return `第 ${index + 1} 个 Agent 缺少 name`;
      if (!item.instruction.trim()) return `第 ${index + 1} 个 Agent 缺少 instruction`;
    }

    for (let index = 0; index < form.agentWorkflows.length; index += 1) {
      const item = form.agentWorkflows[index];
      if (!item.name.trim()) return `第 ${index + 1} 个 Workflow 缺少 name`;
      if (!item.type.trim()) return `第 ${index + 1} 个 Workflow 缺少 type`;
      if (!parseTextList(item.subAgentsText).length) return `第 ${index + 1} 个 Workflow 缺少 subAgents`;
      if (item.type === "supervisor" && !item.routerAgent.trim()) {
        return `第 ${index + 1} 个 Workflow 为 supervisor 时必须填写 routerAgent`;
      }
      const maxIterations = Number(item.maxIterations);
      if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
        return `第 ${index + 1} 个 Workflow 的 maxIterations 必须为正整数`;
      }
    }

    return null;
  };

  const updateAgentItem = (index: number, patch: Partial<AgentItem>) => {
    setForm((prev) => ({
      ...prev,
      agents: prev.agents.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }));
  };

  const updateWorkflowItem = (index: number, patch: Partial<WorkflowItem>) => {
    setForm((prev) => ({
      ...prev,
      agentWorkflows: prev.agentWorkflows.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  };

  const addAgentItem = () => {
    setForm((prev) => ({ ...prev, agents: [...prev.agents, createEmptyAgentItem()] }));
  };

  const removeAgentItem = (index: number) => {
    setForm((prev) => {
      const next = prev.agents.filter((_, itemIndex) => itemIndex !== index);
      return { ...prev, agents: next.length ? next : [createEmptyAgentItem()] };
    });
  };

  const addWorkflowItem = () => {
    setForm((prev) => ({ ...prev, agentWorkflows: [...prev.agentWorkflows, createEmptyWorkflowItem()] }));
  };

  const removeWorkflowItem = (index: number) => {
    setForm((prev) => {
      const next = prev.agentWorkflows.filter((_, itemIndex) => itemIndex !== index);
      return { ...prev, agentWorkflows: next.length ? next : [createEmptyWorkflowItem()] };
    });
  };

  const handleCreateAgent = async () => {
    const validationError = validateCreateForm();
    if (validationError) {
      showNotice("error", validationError);
      return;
    }

    setCreating(true);
    try {
      const payload = {
        agentId: form.agentId.trim(),
        appName: form.appName.trim(),
        agentName: form.agentName.trim(),
        agentDesc: form.agentDesc.trim(),
        configJson: buildConfigJsonFromForm(form),
        operator,
      };

      const createResponse = await agentService.createAgentConfig(payload);
      if (createResponse.code !== SUCCESS_CODE || !createResponse.data) {
        throw new Error(createResponse.info || "创建 Agent 失败");
      }

      if (form.autoPublish) {
        const publishResponse = await agentService.publishAgentConfig({
          agentId: payload.agentId,
          operator: payload.operator,
        });
        if (publishResponse.code !== SUCCESS_CODE) {
          throw new Error(publishResponse.info || "创建成功，但自动发布失败，请稍后手动发布");
        }
      }

      showNotice("success", form.autoPublish ? "创建并发布成功，正在返回 Agent 列表..." : "创建成功，正在返回 Agent 列表...");
      setTimeout(() => {
        router.push("/");
      }, 700);
    } catch (error) {
      console.error(error);
      showNotice("error", error instanceof Error ? error.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const ensureConfigWriterSession = useCallback(async (): Promise<string> => {
    if (assistantSessionRef.current) return assistantSessionRef.current;

    const response = await agentService.createSession({
      agentId: CONFIG_WRITER_AGENT_ID,
      userId: operator,
    });

    if (response.code !== SUCCESS_CODE || !response.data?.sessionId) {
      throw new Error(response.info || "创建配置助手会话失败");
    }

    const nextSessionId = response.data.sessionId;
    assistantSessionRef.current = nextSessionId;
    setAssistantSessionId(nextSessionId);
    return nextSessionId;
  }, [operator]);

  const updateAssistantMessage = useCallback((messageId: string, content: string) => {
    setAssistantMessages((prev) =>
      prev.map((item) => (item.id === messageId ? { ...item, content: normalizePotentialMojibake(content) } : item)),
    );
  }, []);

  const applyPatchFromAssistantStream = useCallback((rawText: string): boolean => {
    // 每次收到流式分片都尝试解析并回填，实现“边生成边填写”
    const parsed = tryParseProgressiveJson(rawText);
    if (!parsed) return false;

    const patch = buildFormPatchFromUnknown(parsed);
    if (!patch) return false;

    const patchSignature = JSON.stringify(patch);
    if (patchSignature === assistantLastPatchRef.current) {
      return true;
    }

    assistantLastPatchRef.current = patchSignature;
    setForm((prev) => mergeCreateFormPatch(prev, patch));
    return true;
  }, []);

  const handleAskConfigWriter = useCallback(async () => {
    if (!assistantInput.trim() || assistantStreaming) return;

    const userMessageContent = assistantInput.trim();
    const userMessageId = `writer-user-${Date.now()}`;
    const assistantMessageId = `writer-assistant-${Date.now() + 1}`;

    setAssistantInput("");
    setAssistantParseState("streaming");
    setAssistantMessages((prev) => [
      ...prev,
      { id: userMessageId, role: "user", content: userMessageContent },
      { id: assistantMessageId, role: "assistant", content: "" },
    ]);

    assistantAbortRef.current?.abort();
    const abortController = new AbortController();
    assistantAbortRef.current = abortController;
    assistantBufferRef.current = "";
    assistantLastPatchRef.current = "";
    setAssistantStreaming(true);

    try {
      const sessionId = await ensureConfigWriterSession();
      let sawStreamContent = false;

      await agentService.chatStream(
        {
          agentId: CONFIG_WRITER_AGENT_ID,
          userId: operator,
          sessionId,
          message: userMessageContent,
        },
        (event) => {
          const eventType = (event.type ?? "").toLowerCase();
          const content = normalizePotentialMojibake(event.content ?? "");
          if (!content.trim() && eventType !== "route") return;

          sawStreamContent = true;
          const chunk = eventType === "route" ? `\n[ROUTE] ${content}\n` : content;
          assistantBufferRef.current += chunk;
          updateAssistantMessage(assistantMessageId, assistantBufferRef.current);

          const parsed = applyPatchFromAssistantStream(assistantBufferRef.current);
          if (parsed) {
            setAssistantParseState("parsed");
          } else if (assistantBufferRef.current.includes("{")) {
            setAssistantParseState("repairing");
          } else {
            setAssistantParseState("streaming");
          }
        },
        abortController.signal,
      );

      if (!sawStreamContent) {
        updateAssistantMessage(assistantMessageId, "未收到配置助手内容，请重试。");
        setAssistantParseState("error");
        return;
      }

      const parsedAtTail = applyPatchFromAssistantStream(assistantBufferRef.current);
      if (!parsedAtTail) {
        setAssistantParseState("error");
      } else {
        setAssistantParseState("parsed");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      console.error(error);
      updateAssistantMessage(assistantMessageId, "请求失败，请检查后端服务或稍后重试。");
      setAssistantParseState("error");
    } finally {
      setAssistantStreaming(false);
      assistantAbortRef.current = null;
    }
  }, [
    assistantInput,
    assistantStreaming,
    ensureConfigWriterSession,
    operator,
    updateAssistantMessage,
    applyPatchFromAssistantStream,
  ]);

  useEffect(() => {
    if (session.isLoggedIn !== "true" || !session.username) {
      router.replace("/login");
    }
  }, [router, session.isLoggedIn, session.username]);

  useEffect(() => {
    const viewport = assistantViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [assistantMessages]);

  useEffect(() => {
    return () => {
      assistantAbortRef.current?.abort();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-zinc-100 to-slate-200 px-4 py-6 text-zinc-900 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-[1500px]">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">新建 Agent</h1>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="inline-flex items-center gap-1 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-100"
          >
            <ArrowLeft size={14} />
            返回 Agent 列表
          </button>
        </div>

        {notice ? (
          <div
            className={`mb-4 rounded-xl border px-4 py-2 text-sm ${
              notice.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : notice.type === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-blue-200 bg-blue-50 text-blue-700"
            }`}
          >
            {notice.text}
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_430px]">
          <section className="rounded-3xl border border-zinc-200 bg-white/90 p-6 shadow-sm backdrop-blur">
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-zinc-600">Agent ID</label>
                  <input
                    className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                    placeholder="例如：100901"
                    value={form.agentId}
                    onChange={(event) => setForm((prev) => ({ ...prev, agentId: event.target.value }))}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-zinc-600">应用名 appName</label>
                  <input
                    className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                    value={form.appName}
                    onChange={(event) => setForm((prev) => ({ ...prev, appName: event.target.value }))}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-zinc-600">Agent 名称</label>
                  <input
                    className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                    placeholder="请输入名称"
                    value={form.agentName}
                    onChange={(event) => setForm((prev) => ({ ...prev, agentName: event.target.value }))}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-zinc-600">Agent 描述</label>
                  <input
                    className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                    placeholder="请输入描述"
                    value={form.agentDesc}
                    onChange={(event) => setForm((prev) => ({ ...prev, agentDesc: event.target.value }))}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-zinc-600">模型</label>
                  <input
                    className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                    placeholder="例如：qwen-plus / gpt-4o-mini"
                    value={form.model}
                    onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-zinc-600">baseUrl</label>
                  <input
                    className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                    value={form.baseUrl}
                    onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-zinc-600">completions-path</label>
                  <input
                    className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                    placeholder="v1/chat/completions"
                    value={form.completionsPath}
                    onChange={(event) => setForm((prev) => ({ ...prev, completionsPath: event.target.value }))}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-zinc-600">embeddings-path</label>
                  <input
                    className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                    placeholder="v1/embeddings"
                    value={form.embeddingsPath}
                    onChange={(event) => setForm((prev) => ({ ...prev, embeddingsPath: event.target.value }))}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-zinc-600">API Key（自动发布时必填）</label>
                  <input
                    type="password"
                    className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                    placeholder="sk-..."
                    value={form.apiKey}
                    onChange={(event) => setForm((prev) => ({ ...prev, apiKey: event.target.value }))}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-zinc-600">Runner Agent Name（可选）</label>
                  <input
                    className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                    placeholder="默认取首个 workflow 名称"
                    value={form.runnerAgentName}
                    onChange={(event) => setForm((prev) => ({ ...prev, runnerAgentName: event.target.value }))}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm text-zinc-600">Runner pluginNameList（逗号或换行分隔）</label>
                  <textarea
                    className="h-20 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                    placeholder="myTestPlugin,myLogPlugin"
                    value={form.pluginNameListText}
                    onChange={(event) => setForm((prev) => ({ ...prev, pluginNameListText: event.target.value }))}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-zinc-800">agents</h2>
                  <button
                    type="button"
                    onClick={addAgentItem}
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                  >
                    <Plus size={14} />
                    新增 Agent
                  </button>
                </div>

                <div className="space-y-3">
                  {form.agents.map((item, index) => (
                    <div key={`agent-${index}`} className="rounded-xl border border-zinc-200 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-500">Agent #{index + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeAgentItem(index)}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                        >
                          <Trash2 size={12} />
                          删除
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <input
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                          placeholder="name（必填）"
                          value={item.name}
                          onChange={(event) => updateAgentItem(index, { name: event.target.value })}
                        />
                        <input
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                          placeholder="outputKey（可选）"
                          value={item.outputKey}
                          onChange={(event) => updateAgentItem(index, { outputKey: event.target.value })}
                        />
                        <input
                          className="md:col-span-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                          placeholder="description（可选）"
                          value={item.description}
                          onChange={(event) => updateAgentItem(index, { description: event.target.value })}
                        />
                        <textarea
                          className="md:col-span-2 h-24 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                          placeholder="instruction（必填）"
                          value={item.instruction}
                          onChange={(event) => updateAgentItem(index, { instruction: event.target.value })}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-zinc-800">agentWorkflows</h2>
                  <button
                    type="button"
                    onClick={addWorkflowItem}
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                  >
                    <Plus size={14} />
                    新增 Workflow
                  </button>
                </div>

                <div className="space-y-3">
                  {form.agentWorkflows.map((item, index) => (
                    <div key={`workflow-${index}`} className="rounded-xl border border-zinc-200 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-500">Workflow #{index + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeWorkflowItem(index)}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                        >
                          <Trash2 size={12} />
                          删除
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <select
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                          value={item.type}
                          onChange={(event) =>
                            updateWorkflowItem(index, { type: event.target.value as WorkflowItem["type"] })
                          }
                        >
                          <option value="sequential">sequential</option>
                          <option value="parallel">parallel</option>
                          <option value="loop">loop</option>
                          <option value="supervisor">supervisor</option>
                        </select>
                        <input
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                          placeholder="name（必填）"
                          value={item.name}
                          onChange={(event) => updateWorkflowItem(index, { name: event.target.value })}
                        />
                        <input
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                          placeholder="maxIterations（正整数）"
                          value={item.maxIterations}
                          onChange={(event) => updateWorkflowItem(index, { maxIterations: event.target.value })}
                        />
                        <input
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                          placeholder="routerAgent（supervisor 时必填）"
                          value={item.routerAgent}
                          onChange={(event) => updateWorkflowItem(index, { routerAgent: event.target.value })}
                        />
                        <input
                          className="md:col-span-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                          placeholder="description（可选）"
                          value={item.description}
                          onChange={(event) => updateWorkflowItem(index, { description: event.target.value })}
                        />
                        <textarea
                          className="md:col-span-2 h-20 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                          placeholder="subAgents（逗号或换行分隔）"
                          value={item.subAgentsText}
                          onChange={(event) => updateWorkflowItem(index, { subAgentsText: event.target.value })}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-zinc-600">
                <input
                  type="checkbox"
                  checked={form.autoPublish}
                  onChange={(event) => setForm((prev) => ({ ...prev, autoPublish: event.target.checked }))}
                />
                创建后自动发布（勾选后会出现在左侧卡片）              </label>

              <button
                type="button"
                onClick={handleCreateAgent}
                disabled={creating}
                className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 text-base font-semibold text-white shadow transition hover:from-blue-700 hover:to-blue-600 disabled:opacity-60"
              >
                {creating ? (
                  <>
                    <Loader2 size={16} className="mr-2 animate-spin" />
                    创建中...
                  </>
                ) : (
                  "确认创建"
                )}
              </button>
            </div>
          </section>

          <aside className="rounded-3xl border border-zinc-200 bg-white/90 p-4 shadow-sm backdrop-blur xl:sticky xl:top-6 xl:h-fit">
            <div className="mb-3 rounded-2xl border border-blue-100 bg-blue-50/70 px-3 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
                <Sparkles size={14} />
                配置助手（固定）
              </div>
              <p className="mt-1 text-xs text-zinc-600">
                当前仅连接 <span className="font-medium text-zinc-800">{CONFIG_WRITER_AGENT_NAME}</span>
                （ID: {CONFIG_WRITER_AGENT_ID}）
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                会话ID：{assistantSessionId || "尚未创建"}
              </p>
            </div>

            <div
              ref={assistantViewportRef}
              className="h-[420px] overflow-y-auto rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3"
            >
              <div className="space-y-3">
                {assistantMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-6 ${
                      message.role === "user"
                        ? "ml-auto bg-blue-600 text-white"
                        : "bg-white text-zinc-700 shadow-sm ring-1 ring-zinc-200"
                    }`}
                  >
                    <pre className="whitespace-pre-wrap break-words font-sans">{message.content}</pre>
                  </div>
                ))}
              </div>
            </div>

            <div className={`mt-3 rounded-xl border px-3 py-2 text-xs ${getParseStatusStyle(assistantParseState)}`}>
              {getParseStatusText(assistantParseState)}
            </div>

            <div className="mt-3">
              <textarea
                className="h-24 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                placeholder="例如：帮我生成一个能先分析需求，再调用代码助手与测试助手的多 Agent 配置"
                value={assistantInput}
                onChange={(event) => setAssistantInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleAskConfigWriter();
                  }
                }}
                disabled={assistantStreaming}
              />
            </div>

            <button
              type="button"
              onClick={() => {
                void handleAskConfigWriter();
              }}
              disabled={assistantStreaming || !assistantInput.trim()}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:from-blue-700 hover:to-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {assistantStreaming ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Send size={14} />
                  发送并实时填写
                </>
              )}
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}
